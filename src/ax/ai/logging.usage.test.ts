import { describe, expect, it } from 'vitest';
import { AxGen } from '../dsp/generate.js';
import { AxMockAIService } from './mock/api.js';
import type { AxLoggerData } from './types.js';

describe('Logging includes usage with citations', () => {
  it('emits ChatResponseUsage and ChatResponseCitations when debug is enabled', async () => {
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

    // Check ChatResponseUsage event (without citations)
    const usageLogs = logs.filter((l) => l.name === 'ChatResponseUsage');
    expect(usageLogs.length).toBeGreaterThan(0);
    const lastUsage = usageLogs.at(-1)!;
    expect(lastUsage.value.tokens?.totalTokens).toBe(5);
    expect(lastUsage.value.citations).toBeUndefined();

    // Check ChatResponseCitations event
    const citationLogs = logs.filter((l) => l.name === 'ChatResponseCitations');
    expect(citationLogs.length).toBeGreaterThan(0);
    const lastCitation = citationLogs.at(-1)!;
    expect(lastCitation.value.map((c) => c.url)).toEqual(['https://site.test']);
  });
});
