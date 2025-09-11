import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAIModel } from '../ai/openai/chat_types.js';
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

describe('ax.forward with OpenAI merges per-key options and config', () => {
  it('merges modelConfig and thinkingTokenBudget mapping via model key', async () => {
    const llm = ai({
      name: 'openai',
      apiKey: 'key',
      // Global config that should be overridden by per-key mapping
      config: { model: AxAIOpenAIModel.GPT5Chat, reasoningEffort: 'minimal' },
      models: [
        {
          key: 'key1',
          model: AxAIOpenAIModel.O3Mini, // a thinking model where reasoning_effort applies
          description: 'o3-mini preset with config',
          // Provider-specific config that should be normalized into modelConfig and per-model options
          config: {
            maxTokens: 2222,
            temperature: 0.2,
            thinking: {
              thinkingTokenBudget: 800, // maps to 'low' -> reasoning_effort 'medium'
            },
          },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        id: 'id',
        object: 'chat.completion',
        created: 0,
        model: 'o3-mini',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
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
    // For non-thinking request parts, temperature may be omitted for thinking models; max tokens maps to max_completion_tokens when applicable
    // We assert model was applied and reasoning_effort present per mapping
    expect(reqBody.model).toBe('o3-mini');
    // thinkingTokenBudget low -> reasoning_effort 'medium' for OpenAI chat
    expect(
      reqBody.reasoning_effort === 'medium' ||
        reqBody.reasoning?.effort === 'medium'
    ).toBe(true);
  });
});
