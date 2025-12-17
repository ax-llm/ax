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
      config: { model: AxAIGoogleGeminiModel.Gemini3Pro },
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
      config: { model: AxAIGoogleGeminiModel.Gemini3Pro },
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
    expect(res.results[0]?.thoughtBlocks?.[0]?.signature).toBe('sig123');

    // 2. Second turn: User sends function result, Model should receive signature back
    // We need to manually construct the history with the thought blocks from the previous result
    const history: any[] = [
      { role: 'user', content: 'call foo' },
      {
        role: 'assistant',
        functionCalls: res.results[0].functionCalls,
        thoughtBlocks: res.results[0].thoughtBlocks,
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
    expect(assistantMsg.parts[0].thought_signature).toBe('sig123');
  });

  it('groups parallel function responses into a single user turn', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3Pro },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
      capture
    );
    ai.setOptions({ fetch });

    const history: any[] = [
      { role: 'user', content: 'call parallel' },
      {
        role: 'assistant',
        functionCalls: [
          {
            function: { name: 'f1', params: '{}' },
            id: 'id1',
            type: 'function',
          },
          {
            function: { name: 'f2', params: '{}' },
            id: 'id2',
            type: 'function',
          },
        ],
      },
      { role: 'function', functionId: 'f1', result: 'r1' },
      { role: 'function', functionId: 'f2', result: 'r2' },
    ];

    await ai.chat({ chatPrompt: history }, { stream: false });

    const reqBody = capture.lastBody;
    // Expected: User, Model, User (with 2 parts)
    expect(reqBody.contents).toHaveLength(3);
    const lastUserMsg = reqBody.contents[2];
    expect(lastUserMsg.role).toBe('user');
    expect(lastUserMsg.parts).toHaveLength(2);
    expect(lastUserMsg.parts[0].functionResponse.name).toBe('f1');
    expect(lastUserMsg.parts[1].functionResponse.name).toBe('f2');
  });

  it('does not set thought: true on text part when function calls are present', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3Pro },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      },
      capture
    );
    ai.setOptions({ fetch });

    const history: any[] = [
      { role: 'user', content: 'call with thought' },
      {
        role: 'assistant',
        thoughtBlocks: [
          { data: 'Thinking...', encrypted: false, signature: 'sig1' },
        ],
        functionCalls: [
          {
            function: { name: 'f1', params: '{}' },
            id: 'id1',
            type: 'function',
          },
        ],
      },
      { role: 'function', functionId: 'f1', result: 'r1' },
    ];

    await ai.chat({ chatPrompt: history }, { stream: false });

    const reqBody = capture.lastBody;
    const assistantMsg = reqBody.contents[1];
    expect(assistantMsg.role).toBe('model');
    expect(assistantMsg.parts).toHaveLength(2);

    // Part 0: Text (Thought) - Should NOT have thought: true
    expect(assistantMsg.parts[0].text).toBe('Thinking...');
    expect(assistantMsg.parts[0].thought).toBeUndefined();
    expect(assistantMsg.parts[0].thought_signature).toBeUndefined();

    // Part 1: Function Call - Should have signature
    expect(assistantMsg.parts[1].functionCall.name).toBe('f1');
    expect(assistantMsg.parts[1].thought_signature).toBe('sig1');
  });
});
