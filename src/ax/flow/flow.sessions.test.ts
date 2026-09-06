import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxAIOpenAIModel } from '../ai/openai/chat_types.js';
import { ai } from '../ai/wrap.js';
import { runControl } from '../dsp/runControl.js';
import { fn } from '../dsp/sig.js';
import { ax } from '../dsp/template.js';
import { flow } from './flow.js';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Deterministic counterparts of the public flows/astra-* examples. Each
// conversation deliberately receives the same call ID from the provider.
function fixture() {
  const requests: { node: string; body: any }[] = [];
  const model = AxAIOpenAIModel.GPT6Astra;
  const llm = ai({
    name: 'openai',
    apiKey: 'fixture',
    config: { model },
    options: {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const node: string =
          body.previous_response_id?.split(':')[0] ??
          /NODE:(\w+)/.exec(JSON.stringify(body.input))?.[1];
        if (!node) throw new Error('Fixture request omitted its node identity');
        requests.push({ node, body });
        const id = `${node}:${requests.filter((r) => r.node === node).length}`;
        const tool = {
          type: 'function_call',
          id: 'item',
          call_id: 'shared-call',
          name: 'lookup',
          arguments: '{}',
          status: 'completed',
        };
        if (
          body.previous_response_id &&
          !body.input.some(
            (item: any) =>
              item.type === 'function_call_output' &&
              item.output.includes(`${node}-code`)
          )
        )
          throw new Error(`Missing ${node} tool result`);
        const output = body.previous_response_id
          ? [
              {
                type: 'message',
                id: 'msg',
                role: 'assistant',
                status: 'completed',
                content: [
                  { type: 'output_text', text: `Answer: ${node}-code` },
                ],
              },
            ]
          : [tool];
        const events = [
          { type: 'response.created', response: { id, model, output: [] } },
          ...(!body.previous_response_id
            ? [{ type: 'response.output_item.done', item: tool }]
            : []),
          {
            type: 'response.completed',
            response: {
              id,
              model,
              status: 'completed',
              output,
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ];
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
        );
      },
    },
  });
  return { llm, requests };
}

function lookupProgram(
  handler: (args?: unknown, extra?: any) => Promise<string> | string
) {
  return ax('question -> answer', {
    functions: [
      fn('lookup')
        .description('Get the code')
        .execution('background')
        .handler(handler)
        .build(),
    ],
  });
}

function parallel(
  left: ReturnType<typeof lookupProgram>,
  right: ReturnType<typeof lookupProgram>,
  automatic = false
) {
  const wf = flow<{ question: string }>()
    .node('left', left)
    .node('right', right);
  if (automatic)
    return wf
      .execute('left', () => ({ question: 'NODE:left' }))
      .execute('right', () => ({ question: 'NODE:right' }))
      .returns((state) => ({
        answers: [state.leftResult.answer, state.rightResult.answer],
      }));
  return wf
    .parallel([
      (sub) => sub.execute('left', () => ({ question: 'NODE:left' })),
      (sub) => sub.execute('right', () => ({ question: 'NODE:right' })),
    ])
    .merge('answers', (leftResult, rightResult) => [
      leftResult.leftResult.answer,
      rightResult.rightResult.answer,
    ]);
}

