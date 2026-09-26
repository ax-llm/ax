import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';
import { AxGen } from './generate.js';

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
