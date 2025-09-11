import { describe, expect, it, vi } from 'vitest';
import { AxAIGoogleGeminiModel } from '../ai/google-gemini/types.js';
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

describe('ax.forward with Google Gemini merges per-key options and config', () => {
  it('merges thinkingTokenBudget and modelConfig from models[key] when selecting model key', async () => {
    const llm = ai({
      name: 'google-gemini',
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [
        {
          key: 'key1',
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          description: 'preset with thinking+config',
          // Provider-specific config that should be normalized into modelConfig and per-model options
          config: {
            maxTokens: 1234,
            temperature: 0.3,
            thinking: {
              thinkingTokenBudget: 1000, // maps ~ to 'low' level (≈800 default)
              includeThoughts: true,
            },
          },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
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

    // Validate merged request body
    const reqBody = capture.lastBody;
    expect(reqBody?.generationConfig).toBeDefined();
    expect(reqBody.generationConfig.maxOutputTokens).toBe(1234);
    // Temperature maps directly
    expect(reqBody.generationConfig.temperature).toBeCloseTo(0.3, 5);

    // Thinking config merged from per-key options (numeric -> nearest level)
    expect(reqBody.generationConfig.thinkingConfig).toBeDefined();
    // With default Gemini levels, 1000 maps to the 'low' level (~800)
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingBudget
    ).toBeGreaterThan(600);
    expect(reqBody.generationConfig.thinkingConfig.thinkingBudget).toBeLessThan(
      1400
    );
    // includeThoughts should reflect mapped showThoughts (true) when not overridden
    expect(reqBody.generationConfig.thinkingConfig.includeThoughts).toBe(true);
  });
});

