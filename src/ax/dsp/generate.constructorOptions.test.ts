import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';
import { AxGen } from './generate.js';
import { runControl } from './runControl.js';

type Seen = {
  req: Readonly<AxChatRequest<unknown>>;
  options: Record<string, unknown> | undefined;
};

const answer = (content: string): AxChatResponse => ({
  results: [{ index: 0, content, finishReason: 'stop' }],
});

// A mock AI that records each chat call and plays the answers in order,
// repeating the last one.
const recordingAI = (answers: AxChatResponse[] = [answer('Answer: ok')]) => {
  const seen: Seen[] = [];
  const ai = new AxMockAIService({
    features: { functions: true, streaming: false },
    chatResponse: async (req, options) => {
      seen.push({
        req,
        options: options as Record<string, unknown> | undefined,
      });
      return answers[Math.min(seen.length - 1, answers.length - 1)]!;
    },
  });
  return { ai, seen };
};

describe('AxGen constructor options are defaults for each forward', () => {
  it('uses the constructor model unless the call names one', async () => {
    const { ai, seen } = recordingAI();
    const gen = new AxGen('question:string -> answer:string', {
      model: 'constructor-model',
    });
    await gen.forward(ai, { question: 'q' });
    await gen.forward(ai, { question: 'q' }, { model: 'call-model' });
    expect(seen.map(({ req }) => req.model)).toEqual([
      'constructor-model',
      'call-model',
    ]);
  });

  it('merges the constructor and call modelConfig key by key', async () => {
    const { ai, seen } = recordingAI();
    const gen = new AxGen('question:string -> answer:string', {
      modelConfig: { temperature: 0.2, maxTokens: 100 },
    });
    await gen.forward(ai, { question: 'q' });
    await gen.forward(
      ai,
      { question: 'q' },
      { modelConfig: { maxTokens: 500 } }
    );
    await gen.forward(
      ai,
      { question: 'q' },
      { modelConfig: { temperature: 0.9 } }
    );
    expect(seen[0]!.req.modelConfig).toMatchObject({
      temperature: 0.2,
      maxTokens: 100,
    });
    expect(seen[1]!.req.modelConfig).toMatchObject({
      temperature: 0.2,
      maxTokens: 500,
    });
    expect(seen[2]!.req.modelConfig).toMatchObject({
      temperature: 0.9,
      maxTokens: 100,
    });
  });

  it('requests the constructor sampleCount', async () => {
    const { ai, seen } = recordingAI([
      {
        results: [
          { index: 0, content: 'Answer: a', finishReason: 'stop' },
          { index: 1, content: 'Answer: b', finishReason: 'stop' },
        ],
      },
    ]);
    const gen = new AxGen('question:string -> answer:string', {
      sampleCount: 2,
    });
    await gen.forward(ai, { question: 'q' });
    expect(seen[0]!.req.modelConfig?.n).toBe(2);
  });

  it('asks for thoughts with the constructor showThoughts', async () => {
    const { ai, seen } = recordingAI();
    const gen = new AxGen('question:string -> answer:string', {
      showThoughts: true,
    });
    await gen.forward(ai, { question: 'q' });
    expect(seen[0]!.options?.showThoughts).toBe(true);
  });

  it('sends the constructor thinkingTokenBudget', async () => {
    const { ai, seen } = recordingAI();
    const gen = new AxGen('question:string -> answer:string', {
      thinkingTokenBudget: 'low',
    });
    await gen.forward(ai, { question: 'q' });
    expect(seen[0]!.options?.thinkingTokenBudget).toBe('low');
  });

  it('runs the constructor stepHooks', async () => {
    const { ai } = recordingAI();
    const beforeStep = vi.fn();
    const gen = new AxGen('question:string -> answer:string', {
      stepHooks: { beforeStep },
    });
    await gen.forward(ai, { question: 'q' });
    expect(beforeStep).toHaveBeenCalled();
  });

  it('reports tool calls to the constructor onFunctionCall', async () => {
    const { ai } = recordingAI([
      {
        results: [
          {
            index: 0,
            functionCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', params: '{"key":"a"}' },
              },
            ],
            finishReason: 'function_call',
          },
        ],
      },
      answer('Answer: green'),
    ]);
    const onFunctionCall = vi.fn();
    const gen = new AxGen('question:string -> answer:string', {
      functions: [
        {
          name: 'lookup',
          description: 'Look up a key',
          parameters: {
            type: 'object',
            properties: { key: { type: 'string', description: 'The key' } },
          },
          func: async () => 'green',
        },
      ],
      onFunctionCall,
    });
    await gen.forward(ai, { question: 'q' });
    expect(onFunctionCall).toHaveBeenCalled();
  });

  it('keeps corrections in memory with the constructor disableMemoryCleanup', async () => {
    const historyAfterRetry = async (disableMemoryCleanup: boolean) => {
      const mem = new AxMemory();
      const { ai } = recordingAI([
        answer('Answer: x\nScore: nope'),
        answer('Answer: x\nScore: 1'),
      ]);
      const gen = new AxGen('question:string -> answer:string, score:number', {
        mem,
        disableMemoryCleanup,
      });
      await gen.forward(ai, { question: 'q' });
      return mem.history(0).length;
    };
    expect(await historyAfterRetry(true)).toBeGreaterThan(
      await historyAfterRetry(false)
    );
  });

  it('adds the tuning function with the constructor selfTuning', async () => {
    let functionNames: string[] = [];
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      models: [
        { key: 'fast', model: 'fast-model', description: 'Quick' },
        { key: 'smart', model: 'smart-model', description: 'Balanced' },
      ],
      chatResponse: async (req) => {
        functionNames = req.functions?.map((f) => f.name) ?? [];
        return answer('Answer: ok');
      },
    });
    const gen = new AxGen('question:string -> answer:string', {
      selfTuning: true,
    });
    await gen.forward(ai as never, { question: 'q' });
    expect(functionNames).toContain('adjustGeneration');
  });

  it('passes the constructor asyncMode to the service', async () => {
    const { ai, seen } = recordingAI();
    const gen = new AxGen('question:string -> answer:string', {
      asyncMode: 'off',
    });
    await gen.forward(ai, { question: 'q' });
    expect(seen[0]!.options?.asyncMode).toBe('off');
  });

  it('picks with the constructor resultPicker', async () => {
    const { ai } = recordingAI([
      {
        results: [
          { index: 0, content: 'Answer: a', finishReason: 'stop' },
          { index: 1, content: 'Answer: b', finishReason: 'stop' },
        ],
      },
    ]);
    const resultPicker = vi.fn(async () => 1);
    const gen = new AxGen('question:string -> answer:string', {
      resultPicker,
    });
    const output = await gen.forward(ai, { question: 'q' }, { sampleCount: 2 });
    expect(resultPicker).toHaveBeenCalled();
    expect(output).toEqual({ answer: 'b' });
  });
});

