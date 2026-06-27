import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction } from '../ai/types.js';
import { f } from './sig.js';
import { ax } from './template.js';

/**
 * End-to-end coverage for the unknown-tool hardening (Fix 2): a hallucinated
 * tool name is surfaced as a recoverable ValidationError, so the generate retry
 * loop feeds a correction back to the model and the run recovers instead of
 * hard-aborting.
 */
describe('Unknown function-call recovery', () => {
  const knownTool: AxFunction = {
    name: 'knownTool',
    description: 'A known tool',
    parameters: {
      type: 'object',
      properties: { q: { type: 'string', description: 'query' } },
      required: ['q'],
    },
    func: async () => 'tool-result',
  };

  it('recovers from a hallucinated tool name by retrying instead of aborting', async () => {
    const sig = f()
      .input('question', f.string())
      .output('answer', f.string())
      .build();
    const gen = ax(sig);

    let calls = 0;
    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: false },
    });
    mockAI.chat = async () => {
      calls++;
      if (calls === 1) {
        // The model hallucinates a tool that was never registered.
        return {
          results: [
            {
              index: 0,
              functionCalls: [
                {
                  id: '1',
                  type: 'function' as const,
                  function: { name: 'list_dir', params: '{}' },
                },
              ],
              finishReason: 'stop' as const,
            },
          ],
        };
      }
      // After the corrective retry, it produces a valid answer.
      return {
        results: [
          { index: 0, content: 'Answer: 42', finishReason: 'stop' as const },
        ],
      };
    };

    const result = await gen.forward(
      mockAI,
      { question: 'x' },
      { functions: [knownTool] }
    );

    expect(result.answer).toBe('42');
    // Recovered via at least one corrective retry rather than aborting.
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