describe('flow async sessions', () => {
  it.each([false, true])(
    'keeps delayed results isolated and waits for both branches (automatic=%s)',
    async (automatic) => {
      const { llm, requests } = fixture();
      const leftStarted = gate();
      const rightStarted = gate();
      const releaseLeft = gate();
      const releaseRight = gate();
      const rightCompleted = gate();
      const control = runControl();
      control.onEvent((event) => {
        if (event.type === 'completed' && event.path === 'root/right')
          rightCompleted.resolve();
      });
      const left = vi.fn(async () => {
        leftStarted.resolve();
        await releaseLeft.promise;
        return 'left-code';
      });
      const right = vi.fn(async () => {
        rightStarted.resolve();
        await releaseRight.promise;
        return 'right-code';
      });
      let finished = false;
      const run = parallel(lookupProgram(left), lookupProgram(right), automatic)
        .forward(llm, { question: 'go' }, { control })
        .then((result) => {
          finished = true;
          return result;
        });
      try {
        await Promise.all([leftStarted.promise, rightStarted.promise]);
        expect(requests).toHaveLength(2);
        releaseRight.resolve();
        await rightCompleted.promise;
        expect(finished).toBe(false);
        expect(requests.filter((r) => r.node === 'left')).toHaveLength(1);
      } finally {
        releaseLeft.resolve();
        releaseRight.resolve();
      }
      expect((await run).answers).toEqual(['left-code', 'right-code']);
      expect(left).toHaveBeenCalledTimes(1);
      expect(right).toHaveBeenCalledTimes(1);
      for (const node of ['left', 'right']) {
        const continuation = requests.find(
          (r) => r.node === node && r.body.previous_response_id
        )!;
        expect(continuation.body.previous_response_id).toBe(`${node}:1`);
        expect(JSON.stringify(continuation.body.input)).not.toContain(
          `${node === 'left' ? 'right' : 'left'}-code`
        );
      }
    }
  );

  it('targets steering and reasoning to one parallel node without changing its sibling', async () => {
    const { llm, requests } = fixture();
    const control = runControl();
    control.steer('LEFT ONLY', { target: 'root/left' });
    control.setThinkingTokenBudget('high', { target: 'root/left' });
    await parallel(
      lookupProgram(() => 'left-code'),
      lookupProgram(() => 'right-code')
    ).forward(llm, { question: 'go' }, { control, thinkingTokenBudget: 'low' });
    const left = requests.find(
      (r) => r.node === 'left' && r.body.previous_response_id
    )!;
    expect(left.body.reasoning.effort).toBe('low');
    expect(left.body.input).toContainEqual({
      type: 'configuration_update',
      reasoning: { effort: 'high' },
    });
    expect(JSON.stringify(left.body.input)).toContain('LEFT ONLY');
    const right = requests.filter((r) => r.node === 'right');
    expect(JSON.stringify(right)).not.toContain('LEFT ONLY');
    expect(JSON.stringify(right)).not.toContain('configuration_update');
  });

  it('applies a root update to a future node without rerunning a completed node', async () => {
    const { llm, requests } = fixture();
    const control = runControl();
    const first = vi.fn(() => 'first-code');
    const second = vi.fn(() => 'second-code');
    const wf = flow<{ question: string }>()
      .node('first', lookupProgram(first))
      .node('second', lookupProgram(second))
      .execute('first', () => ({ question: 'NODE:first' }))
      .execute('second', (state) => {
        expect(state.firstResult.answer).toBe('first-code');
        control.steer('ROOT REVISION');
        return { question: 'NODE:second' };
      })
      .returns((state) => ({ answer: state.secondResult.answer }));
    expect(
      (await wf.forward(llm, { question: 'go' }, { control })).answer
    ).toBe('second-code');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(requests.filter((r) => r.node === 'first')).toHaveLength(2);
    expect(
      JSON.stringify(requests.filter((r) => r.node === 'first'))
    ).not.toContain('ROOT REVISION');
    expect(
      JSON.stringify(requests.filter((r) => r.node === 'second'))
    ).toContain('ROOT REVISION');
  });

  it.each([false, true])(
    'cancels pending tools without merging or completing (automatic=%s)',
    async (automatic) => {
      const { llm, requests } = fixture();
      const control = runControl();
      const started = gate();
      const release = gate();
      const signals: AbortSignal[] = [];
      const events: { type: string; path: string }[] = [];
      control.onEvent((event) => events.push(event));
      const handler = vi.fn(async (_args, extra) => {
        signals.push(extra.abortSignal);
        if (signals.length === 2) started.resolve();
        await release.promise;
        return 'ignored';
      });
      const wf = parallel(
        lookupProgram(handler),
        lookupProgram(handler),
        automatic
      );
      const run = wf.forward(llm, { question: 'go' }, { control });
      const rejection = expect(run).rejects.toThrow(/abort|shared-call/i);
      try {
        await started.promise;
        control.abort();
        await rejection;
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(handler).toHaveBeenCalledTimes(2);
        expect(requests).toHaveLength(2);
        expect(
          events.some(
            (event) => event.type === 'completed' && event.path === 'root'
          )
        ).toBe(false);
      } finally {
        release.resolve();
      }
    }
  );

  it('bypasses flow and node result caches when a controller is attached', async () => {
    const { llm, requests } = fixture();
    const cache = vi.fn(() => ({ answer: 'stale' }));
    const wf = flow<{ question: string }>()
      .node(
        'left',
        lookupProgram(() => 'left-code')
      )
      .execute('left', () => ({ question: 'NODE:left' }))
      .returns((state) => ({ answer: state.leftResult.answer }));
    const result = await wf.forward(
      llm,
      { question: 'go' },
      { control: runControl(), cachingFunction: cache }
    );
    expect(result.answer).toBe('left-code');
    expect(cache).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
  });

  it('keeps a chat-only service usable with scoped controls in a flow', async () => {
    const control = runControl();
    control.steer('SECOND ONLY', { target: 'root/second' });
    const requests: { path?: string; prompt: string }[] = [];
    const llm = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (request, options) => {
        requests.push({
          path: options?.executionPath,
          prompt: JSON.stringify(request.chatPrompt),
        });
        return { results: [{ index: 0, content: 'Answer: done' }] };
      },
    });
    const wf = flow<{ question: string }>()
      .node('first', ax('question -> answer'))
      .node('second', ax('question -> answer'))
      .execute('first', (state) => ({ question: state.question }))
      .execute('second', (state) => ({ question: state.firstResult.answer }));
    await wf.forward(llm, { question: 'go' }, { control });
    expect(requests.map((r) => r.path)).toEqual(['root/first', 'root/second']);
    expect(requests[0]!.prompt).not.toContain('SECOND ONLY');
    expect(requests[1]!.prompt).toContain('SECOND ONLY');
  });
  it('delivers a root update to an active branch and a future node without rerunning a finished branch', async () => {
    const { llm, requests } = fixture();
    const control = runControl();
    const rightStarted = gate();
    const releaseRight = gate();
    const left = vi.fn(async () => {
      await rightStarted.promise;
      return 'left-code';
    });
    const right = vi.fn(async () => {
      rightStarted.resolve();
      await releaseRight.promise;
      return 'right-code';
    });
    const third = vi.fn(() => 'third-code');
    control.onEvent((event) => {
      if (event.type === 'completed' && event.path === 'root/left') {
        control.steer('ROOT ACTIVE AND FUTURE');
        releaseRight.resolve();
      }
    });
    const wf = parallel(lookupProgram(left), lookupProgram(right))
      .node('third', lookupProgram(third))
      .execute('third', (state) => ({
        question: `NODE:third after ${state.answers.join(',')}`,
      }))
      .returns((state) => ({ answer: state.thirdResult.answer }));
    try {
      expect(
        (await wf.forward(llm, { question: 'go' }, { control })).answer
      ).toBe('third-code');
    } finally {
      releaseRight.resolve();
    }
    for (const handler of [left, right, third])
      expect(handler).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(requests.filter((r) => r.node === 'left'))
    ).not.toContain('ROOT ACTIVE AND FUTURE');
    for (const node of ['right', 'third']) {
      expect(JSON.stringify(requests.filter((r) => r.node === node))).toContain(
        'ROOT ACTIVE AND FUTURE'
      );
      expect(requests.filter((r) => r.node === node)).toHaveLength(2);
    }
  });
});
