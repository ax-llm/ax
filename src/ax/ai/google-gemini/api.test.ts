import { describe, expect, it, vi } from 'vitest';

import { AxAIGoogleGemini, axAIGoogleGeminiDefaultConfig } from './api.js';
import { AxAIGoogleGeminiModel } from './types.js';

// Utility to create a fake fetch that returns a minimal valid response and captures request body
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

describe('AxAIGoogleGemini model key preset merging', () => {
  it('merges model list item modelConfig into effective config', async () => {
    const defaultCfg = axAIGoogleGeminiDefaultConfig();

    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [
        {
          key: 'tiny',
          model: AxAIGoogleGeminiModel.Gemini25FlashLite,
          description: 'tiny',
          // provider-specific config that should map to modelConfig
          config: {
            maxTokens: 1234,
            temperature: 0.4,
            topP: 0.9,
          },
        },
      ],
    });

    // Intercept network; validate that createChatReq used merged config
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

    ai.setOptions({ fetch });

    const res = await ai.chat(
      {
        model: 'tiny',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false }
    );

    expect(res.results[0]?.content).toBe('ok');

    // Ensure the request was made; we cannot directly read internal config,
    // but we can ensure no errors and that defaults were honored for stream, etc.
    expect(fetch).toHaveBeenCalled();

    // Verify merged modelConfig via accessor
    const mc = ai.getLastUsedModelConfig();
    expect(mc?.maxTokens).toBe(1234);
    expect(mc?.temperature).toBe(0.4);
    expect(mc?.topP).toBe(0.9);

    // Sanity: defaults applied if not set
    expect(defaultCfg.model).toBe(AxAIGoogleGeminiModel.Gemini25Flash);
  });

  it('maps numeric thinkingTokenBudget in item config to per-model options and preserves explicit overrides', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [
        {
          key: 'simple',
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          description: 'simple',
          config: {
            thinking: {
              thinkingTokenBudget: 200, // should map ~ minimal level
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

    ai.setOptions({ fetch });

    // Provide explicit override for thinkingTokenBudget via options,
    // which should take precedence over preset mapping
    const res = await ai.chat(
      {
        model: 'simple',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', showThoughts: false, stream: false }
    );

    expect(res.results[0]?.content).toBe('ok');
    expect(fetch).toHaveBeenCalled();

    // Validate thinking config mapping in request body
    const reqBody = capture.lastBody;
    // medium level defaults to ~5000 per provider defaults
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingBudget
    ).toBeGreaterThan(1000);
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingLevel
    ).toBeUndefined();
    expect(reqBody.generationConfig.thinkingConfig.includeThoughts).toBe(false);
  });

  it('maps numeric thinkingTokenBudget to thinkingLevel for Gemini 3', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3ProPreview },
      models: [],
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

    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', showThoughts: false, stream: false }
    );

    const reqBody = capture.lastBody;
    expect(reqBody?.generationConfig?.thinkingConfig).toBeDefined();
    // medium level defaults to high thinking level in Gemini 3
    expect(reqBody.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingBudget
    ).toBeUndefined();
    expect(reqBody.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingBudget
    ).toBeUndefined();
  });

  it('handles function calls with thought signatures (Gemini 3)', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3ProPreview },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'foo', args: {} },
                  thoughtSignature: 'sig123',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    // 1. First turn: User asks, Model calls function with signature
    const res = await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'call foo' }],
      },
      { stream: false }
    );

    expect(res.results[0]?.functionCalls?.[0].function.name).toBe('foo');
    expect(res.results[0]?.thoughtBlock?.signature).toBe('sig123');

    // 2. Second turn: User sends function result, Model should receive signature back
    // We need to manually construct the history with the thought block from the previous result
    const history: any[] = [
      { role: 'user', content: 'call foo' },
      {
        role: 'assistant',
        functionCalls: res.results[0].functionCalls,
        thoughtBlock: res.results[0].thoughtBlock,
      },
      {
        role: 'function',
        functionId: 'foo',
        result: JSON.stringify({ ok: true }),
      },
    ];

    await ai.chat(
      {
        chatPrompt: history,
      },
      { stream: false }
    );

    const reqBody = capture.lastBody;
    // Verify the assistant message in the request contains the signature on the function call part
    const assistantMsg = reqBody.contents[1];
    expect(assistantMsg.role).toBe('model');
    expect(assistantMsg.parts[0].functionCall.name).toBe('foo');
    expect(assistantMsg.parts[0].thoughtSignature).toBe('sig123');
  });
});
