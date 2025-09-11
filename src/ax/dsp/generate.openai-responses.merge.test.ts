import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAIResponsesModel } from '../ai/openai/responses_types.js';
import { ai, ax } from '../index.js';

function createMockFetch(body: unknown, capture: { lastBody?: any }) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (init?.body && typeof init.body === 'string') {
          capture.lastBody = JSON.parse(init.body);
        }
      } catch {}
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

describe('ax.forward with OpenAI Responses merges per-key options and config', () => {
  it('merges modelConfig and thinkingTokenBudget mapping via model key', async () => {
    const llm = ai({
      name: 'openai-responses',
      apiKey: 'key',
      // Global config that should be overridden by per-key mapping
      config: {
        model: AxAIOpenAIResponsesModel.GPT5Responses,
        reasoningEffort: 'minimal',
        reasoningSummary: 'concise',
      },
      models: [
        {
          key: 'key1',
          model: AxAIOpenAIResponsesModel.O3, // thinking model
          description: 'o3 responses preset',
          config: {
            maxTokens: 1111,
            temperature: 0.25,
            thinking: {
              thinkingTokenBudget: 800, // -> 'medium' effort per mapping
            },
          },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        id: 'resp_1',
        object: 'response',
        created: 0,
        model: 'o3',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        status: 'completed',
      },
      capture
    );

    llm.setOptions({ fetch });

    const gen = ax('userQuestion:string -> responseText:string');

    const out = await gen.forward(
      llm,
      { userQuestion: 'hi' },
      { model: 'key1', stream: false }
    );

    expect(typeof out.responseText === 'string').toBe(true);
    expect(fetch).toHaveBeenCalled();

    const reqBody = capture.lastBody;
    expect(reqBody).toBeDefined();
    expect(reqBody.model).toBe('o3');
    // Expect reasoning.effort mapped for responses API
    expect(reqBody.reasoning?.effort).toBeDefined();
    expect(reqBody.reasoning.effort).toBe('medium');
  });
});
