import { describe, expect, it, vi } from 'vitest';
import { AxBalancer } from '../ai/balance.js';
import { AxMockAIService } from '../ai/mock/api.js';
import { ai } from '../ai/wrap.js';
import { flow } from '../flow/flow.js';
import { runControl } from './runControl.js';
import { f, fn } from './sig.js';
import { ax } from './template.js';

const model = 'gpt-6-astra' as const;
const toolItem = (id = 'call1', name = 'lookup', args = '{}') => ({
  type: 'function_call',
  id: `item_${id}`,
  call_id: id,
  name,
  arguments: args,
  status: 'completed',
});
const completed = (id: string, output: unknown[]) => ({
  type: 'response.completed',
  response: {
    id,
    model,
    status: 'completed',
    output,
    usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
  },
});
const answer = (text = 'the result is 42') => ({
  type: 'message',
  id: 'msg',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: `Answer: ${text}` }],
});
function stream(events: unknown[]) {
  return new Response(
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('automatic chat sessions', () => {
  it('starts completed background calls while the model is still producing output and incorporates the result', async () => {
    const started = deferred();
    const release = deferred();
    const requests: any[] = [];
    let pending = false;
    const handler = vi.fn(async () => {
      pending = true;
      started.resolve();
      await release.promise;
      pending = false;
      return 42;
    });
    const lookup = fn('lookup')
      .description('Look up the value')
      .execution('background')
      .handler(handler)
      .build();
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          requests.push(body);
          if (requests.length > 1) return stream([completed('r2', [answer()])]);
          return new Response(
            new ReadableStream({
              async start(controller) {
                const send = (event: unknown) =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify(event)}\n\n`
                    )
                  );
                send({
                  type: 'response.created',
                  response: { id: 'r1', model, output: [] },
                });
                send({ type: 'response.output_item.done', item: toolItem() });
                await started.promise;
                expect(pending).toBe(true);
                send({
                  type: 'response.output_text.delta',
                  delta: 'Independent work',
                });
                send(completed('r1', [toolItem(), answer('provisional')]));
                release.resolve();
                controller.close();
              },
            })
          );
        },
      },
    });
    const gen = ax('question -> answer', { functions: [lookup] });
    expect(await gen.forward(llm, { question: 'Look up the value' })).toEqual({
      answer: 'the result is 42',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requests[0].tools[0].async).toBe(true);
    expect(requests[1].previous_response_id).toBe('r1');
    expect(requests[1].input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call1',
      output: '42',
    });
    expect(gen.getUsage()[0]?.tokens?.totalTokens).toBe(26);
  });

  it('does not execute partial arguments or duplicate completed events', async () => {
    const handler = vi.fn(() => 42);
    let calls = 0;
    const lookup = fn('lookup')
      .description('Look up')
      .execution('background')
      .handler(handler)
      .build();
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async () =>
          stream(
            ++calls === 1
              ? [
                  {
                    type: 'response.function_call_arguments.delta',
                    item_id: 'item_call1',
                    delta: '{',
                  },
                  { type: 'response.output_item.done', item: toolItem() },
                  { type: 'response.output_item.done', item: toolItem() },
                  completed('r1', [toolItem()]),
                  completed('r1', [toolItem()]),
                ]
              : [completed('r2', [answer()])]
          ),
      },
    });
    await ax('question -> answer', { functions: [lookup] }).forward(llm, {
      question: 'lookup',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fails rather than returning a provisional answer at the step limit', async () => {
    const lookup = fn('lookup')
      .description('Look up')
      .execution('background')
      .handler(() => 42)
      .build();
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async () =>
          stream([
            { type: 'response.output_item.done', item: toolItem() },
            completed('r1', [toolItem(), answer('provisional')]),
          ]),
      },
    });
    await expect(
      ax('question -> answer', { functions: [lookup], maxSteps: 1 }).forward(
        llm,
        { question: 'lookup' }
      )
    ).rejects.toThrow();
  });

  it('queues steering and reasoning changes for the HTTP continuation', async () => {
    const control = runControl();
    const events: any[] = [];
    control.onEvent((event) => events.push(event));
    const requests: any[] = [];
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1) {
            control.steer('Make it concise');
            control.setThinkingTokenBudget('high');
          }
          return stream([completed(`r${requests.length}`, [answer()])]);
        },
      },
    });
    await ax('question -> answer').forward(
      llm,
      { question: 'hi' },
      { control, thinkingTokenBudget: 'low' }
    );
    expect(requests).toHaveLength(2);
    expect(requests[1].reasoning.effort).toBe('low');
    expect(requests[1].input).toContainEqual({
      type: 'configuration_update',
      reasoning: { effort: 'high' },
    });
    expect(events.filter((e) => e.type === 'applied')).toHaveLength(2);
  });
  it('submits out-of-order results without waiting for all background tools', async () => {
    const slow = deferred();
    const requests: any[] = [];
    const tools = [
      fn('slow')
        .description('Slow lookup')
        .execution('background')
        .handler(async () => {
          await slow.promise;
          return 'slow-result';
        })
        .build(),
      fn('fast')
        .description('Fast lookup')
        .execution('background')
        .handler(() => 'fast-result')
        .build(),
    ];
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          if (requests.length === 1)
            return stream([
              {
                type: 'response.output_item.done',
                item: toolItem('slow', 'slow'),
              },
              {
                type: 'response.output_item.done',
                item: toolItem('fast', 'fast'),
              },
              completed('r1', [
                toolItem('slow', 'slow'),
                toolItem('fast', 'fast'),
              ]),
            ]);
          if (requests.length === 2) {
            slow.resolve();
            return stream([completed('r2', [answer('provisional')])]);
          }
          return stream([completed('r3', [answer('both incorporated')])]);
        },
      },
    });
    const result = await ax('question -> answer', { functions: tools }).forward(
      llm,
      { question: 'both' }
    );
    expect(result.answer).toBe('both incorporated');
    expect(requests[1].input.map((item: any) => item.call_id)).toEqual([
      'fast',
    ]);
    expect(requests[2].input.map((item: any) => item.call_id)).toEqual([
      'slow',
    ]);
  });

  it('validates complete arguments before invoking tools and returns validation feedback', async () => {
    const handler = vi.fn(() => 'unused');
    let requests = 0;
    const fetch = vi.fn(async () =>
      ++requests === 1
        ? stream([
            {
              type: 'response.output_item.done',
              item: toolItem('call1', 'lookup', '{"code":12}'),
            },
            completed('r1', [toolItem('call1', 'lookup', '{"code":12}')]),
          ])
        : stream([completed('r2', [answer('invalid arguments')])])
    );
    const lookup = fn('lookup')
      .description('Lookup')
      .arg('code', f.string())
      .execution('background')
      .handler(handler)
      .build();
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: { fetch },
    });
    await ax('question -> answer', { functions: [lookup] }).forward(llm, {
      question: 'lookup',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves aliases before selecting session capabilities', () => {
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      models: [{ key: 'smart', model, description: 'Astra' }],
    });
    expect(llm.getFeatures('smart')).toMatchObject({
      functions: true,
      asyncTools: true,
      reasoningUpdates: true,
    });
  });
  it('cancels the tool signal and never replays a cancelled call', async () => {
    const control = runControl();
    let signal: AbortSignal | undefined;
    const handler = vi.fn(async (_args, extra) => {
      signal = extra?.abortSignal;
      control.abort();
      signal?.throwIfAborted();
      return 'unexpected';
    });
    const lookup = fn('lookup')
      .description('Lookup')
      .execution('background')
      .handler(handler)
      .build();
    const fetch = vi.fn(async () =>
      stream([
        { type: 'response.output_item.done', item: toolItem() },
        completed('r1', [toolItem()]),
      ])
    );
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: { fetch },
    });
    await expect(
      ax('question -> answer', { functions: [lookup] }).forward(
        llm,
        { question: 'lookup' },
        { control }
      )
    ).rejects.toThrow();
    expect(signal?.aborted).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails a disconnected response without replaying completed tool calls', async () => {
    const handler = vi.fn(() => 42);
    const lookup = fn('lookup')
      .description('Lookup')
      .execution('background')
      .handler(handler)
      .build();
    const fetch = vi.fn(async () =>
      stream([{ type: 'response.output_item.done', item: toolItem() }])
    );
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: { fetch },
    });
    await expect(
      ax('question -> answer', { functions: [lookup] }).forward(llm, {
        question: 'lookup',
      })
    ).rejects.toThrow(/closed before completion/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('uses the ordinary tool loop with an explicit opt-out', async () => {
    const llm = ai({ name: 'openai', apiKey: 'test', config: { model } });
    const open = vi.spyOn(llm, 'openChatSession');
    vi.spyOn(llm, 'chat').mockResolvedValue({
      results: [{ index: 0, content: 'Answer: ordinary' }],
    });
    const lookup = fn('lookup')
      .description('Lookup')
      .execution('background')
      .handler(() => 42)
      .build();
    const result = await ax('question -> answer', {
      functions: [lookup],
    }).forward(llm, { question: 'hi' }, { asyncMode: 'off' });
    expect(result.answer).toBe('ordinary');
    expect(open).not.toHaveBeenCalled();
  });

  it('emits only final validated output from streamingForward', async () => {
    let requests = 0;
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async () =>
          stream(
            ++requests === 1
              ? [
                  { type: 'response.output_item.done', item: toolItem() },
                  completed('r1', [toolItem(), answer('provisional')]),
                ]
              : [completed('r2', [answer('final result')])]
          ),
      },
    });
    const lookup = fn('lookup')
      .description('Lookup')
      .execution('background')
      .handler(() => 42)
      .build();
    const program = ax('question -> answer', { functions: [lookup] });
    const chunks = [];
    for await (const chunk of program.streamingForward(llm, { question: 'hi' }))
      chunks.push(chunk);
    expect(JSON.stringify(chunks)).not.toContain('provisional');
    expect(chunks.map((chunk) => chunk.delta.answer ?? '').join('')).toBe(
      'final result'
    );
  });
  it('defers finalization until the model has incorporated background results', async () => {
    const finish = vi.fn(() => 'done');
    const requests: any[] = [];
    const lookup = fn('lookup')
      .description('Lookup')
      .execution('background')
      .handler(async () => {
        await Promise.resolve();
        return 42;
      })
      .build();
    const done = fn('finish')
      .description('Finish after incorporating results')
      .handler(finish)
      .build();
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          return stream(
            requests.length === 1
              ? [
                  { type: 'response.output_item.done', item: toolItem() },
                  completed('r1', [toolItem(), toolItem('finish1', 'finish')]),
                ]
              : [completed('r2', [toolItem('finish2', 'finish')])]
          );
        },
      },
    });
    await ax('question -> answer?:string', {
      functions: [lookup, done],
    }).forward(
      llm,
      { question: 'Lookup then finish' },
      { stopFunction: 'finish' }
    );
    expect(finish).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[1].input).toContainEqual(
      expect.objectContaining({
        call_id: 'finish1',
        output: expect.stringContaining('Not executed'),
      })
    );
  });

  it('streams provisional output while work is pending and replaces it with a final version', async () => {
    const release = deferred();
    let pending = false;
    let requests = 0;
    const lookup = fn('lookup')
      .description('Lookup')
      .execution('background')
      .handler(async () => {
        pending = true;
        await release.promise;
        pending = false;
        return 42;
      })
      .build();
    const llm = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async () =>
          stream(
            ++requests === 1
              ? [
                  {
                    type: 'response.created',
                    response: { id: 'r1', model, output: [] },
                  },
                  { type: 'response.output_item.done', item: toolItem() },
                  {
                    type: 'response.output_text.delta',
                    delta: 'Answer: Working on the lookup.',
                  },
                  completed('r1', [
                    toolItem(),
                    answer('Working on the lookup.'),
                  ]),
                ]
              : [completed('r2', [answer('The final result is 42')])]
          ),
      },
    });
    const iterator = ax('question -> answer', {
      functions: [lookup],
    }).streamingForward(llm, { question: 'lookup' });
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(pending).toBe(true);
    expect(first.value?.delta.answer).toBe('Working on the lookup.');
    release.resolve();
    const remaining = [];
    for await (const chunk of iterator) remaining.push(chunk);
    expect(remaining.at(-1)?.version).toBeGreaterThan(first.value!.version);
    expect(remaining.map((chunk) => chunk.delta.answer ?? '').join('')).toBe(
      'The final result is 42'
    );
  });
});

it('isolates parallel flow conversations and pending call IDs', async () => {
  const control = runControl();
  control.steer('Left-only instruction', { target: 'root/left' });
  const requests: any[] = [];
  const handler = vi.fn(async () => 42);
  const lookup = fn('lookup')
    .description('Get a value')
    .execution('background')
    .handler(handler)
    .build();
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        if (body.previous_response_id)
          return stream([
            completed(`${body.previous_response_id}_final`, [
              answer(body.previous_response_id),
            ]),
          ]);
        const id = JSON.stringify(body.input).includes('left question')
          ? 'left'
          : 'right';
        // Deliberately use the same call ID in separate conversations.
        return stream([
          { type: 'response.created', response: { id, model, output: [] } },
          { type: 'response.output_item.done', item: toolItem() },
          completed(id, [toolItem()]),
        ]);
      },
    },
  });
  const wf = flow<{ question: string }>()
    .node('left', ax('question -> answer', { functions: [lookup] }))
    .node('right', ax('question -> answer', { functions: [lookup] }))
    .parallel([
      (sub) => sub.execute('left', () => ({ question: 'left question' })),
      (sub) => sub.execute('right', () => ({ question: 'right question' })),
    ])
    .merge('answers', (left, right) => [
      left.leftResult.answer,
      right.rightResult.answer,
    ]);
  const result = await wf.forward(llm, { question: 'go' }, { control });
  expect(result.answers).toEqual(['left', 'right']);
  expect(handler).toHaveBeenCalledTimes(2);
  expect(
    requests
      .filter((r) => r.previous_response_id)
      .map((r) => r.previous_response_id)
      .sort()
  ).toEqual(['left', 'right']);
  const forNode = (id: string) =>
    requests.filter(
      (r) =>
        r.previous_response_id === id ||
        (!r.previous_response_id &&
          JSON.stringify(r.input).includes(`${id} question`))
    );
  expect(JSON.stringify(forNode('left'))).toContain('Left-only instruction');
  expect(JSON.stringify(forNode('right'))).not.toContain(
    'Left-only instruction'
  );
});

it.each([true, false])(
  'pins a mixed balancer before selecting async behavior (native=%s)',
  async (nativeFirst) => {
    let nativeRequests = 0;
    const native = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async () =>
          stream([
            completed(
              `r${++nativeRequests}`,
              nativeRequests === 1 ? [toolItem()] : [answer('native')]
            ),
          ]),
      },
    });
    let legacyRequests = 0;
    const legacy = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () =>
        ++legacyRequests === 1
          ? {
              results: [
                {
                  index: 0,
                  finishReason: 'function_call',
                  functionCalls: [
                    {
                      id: 'call1',
                      type: 'function',
                      function: { name: 'lookup', params: {} },
                    },
                  ],
                },
              ],
            }
          : { results: [{ index: 0, content: 'Answer: legacy' }] },
    });
    vi.spyOn(native, 'getModelList').mockReturnValue(undefined);
    const open = vi.spyOn(native, 'openChatSession');
    const handler = vi.fn(() => 42);
    const llm = new AxBalancer(
      nativeFirst ? [native, legacy] : [legacy, native],
      { comparator: AxBalancer.inputOrderComparator }
    );
    const lookup = fn('lookup')
      .description('Get a value')
      .execution('background')
      .handler(handler)
      .build();
    const result = await ax('question -> answer', {
      functions: [lookup],
    }).forward(llm, { question: 'look up the value' });
    expect(result.answer).toBe(nativeFirst ? 'native' : 'legacy');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(nativeFirst ? 1 : 0);
    expect(nativeRequests).toBe(nativeFirst ? 2 : 0);
    expect(legacyRequests).toBe(nativeFirst ? 0 : 2);
  }
);

it('cancels promptly while waiting for a non-cooperative background tool', async () => {
  const started = deferred();
  const release = deferred();
  const control = runControl();
  let signal: AbortSignal | undefined;
  const handler = vi.fn(async (_args, extra) => {
    signal = extra?.abortSignal;
    started.resolve();
    await release.promise;
    return 42;
  });
  const lookup = fn('lookup')
    .description('Lookup')
    .execution('background')
    .handler(handler)
    .build();
  const fetch = vi.fn(async () =>
    stream([
      { type: 'response.output_item.done', item: toolItem() },
      completed('r1', [toolItem(), answer('provisional')]),
    ])
  );
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: { fetch },
  });
  const run = ax('question -> answer', { functions: [lookup] })
    .forward(llm, { question: 'lookup' }, { control })
    .then(
      () => 'success',
      (error) => String(error)
    );
  await started.promise;
  // Let the consumer reach the result wait after the completed response.
  await new Promise((resolve) => setTimeout(resolve, 10));
  control.abort();
  const outcome = await Promise.race([
    run,
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 100)),
  ]);
  release.resolve();
  await run;
  expect(outcome).not.toBe('hung');
  expect(outcome).toContain('call1');
  expect(signal?.aborted).toBe(true);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reports a transport failure while a non-cooperative tool is pending', async () => {
  const started = deferred();
  const release = deferred();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const lookup = fn('lookup')
    .description('Lookup')
    .execution('background')
    .handler(async () => {
      started.resolve();
      await release.promise;
      return 42;
    })
    .build();
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: {
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              source = controller;
              for (const event of [
                { type: 'response.output_item.done', item: toolItem() },
                completed('r1', [toolItem()]),
              ])
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
                );
            },
          })
        ),
    },
  });
  const run = ax('question -> answer', { functions: [lookup] })
    .forward(llm, { question: 'lookup' })
    .then(
      () => 'success',
      (error) => String(error)
    );
  await started.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  source.error(new Error('Connection lost after response'));
  const outcome = await Promise.race([
    run,
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 100)),
  ]);
  release.resolve();
  await run;
  expect(outcome).toContain('Connection lost after response');
  expect(outcome).toContain('call1');
});

it('enforces streaming assertions before exposing session output and retries safely', async () => {
  let requests = 0;
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: {
      fetch: async () => {
        const text = ++requests === 1 ? 'forbidden' : 'safe';
        return stream([
          {
            type: 'response.created',
            response: { id: `r${requests}`, model, output: [] },
          },
          { type: 'response.output_text.delta', delta: `Answer: ${text}` },
          completed(`r${requests}`, [answer(text)]),
        ]);
      },
    },
  });
  const gen = ax('question -> answer');
  gen.addStreamingAssert(
    'answer',
    (text) => !text.includes('forbidden'),
    'Forbidden text'
  );
  const outputs: string[] = [];
  for await (const chunk of gen.streamingForward(
    llm,
    { question: 'hello' },
    { control: runControl() }
  ))
    outputs.push(String(chunk.delta.answer ?? ''));
  expect(outputs.join('')).toBe('safe');
  expect(requests).toBe(2);
});

it('does not retry tool work after a mid-stream assertion fails', async () => {
  const release = deferred();
  let signal: AbortSignal | undefined;
  const handler = vi.fn(async (_args, extra) => {
    signal = extra?.abortSignal;
    await release.promise;
    return 42;
  });
  const lookup = fn('lookup')
    .description('Lookup')
    .execution('background')
    .handler(handler)
    .build();
  const fetch = vi.fn(async () =>
    stream([
      { type: 'response.created', response: { id: 'r1', model, output: [] } },
      { type: 'response.output_item.done', item: toolItem() },
      { type: 'response.output_text.delta', delta: 'Answer: forbidden' },
      completed('r1', [toolItem(), answer('forbidden')]),
    ])
  );
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: { fetch },
  });
  const gen = ax('question -> answer', { functions: [lookup] });
  gen.addStreamingAssert(
    'answer',
    (text) => !text.includes('forbidden'),
    'Forbidden text'
  );
  const consume = async () => {
    for await (const _chunk of gen.streamingForward(llm, {
      question: 'lookup',
    })) {
      /* must fail before emitting */
    }
  };
  try {
    await expect(consume()).rejects.toThrow(/call1/);
  } finally {
    release.resolve();
  }
  expect(handler).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(signal?.aborted).toBe(true);
});

it('continues when steering reports pending input after the response boundary', async () => {
  const continuation = deferred();
  const control = runControl();
  const calls: string[] = [];
  let steered = false;
  control.onEvent((event) => {
    if (event.type === 'model.output' && !steered) {
      steered = true;
      control.steer('Use the updated instructions');
    }
  });
  const llm = ai({ name: 'openai', apiKey: 'test', config: { model } });
  const session = {
    model,
    signal: control.signal,
    async *events() {
      yield {
        type: 'response' as const,
        responseId: 'r1',
        response: { results: [{ index: 0, content: 'Answer: Working' }] },
      };
      yield {
        type: 'tool.call' as const,
        responseId: 'r1',
        call: {
          id: 'call1',
          type: 'function' as const,
          function: { name: 'lookup', params: '{}' },
        },
      };
      yield {
        type: 'response.completed' as const,
        responseId: 'r1',
        response: {
          results: [
            {
              index: 0,
              functionCalls: [
                {
                  id: 'call1',
                  type: 'function' as const,
                  function: { name: 'lookup', params: '{}' },
                },
              ],
            },
          ],
        },
      };
      yield {
        type: 'steering' as const,
        status: 'pending' as const,
        responseId: 'r1',
      };
      await continuation.promise;
      control.signal.throwIfAborted();
      yield {
        type: 'response.completed' as const,
        responseId: 'r2',
        response: {
          results: [{ index: 0, content: 'Answer: Updated result is 42' }],
        },
      };
    },
    submitToolResults: async () => {
      calls.push('results');
    },
    continue: async () => {
      calls.push('continue');
      continuation.resolve();
    },
    steer: async () => 'native' as const,
    setThinkingTokenBudget: async () => 'next-response' as const,
    close() {},
  };
  vi.spyOn(llm, 'openChatSession').mockResolvedValue(session);
  const lookup = fn('lookup')
    .description('Lookup')
    .execution('background')
    .handler(() => 42)
    .build();
  const run = ax('question -> answer', { functions: [lookup] })
    .forward(llm, { question: 'lookup' }, { control })
    .then(
      (result) => result.answer,
      (error) => String(error)
    );
  const outcome = await Promise.race([
    run,
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 100)),
  ]);
  if (outcome === 'hung') control.abort();
  continuation.resolve();
  await run;
  expect(outcome).toBe('Updated result is 42');
  expect(calls).toEqual(['results', 'continue']);
});

it('does not report updates queued during a request as already applied', async () => {
  const control = runControl();
  control.steer('First update');
  let requests = 0;
  const applied: { id?: number; request: number }[] = [];
  control.onEvent((event) => {
    if (event.type === 'applied')
      applied.push({ id: event.updateId, request: requests });
  });
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: {
      fetch: async () => {
        requests++;
        if (requests === 2)
          control.steer('Queued after the second request was sent');
        return stream([completed(`r${requests}`, [answer('done')])]);
      },
    },
  });
  await ax('question -> answer').forward(
    llm,
    { question: 'hello' },
    { control }
  );
  expect(requests).toBe(3);
  expect(applied).toEqual([
    { id: 1, request: 2 },
    { id: 2, request: 3 },
  ]);
});