describe('AxGen constructor run and service options are defaults for each forward', () => {
  // Each option is passed to ai.chat from the constructor, and a value the
  // call gives wins.
  const passedToChat: [string, unknown, unknown][] = [
    ['stream', true, false],
    ['sessionId', 'constructor-session', 'call-session'],
    ['timeout', 1234, 5678],
    ['executionPath', 'root/constructor', 'root/call'],
    ['serviceTier', 'flex', 'priority'],
    ['verbose', true, false],
    ['beta', true, false],
    ['corsProxy', 'https://constructor.proxy', 'https://call.proxy'],
    ['includeRequestBodyInErrors', true, false],
    ['promptCacheRetention', '24h', 'in_memory'],
    ['excludeContentFromTrace', true, false],
  ];
  for (const [key, constructorValue, callValue] of passedToChat) {
    it(`passes the constructor ${key} to the service unless the call sets one`, async () => {
      const { ai, seen } = recordingAI();
      const gen = new AxGen('question:string -> answer:string', {
        [key]: constructorValue,
      } as never);
      await gen.forward(ai, { question: 'q' });
      await gen.forward(ai, { question: 'q' }, { [key]: callValue } as never);
      expect(seen.map(({ options }) => options?.[key])).toEqual([
        constructorValue,
        callValue,
      ]);
    });
  }

  it('passes the constructor fetch and webSocket to the service', async () => {
    const { ai, seen } = recordingAI();
    const fetchFn = (async () => new Response('{}')) as typeof fetch;
    const webSocket = { name: 'constructor socket' };
    const gen = new AxGen('question:string -> answer:string', {
      fetch: fetchFn,
      webSocket,
    });
    await gen.forward(ai, { question: 'q' });
    expect(seen[0]!.options?.fetch).toBe(fetchFn);
    expect(seen[0]!.options?.webSocket).toBe(webSocket);
  });

  it('merges the constructor and call customLabels key by key', async () => {
    const { ai, seen } = recordingAI();
    const gen = new AxGen('question:string -> answer:string', {
      customLabels: { team: 'search', tier: 'free' },
    });
    await gen.forward(ai, { question: 'q' });
    await gen.forward(ai, { question: 'q' }, { customLabels: { tier: 'pro' } });
    expect(seen.map(({ options }) => options?.customLabels)).toEqual([
      { team: 'search', tier: 'free' },
      { team: 'search', tier: 'pro' },
    ]);
  });

  it('runs under the constructor control and skips the cache', async () => {
    const { ai } = recordingAI();
    const control = runControl();
    const events: string[] = [];
    control.onEvent((event) => events.push(event.type));
    const cachingFunction = vi.fn(async () => undefined);
    const gen = new AxGen('question:string -> answer:string', {
      control,
      cachingFunction,
    });
    await gen.forward(ai, { question: 'q' });
    expect(events).toEqual(['started', 'completed']);
    expect(cachingFunction).not.toHaveBeenCalled();
  });

  it('stops on the constructor abortSignal unless the call gives its own', async () => {
    const { ai, seen } = recordingAI();
    const controller = new AbortController();
    controller.abort('constructor abort');
    const gen = new AxGen('question:string -> answer:string', {
      abortSignal: controller.signal,
    });
    await expect(gen.forward(ai, { question: 'q' })).rejects.toThrow(
      'constructor abort'
    );
    expect(seen).toHaveLength(0);
    const output = await gen.forward(
      ai,
      { question: 'q' },
      { abortSignal: new AbortController().signal }
    );
    expect(output).toEqual({ answer: 'ok' });
  });

  it('starts its span under the constructor traceContext', async () => {
    const { ai } = recordingAI();
    const parents: unknown[] = [];
    const span = {
      setAttributes() {},
      setAttribute() {},
      addEvent() {},
      recordException() {},
      setStatus() {},
      end() {},
      isRecording: () => true,
      spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
      updateName() {},
    };
    const tracer = {
      startSpan: (_name: string, _options: unknown, parent: unknown) => {
        parents.push(parent);
        return span;
      },
      startActiveSpan: (...args: any[]) => args[args.length - 1](span),
    };
    const traceContext = {
      getValue: () => undefined,
      setValue() {
        return this;
      },
      deleteValue() {
        return this;
      },
    };
    const gen = new AxGen('question:string -> answer:string', {
      tracer: tracer as never,
      traceContext: traceContext as never,
    });
    await gen.forward(ai, { question: 'q' });
    expect(parents[0]).toBe(traceContext);
  });

  it('hands tools the constructor eventContext', async () => {
    const { ai } = recordingAI([
      {
        results: [
          {
            index: 0,
            content: '',
            functionCalls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'probe', params: {} },
              },
            ],
            finishReason: 'function_call',
          },
        ],
      },
      answer('Answer: ok'),
    ]);
    const eventContext = { event: 'constructor' } as never;
    let seenContext: unknown;
    const gen = new AxGen('question:string -> answer:string', {
      eventContext,
      functions: [
        {
          name: 'probe',
          description: 'Probe tool',
          parameters: { type: 'object', properties: {} },
          func: async (_args: unknown, extra?: { eventContext?: unknown }) => {
            seenContext = extra?.eventContext;
            return 'ok';
          },
        },
      ],
    });
    await gen.forward(ai, { question: 'q' });
    expect(seenContext).toBe(eventContext);
  });

  it('renders audio outputs with the constructor speech', async () => {
    const speechRequests: unknown[] = [];
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () =>
        answer('Speech: Hello there\nSummary: greeting'),
      speechResponse: (req) => {
        speechRequests.push(req);
        return { data: 'YXVkaW8=', format: 'mp3', transcript: req.text };
      },
    });
    const gen = new AxGen(
      'userQuestion:string -> speech:audio, summary:string',
      { speech: { speak: { voice: 'constructor-voice' } } } as never
    );
    await gen.forward(ai, { userQuestion: 'hi' });
    expect(speechRequests).toEqual([
      expect.objectContaining({
        voice: 'constructor-voice',
        text: 'Hello there',
      }),
    ]);
  });
});
