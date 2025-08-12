import { describe, expect, it } from 'vitest';
import { AxGen } from '../dsp/generate.js';
import { AxMockAIService } from './mock/api.js';
import type { AxLoggerData } from './types.js';

describe('Logging includes usage with citations', () => {
  it('emits ChatResponseUsage with tokens and citations when debug is enabled', async () => {
    const logs: AxLoggerData[] = [];

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      options: {
        debug: true,
        logger: (m: AxLoggerData) => logs.push(m),
      },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Answer',
            citations: [{ url: 'https://site.test', title: 'Site' }],
          },
        ],
        modelUsage: {
          ai: 'Mock',
          model: 'mock-model',
          tokens: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
        },
      },
    });

    const gen = new AxGen<{ userQuestion: string }, { responseText: string }>(
      'userQuestion:string -> responseText:string'
    );
    await gen.forward(
      ai as any,
      { userQuestion: 'hi' },
      { stream: false, debug: true }
    );

    const usageLogs = logs.filter((l) => l.name === 'ChatResponseUsage');
    expect(usageLogs.length).toBeGreaterThan(0);
    const last = usageLogs.at(-1)!;
    expect(last.value.tokens?.totalTokens).toBe(5);
    expect((last.value.citations ?? []).map((c) => c.url)).toEqual([
      'https://site.test',
    ]);
  });
});
