import { describe, expect, it, vi } from 'vitest';

import {
  AxAIGoogleGemini,
  axAIGoogleGeminiDefaultConfig,
  axAIGoogleGeminiLiveAudioDefaultConfig,
} from './api.js';
import { axIsGeminiLiveAudioModel } from './live_audio.js';
import { AxAIGoogleGeminiEmbedModel, AxAIGoogleGeminiModel } from './types.js';

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

function createSequencedMockFetch(
  bodies: unknown[],
  capture: { calls: Array<{ url: string; body?: any }> }
) {
  let index = 0;

  return vi
    .fn()
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      let body: unknown;
      try {
        if (init?.body && typeof init.body === 'string') {
          body = JSON.parse(init.body);
        }
      } catch {}

      capture.calls.push({ url: String(url), body });

      const responseBody = bodies[Math.min(index, bodies.length - 1)];
      index++;

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

class FakeGeminiLiveWebSocket {
  static serverMessages: unknown[] = [];
  static instances: FakeGeminiLiveWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<string, ((event: any) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeGeminiLiveWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== listener)
    );
  }

  send(data: string) {
    this.sent.push(data);
    const message = JSON.parse(data);

    if (message.setup) {
      queueMicrotask(() => {
        this.emit('message', { data: JSON.stringify({ setupComplete: {} }) });
      });
      return;
    }

    if (
      message.clientContent?.turnComplete === true ||
      message.realtimeInput?.audioStreamEnd === true
    ) {
      queueMicrotask(() => {
        for (const serverMessage of FakeGeminiLiveWebSocket.serverMessages) {
          this.emit('message', { data: JSON.stringify(serverMessage) });
        }
      });
    }
  }

  close() {
    this.emit('close', {});
  }

  private emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    const handler = (this as any)[`on${type}`];
    if (typeof handler === 'function') {
      handler(event);
    }
  }
}

function installFakeGeminiLiveWebSocket(messages: unknown[]) {
  const original = globalThis.WebSocket;
  FakeGeminiLiveWebSocket.serverMessages = messages;
  FakeGeminiLiveWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeGeminiLiveWebSocket;

  return () => {
    (globalThis as any).WebSocket = original;
  };
}

describe('AxAIGoogleGemini schema validation', () => {
  it('preserves strict nullable structured-output schema fields Gemini supports', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        candidates: [
          {
            content: { parts: [{ text: '{"summary":"ok"}' }] },
            finishReason: 'STOP',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'return structured data' }],
        responseFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              nickname: { type: ['string', 'null'] },
              profile: {
                type: ['object', 'null'],
                properties: {
                  age: { type: ['number', 'null'], maximum: 120 },
                },
                required: ['age'],
                additionalProperties: false,
              },
            },
            required: ['summary', 'nickname', 'profile'],
            additionalProperties: false,
          },
        },
      },
      { stream: false }
    );

    const responseSchema =
      capture.lastBody?.generationConfig?.responseJsonSchema;

    expect(capture.lastBody?.generationConfig?.responseMimeType).toBe(
      'application/json'
    );
    expect(responseSchema?.additionalProperties).toBe(false);
    expect(responseSchema?.required).toEqual([
      'summary',
      'nickname',
      'profile',
    ]);
    expect(responseSchema?.properties?.nickname?.type).toEqual([
      'string',
      'null',
    ]);
    expect(responseSchema?.properties?.profile?.type).toEqual([
      'object',
      'null',
    ]);
    expect(responseSchema?.properties?.profile?.additionalProperties).toBe(
      false
    );
    expect(responseSchema?.properties?.profile?.properties?.age?.type).toEqual([
      'number',
      'null',
    ]);
    expect(responseSchema?.properties?.profile?.properties?.age?.maximum).toBe(
      120
    );
  });
});

describe('AxAIGoogleGemini model key preset merging', () => {
  it('routes all Vertex chat requests to v1 by default, including Gemini 3.x', async () => {
    const capture: { calls: Array<{ url: string; body?: any }> } = {
      calls: [],
    };
    const fetch = createSequencedMockFetch(
      [
        {
          candidates: [
            {
              content: { parts: [{ text: 'stable ok' }] },
              finishReason: 'STOP',
            },
          ],
        },
        {
          candidates: [
            {
              content: { parts: [{ text: 'preview ok' }] },
              finishReason: 'STOP',
            },
          ],
        },
      ],
      capture
    );

    const ai = new AxAIGoogleGemini({
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [
        { key: 'stable', model: AxAIGoogleGeminiModel.Gemini25Flash },
        { key: 'preview', model: AxAIGoogleGeminiModel.Gemini31Pro },
      ],
    });

    ai.setOptions({ fetch });

    await ai.chat(
      {
        model: 'stable',
        chatPrompt: [{ role: 'user', content: 'hi stable' }],
      },
      { stream: false }
    );

    await ai.chat(
      {
        model: 'preview',
        chatPrompt: [{ role: 'user', content: 'hi preview' }],
      },
      { stream: false }
    );

    expect(capture.calls[0]?.url).toContain(
      '/v1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent'
    );
    expect(capture.calls[1]?.url).toContain(
      '/v1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview:generateContent'
    );
  });

  it('routes Vertex embedding requests for pre-3.1 models to v1', async () => {
    const capture: { calls: Array<{ url: string; body?: any }> } = {
      calls: [],
    };
    const fetch = createSequencedMockFetch(
      [
        {
          predictions: [
            {
              embeddings: {
                values: [0.1, 0.2, 0.3],
              },
            },
          ],
        },
      ],
      capture
    );

    const ai = new AxAIGoogleGemini({
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
    });

    ai.setOptions({ fetch });

    const res = await ai.embed({
      embedModel: AxAIGoogleGeminiEmbedModel.GeminiEmbedding001,
      texts: ['hello world'],
    });

    expect(res.embeddings).toEqual([[0.1, 0.2, 0.3]]);
    expect(capture.calls[0]?.url).toContain(
      '/v1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-embedding-001:predict'
    );
  });

  it('honors options.beta by routing Vertex chat requests onto v1beta1', async () => {
    const capture: { calls: Array<{ url: string; body?: any }> } = {
      calls: [],
    };
    const fetch = createSequencedMockFetch(
      [
        {
          candidates: [
            {
              content: { parts: [{ text: 'forced stable ok' }] },
              finishReason: 'STOP',
            },
          ],
        },
      ],
      capture
    );

    const ai = new AxAIGoogleGemini({
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: { model: AxAIGoogleGeminiModel.Gemini31Pro },
      options: { beta: true, fetch },
    });

    await ai.chat(
      {
        model: AxAIGoogleGeminiModel.Gemini31Pro,
        chatPrompt: [{ role: 'user', content: 'hi forced stable' }],
      },
      { stream: false }
    );

    expect(capture.calls[0]?.url).toContain(
      '/v1beta1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview:generateContent'
    );
  });

  it('honors models[].beta by routing the selected Vertex model key onto v1beta1', async () => {
    const capture: { calls: Array<{ url: string; body?: any }> } = {
      calls: [],
    };
    const fetch = createSequencedMockFetch(
      [
        {
          candidates: [
            {
              content: { parts: [{ text: 'model preset stable ok' }] },
              finishReason: 'STOP',
            },
          ],
        },
      ],
      capture
    );

    const ai = new AxAIGoogleGemini({
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [
        {
          key: 'preview-beta-path',
          model: AxAIGoogleGeminiModel.Gemini31Pro,
          description: 'Gemini 3.1 via beta path override',
          beta: true,
        },
      ],
    });

    ai.setOptions({ fetch });

    await ai.chat(
      {
        model: 'preview-beta-path',
        chatPrompt: [{ role: 'user', content: 'hi model preset beta' }],
      },
      { stream: false }
    );

    expect(capture.calls[0]?.url).toContain(
      '/v1beta1/projects/demo-project/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview:generateContent'
    );
  });

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
        responseId: 'gemini-response-123',
        modelVersion: 'gemini-test-version',
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
    expect(res.remoteId).toBe('gemini-response-123');
    expect(res.providerMetadata?.google?.modelVersion).toBe(
      'gemini-test-version'
    );

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

  it('maps thinkingTokenBudget to thinkingLevel for Gemini 3 Pro (low/high only)', async () => {
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

    // 'medium' maps to 'high' for Gemini 3 Pro (which only supports low/high)
    // Note: maxTokens cannot be set with thinkingLevel, so we don't set it
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', showThoughts: false, stream: false }
    );

    const reqBody = capture.lastBody;
    expect(reqBody?.generationConfig?.thinkingConfig).toBeDefined();
    // medium level maps to 'high' for Gemini 3 Pro
    expect(reqBody.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingBudget
    ).toBeUndefined();
  });

  it('maps thinkingTokenBudget to thinkingLevel for Gemini 3 Flash (all levels)', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3Flash },
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

    // 'medium' should stay as 'medium' for Gemini 3 Flash
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', showThoughts: false, stream: false }
    );

    const reqBody = capture.lastBody;
    expect(reqBody?.generationConfig?.thinkingConfig).toBeDefined();
    // Flash supports 'medium' directly
    expect(reqBody.generationConfig.thinkingConfig.thinkingLevel).toBe(
      'medium'
    );
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingBudget
    ).toBeUndefined();
  });

  it('throws error when maxTokens is set with thinkingLevel', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3Flash },
      models: [],
    });

    const fetch = createMockFetch(
      {
        candidates: [
          {
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
      },
      {}
    );

    ai.setOptions({ fetch });

    // Setting both thinkingTokenBudget and maxTokens should throw
    await expect(
      ai.chat(
        {
          chatPrompt: [{ role: 'user', content: 'hi' }],
          modelConfig: { maxTokens: 2000 },
        },
        { thinkingTokenBudget: 'medium', stream: false }
      )
    ).rejects.toThrow(/Cannot set maxTokens when using thinkingLevel/);
  });

  it('throws error when numeric thinkingTokenBudget is set in config for Gemini 3', () => {
    // Creating AI with numeric thinkingTokenBudget on Gemini 3 should throw
    expect(
      () =>
        new AxAIGoogleGemini({
          apiKey: 'key',
          config: {
            model: AxAIGoogleGeminiModel.Gemini3Pro,
            thinking: { thinkingTokenBudget: 5000 },
          },
        })
    ).toThrow(/do not support numeric thinkingTokenBudget/);
  });

  it('maps thinkingTokenBudget none to minimal for Gemini 3+ (includeThoughts controlled by showThoughts)', async () => {
    // Gemini 3+ models cannot fully disable thinking - 'minimal' is the lowest level
    // When 'none' is specified, we map to 'minimal'. includeThoughts is controlled separately by showThoughts option.
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini3Flash },
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

    // 'none' maps to 'minimal' for Gemini 3+
    // Note: maxTokens cannot be set because thinkingLevel is still used
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'none', stream: false }
    );

    const reqBody = capture.lastBody;
    // thinkingConfig should have thinkingLevel='minimal'
    // includeThoughts should NOT be automatically set - it's controlled by showThoughts option
    expect(reqBody?.generationConfig?.thinkingConfig?.thinkingLevel).toBe(
      'minimal'
    );
    expect(
      reqBody?.generationConfig?.thinkingConfig?.includeThoughts
    ).toBeUndefined();
  });

  it('allows thinkingTokenBudget none to disable thinking for Gemini 2.5', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
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

    // 'none' should disable thinking for Gemini 2.5 (thinkingBudget=0)
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { maxTokens: 2000 }, // Can set maxTokens when thinking is disabled
      },
      { thinkingTokenBudget: 'none', stream: false }
    );

    const reqBody = capture.lastBody;
    // thinkingConfig should have thinkingBudget=0 and includeThoughts=false
    expect(
      reqBody?.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBeUndefined();
    expect(reqBody?.generationConfig?.thinkingConfig?.thinkingBudget).toBe(0);
    expect(reqBody?.generationConfig?.thinkingConfig?.includeThoughts).toBe(
      false
    );
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

  it('ignores thinkingLevel from config for Gemini 2.5 models', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        model: AxAIGoogleGeminiModel.Gemini25Flash,
        thinking: {
          thinkingLevel: 'low', // Should be ignored for Gemini 2.5
        },
      },
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
      { stream: false }
    );

    const reqBody = capture.lastBody;
    // thinkingLevel should NOT be set for Gemini 2.5 models
    expect(
      reqBody.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBeUndefined();
  });

  it('uses custom thinkingLevelMapping at config level', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        model: AxAIGoogleGeminiModel.Gemini3Flash,
        thinkingLevelMapping: {
          minimal: 'low', // Override: minimal → low
          medium: 'high', // Override: medium → high
        },
      },
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

    // 'minimal' should now map to 'low' due to custom mapping
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'minimal', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBe('low');

    // 'medium' should now map to 'high' due to custom mapping
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBe('high');
  });

  it('uses custom thinkingLevelMapping at model key level', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        model: AxAIGoogleGeminiModel.Gemini3Flash,
        thinkingLevelMapping: {
          minimal: 'minimal',
          low: 'low',
          medium: 'medium',
          high: 'high',
          highest: 'high',
        },
      },
      models: [
        {
          key: 'fast-thinker',
          model: AxAIGoogleGeminiModel.Gemini3Flash,
          description: 'Fast with minimal thinking',
          config: {
            thinkingLevelMapping: {
              minimal: 'minimal',
              low: 'minimal', // Override: low → minimal
              medium: 'low', // Override: medium → low
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

    // 'medium' should map to 'low' for the 'fast-thinker' model key
    await ai.chat(
      {
        model: 'fast-thinker',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBe('low');

    // 'low' should map to 'minimal' for the 'fast-thinker' model key
    await ai.chat(
      {
        model: 'fast-thinker',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'low', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBe('minimal');
  });

  it('uses custom thinkingTokenBudgetLevels at model key level for Gemini 2.5', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        model: AxAIGoogleGeminiModel.Gemini25Flash,
        thinkingTokenBudgetLevels: {
          minimal: 200,
          low: 800,
          medium: 5000,
          high: 10000,
          highest: 24500,
        },
      },
      models: [
        {
          key: 'custom-budget',
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          description: 'Custom token budgets',
          config: {
            thinkingTokenBudgetLevels: {
              minimal: 100, // Override: 100 instead of 200
              low: 500, // Override: 500 instead of 800
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

    // 'minimal' should use 100 tokens for 'custom-budget' model key
    await ai.chat(
      {
        model: 'custom-budget',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'minimal', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingBudget
    ).toBe(100);

    // 'low' should use 500 tokens for 'custom-budget' model key
    await ai.chat(
      {
        model: 'custom-budget',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'low', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingBudget
    ).toBe(500);

    // 'medium' should use the default 5000 (not overridden)
    await ai.chat(
      {
        model: 'custom-budget',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { thinkingTokenBudget: 'medium', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingBudget
    ).toBe(5000);
  });

  it('preserves thinkingBudget for gemini-flash-lite-latest alias', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: 'gemini-flash-lite-latest' as any },
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
      { thinkingTokenBudget: 'low', stream: false }
    );

    const reqBody = capture.lastBody;
    expect(reqBody.generationConfig.thinkingConfig.thinkingBudget).toBe(800);
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingLevel
    ).toBeUndefined();
  });

  it('preserves thinkingBudget for gemini-flash-latest alias', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: 'gemini-flash-latest' as any },
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
      { thinkingTokenBudget: 'medium', stream: false }
    );

    const reqBody = capture.lastBody;
    expect(reqBody.generationConfig.thinkingConfig.thinkingBudget).toBe(5000);
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingLevel
    ).toBeUndefined();
  });

  it('preserves thinkingBudget for gemini-pro-latest alias', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: 'gemini-pro-latest' as any },
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
      { thinkingTokenBudget: 'high', stream: false }
    );

    const reqBody = capture.lastBody;
    expect(reqBody.generationConfig.thinkingConfig.thinkingBudget).toBe(10000);
    expect(
      reqBody.generationConfig.thinkingConfig.thinkingLevel
    ).toBeUndefined();
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

  describe('context caching tool semantics', () => {
    const cacheCreateResponse = {
      name: 'cachedContents/test-cache',
      expireTime: '2099-01-01T00:00:00Z',
      usageMetadata: { totalTokenCount: 4096 },
    };

    const generateResponse = {
      candidates: [
        {
          content: { parts: [{ text: 'ok' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 16,
        candidatesTokenCount: 4,
        totalTokenCount: 20,
        cachedContentTokenCount: 8,
        thoughtsTokenCount: 0,
      },
    };

    const createRegistry = () => {
      const map = new Map<string, any>();
      return {
        keys: [] as string[],
        registry: {
          get: vi.fn(async (key: string) => map.get(key)),
          set: vi.fn(async (key: string, value: unknown) => {
            map.set(key, value);
          }),
        },
      };
    };

    it('caches tools and toolConfig when breakpoint is after-examples', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [cacheCreateResponse, generateResponse],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'route this request' },
          ],
          functions: [
            {
              name: 'search',
              description: 'Searches the web',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'query' } },
                required: ['query'],
              },
            },
            {
              name: 'spawnSearchAgent',
              description: 'Returns the final structured output',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'query' },
                },
                required: ['query'],
              },
              cache: true,
            },
          ],
          functionCall: {
            type: 'function',
            function: { name: 'spawnSearchAgent' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'after-examples',
            registry,
          },
        }
      );

      expect(capture.calls).toHaveLength(2);

      const cacheCreateReq = capture.calls[0]?.body;
      expect(cacheCreateReq.tools?.[0]?.function_declarations).toHaveLength(2);
      expect(
        cacheCreateReq.tools[0].function_declarations.map((fn: any) => fn.name)
      ).toEqual(['search', 'spawnSearchAgent']);
      expect(cacheCreateReq.toolConfig?.function_calling_config?.mode).toBe(
        'ANY'
      );
      expect(
        cacheCreateReq.toolConfig?.allowedFunctionNames ??
          cacheCreateReq.toolConfig?.function_calling_config
            ?.allowedFunctionNames
      ).toContain('spawnSearchAgent');

      const generateReq = capture.calls[1]?.body;
      expect(generateReq.cachedContent).toBe('cachedContents/test-cache');
      expect(generateReq.tools).toBeUndefined();
      expect(generateReq.toolConfig).toBeUndefined();
    });

    it('caches tools and toolConfig when breakpoint is after-functions', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [cacheCreateResponse, generateResponse],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'route this request' },
          ],
          functions: [
            {
              name: 'search',
              description: 'Searches the web',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'query' } },
                required: ['query'],
              },
            },
            {
              name: 'spawnSearchAgent',
              description: 'Returns the final structured output',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'query' },
                },
                required: ['query'],
              },
              cache: true,
            },
          ],
          functionCall: {
            type: 'function',
            function: { name: 'spawnSearchAgent' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'after-functions',
            registry,
          },
        }
      );

      const cacheCreateReq = capture.calls[0]?.body;
      expect(cacheCreateReq.tools?.[0]?.function_declarations).toHaveLength(2);
      expect(cacheCreateReq.toolConfig?.function_calling_config?.mode).toBe(
        'ANY'
      );

      const generateReq = capture.calls[1]?.body;
      expect(generateReq.tools).toBeUndefined();
      expect(generateReq.toolConfig).toBeUndefined();
    });

    it('caches tools and toolConfig when breakpoint is system', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [cacheCreateResponse, generateResponse],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'route this request' },
          ],
          functions: [
            {
              name: 'search',
              description: 'Searches the web',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'query' } },
                required: ['query'],
              },
            },
            {
              name: 'spawnSearchAgent',
              description: 'Returns the final structured output',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'query' },
                },
                required: ['query'],
              },
            },
          ],
          functionCall: {
            type: 'function',
            function: { name: 'spawnSearchAgent' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      const cacheCreateReq = capture.calls[0]?.body;
      expect(cacheCreateReq.tools?.[0]?.function_declarations).toHaveLength(2);
      expect(cacheCreateReq.toolConfig?.function_calling_config?.mode).toBe(
        'ANY'
      );
      expect(
        cacheCreateReq.toolConfig?.allowedFunctionNames ??
          cacheCreateReq.toolConfig?.function_calling_config
            ?.allowedFunctionNames
      ).toContain('spawnSearchAgent');

      const generateReq = capture.calls[1]?.body;
      expect(generateReq.cachedContent).toBe('cachedContents/test-cache');
      expect(generateReq.tools).toBeUndefined();
      expect(generateReq.toolConfig).toBeUndefined();
    });

    it('includes cached function-style example messages in cache creation payloads', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [cacheCreateResponse, generateResponse],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'Example question' },
            {
              role: 'assistant',
              functionCalls: [
                {
                  id: 'example-0',
                  type: 'function',
                  function: {
                    name: '__finalResult',
                    params: { routingDecision: { answer: 'Use searchWeb' } },
                  },
                },
              ],
            },
            {
              role: 'function',
              functionId: 'example-0',
              result: 'done',
              cache: true,
            },
            { role: 'user', content: 'Live question' },
          ],
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            registry,
          },
        }
      );

      const cacheCreateReq = capture.calls[0]?.body;
      expect(cacheCreateReq.contents).toHaveLength(3);
      expect(cacheCreateReq.contents[0]?.role).toBe('user');
      expect(cacheCreateReq.contents[0]?.parts?.[0]?.text).toBe(
        'Example question'
      );
      expect(cacheCreateReq.contents[1]?.parts?.[0]?.functionCall?.name).toBe(
        '__finalResult'
      );
      expect(
        cacheCreateReq.contents[2]?.parts?.[0]?.functionResponse?.name
      ).toBe('__finalResult');

      const generateReq = capture.calls[1]?.body;
      expect(generateReq.contents).toHaveLength(1);
      expect(generateReq.contents[0]?.parts?.[0]?.text).toBe('Live question');
    });

    it('keeps function-style examples dynamic while caching tool state for system breakpoint', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [cacheCreateResponse, generateResponse],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'Example question' },
            {
              role: 'assistant',
              functionCalls: [
                {
                  id: 'example-0',
                  type: 'function',
                  function: {
                    name: '__finalResult',
                    params: { routingDecision: { answer: 'Use searchWeb' } },
                  },
                },
              ],
            },
            {
              role: 'function',
              functionId: 'example-0',
              result: 'done',
            },
            { role: 'user', content: 'Live question' },
          ],
          functions: [
            {
              name: 'searchWeb',
              description: 'Searches the web',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'query' } },
                required: ['query'],
              },
            },
            {
              name: '__finalResult',
              description: 'Returns the final structured output',
              parameters: {
                type: 'object',
                properties: {
                  routingDecision: {
                    type: 'object',
                    properties: {
                      answer: { type: 'string' },
                    },
                    required: ['answer'],
                  },
                },
                required: ['routingDecision'],
              },
            },
          ],
          functionCall: 'auto',
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      const cacheCreateReq = capture.calls[0]?.body;
      expect(
        cacheCreateReq.tools?.[0]?.function_declarations.map(
          (fn: any) => fn.name
        )
      ).toEqual(['searchWeb', '__finalResult']);
      expect(cacheCreateReq.contents).toBeUndefined();

      const generateReq = capture.calls[1]?.body;
      expect(generateReq.cachedContent).toBe('cachedContents/test-cache');
      expect(generateReq.tools).toBeUndefined();
      expect(generateReq.toolConfig).toBeUndefined();
      expect(generateReq.contents).toHaveLength(4);
      expect(generateReq.contents[0]?.parts?.[0]?.text).toBe(
        'Example question'
      );
      expect(generateReq.contents[1]?.parts?.[0]?.functionCall?.name).toBe(
        '__finalResult'
      );
      expect(generateReq.contents[2]?.parts?.[0]?.functionResponse?.name).toBe(
        '__finalResult'
      );
      expect(generateReq.contents[3]?.parts?.[0]?.text).toBe('Live question');
    });
  });

  describe('Vertex context caching URL composition', () => {
    const cacheCreateResponse = {
      name: 'projects/demo-project/locations/us-central1/cachedContents/abc123',
      expireTime: '2099-01-01T00:00:00Z',
      usageMetadata: { totalTokenCount: 4096 },
    };

    const generateResponse = {
      candidates: [
        {
          content: { parts: [{ text: 'ok' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 16,
        candidatesTokenCount: 4,
        totalTokenCount: 20,
        cachedContentTokenCount: 8,
        thoughtsTokenCount: 0,
      },
    };

    const createRegistry = () => {
      const map = new Map<string, any>();
      return {
        registry: {
          get: vi.fn(async (key: string) => map.get(key)),
          set: vi.fn(async (key: string, value: unknown) => {
            map.set(key, value);
          }),
        },
      };
    };

    it('routes regional Vertex cache creation to the v1 cachedContents endpoint with a full model resource', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: async () => 'vertex-token',
        projectId: 'demo-project',
        region: 'us-central1',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [
          {
            ...cacheCreateResponse,
            name: 'projects/demo-project/locations/us-central1/cachedContents/abc123',
          },
          generateResponse,
        ],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'route this request' },
          ],
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            registry,
          },
        }
      );

      expect(capture.calls).toHaveLength(2);

      expect(capture.calls[0]?.url).toBe(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/cachedContents'
      );

      const cacheCreateReq = capture.calls[0]?.body;
      expect(cacheCreateReq.model).toBe(
        `projects/demo-project/locations/us-central1/publishers/google/models/${AxAIGoogleGeminiModel.Gemini25Flash}`
      );

      const generateReq = capture.calls[1]?.body;
      expect(generateReq.cachedContent).toBe(
        'projects/demo-project/locations/us-central1/cachedContents/abc123'
      );
    });

    it('routes global Vertex cache creation to the v1 endpoint without a region prefix', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: async () => 'vertex-token',
        projectId: 'demo-project',
        region: 'global',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [
          {
            ...cacheCreateResponse,
            name: 'projects/demo-project/locations/global/cachedContents/abc123',
          },
          generateResponse,
        ],
        capture
      );
      const { registry } = createRegistry();

      ai.setOptions({ fetch });

      await ai.chat(
        {
          chatPrompt: [
            { role: 'system', content: 'You are a router', cache: true },
            { role: 'user', content: 'route this request' },
          ],
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            registry,
          },
        }
      );

      expect(capture.calls).toHaveLength(2);

      expect(capture.calls[0]?.url).toBe(
        'https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/cachedContents'
      );

      const cacheCreateReq = capture.calls[0]?.body;
      expect(cacheCreateReq.model).toBe(
        `projects/demo-project/locations/global/publishers/google/models/${AxAIGoogleGeminiModel.Gemini25Flash}`
      );
    });
  });

  describe('token usage normalization for cached content', () => {
    it('should subtract cachedContentTokenCount from promptTokens', async () => {
      const response = {
        candidates: [
          {
            content: { parts: [{ text: 'hello' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10000,
          candidatesTokenCount: 500,
          totalTokenCount: 10500,
          cachedContentTokenCount: 8000,
          thoughtsTokenCount: 0,
        },
      };

      const capture = { lastBody: undefined };
      const fetch = createMockFetch(response, capture);

      const ai = new AxAIGoogleGemini({
        apiKey: 'test-key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Pro },
        models: [],
      });
      ai.setOptions({ fetch });

      const res = await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { stream: false }
      );

      const usage = (res as any).modelUsage;
      expect(usage?.tokens).toBeDefined();
      // promptTokens should be total minus cached: 10000 - 8000 = 2000
      expect(usage.tokens.promptTokens).toBe(2000);
      // cacheReadTokens should be the cached portion
      expect(usage.tokens.cacheReadTokens).toBe(8000);
      expect(usage.tokens.completionTokens).toBe(500);
    });

    it('should leave promptTokens unchanged when no cached content', async () => {
      const response = {
        candidates: [
          {
            content: { parts: [{ text: 'hello' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 5000,
          candidatesTokenCount: 200,
          totalTokenCount: 5200,
          thoughtsTokenCount: 0,
        },
      };

      const capture = { lastBody: undefined };
      const fetch = createMockFetch(response, capture);

      const ai = new AxAIGoogleGemini({
        apiKey: 'test-key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Pro },
        models: [],
      });
      ai.setOptions({ fetch });

      const res = await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { stream: false }
      );

      const usage = (res as any).modelUsage;
      expect(usage?.tokens).toBeDefined();
      expect(usage.tokens.promptTokens).toBe(5000);
      expect(usage.tokens.cacheReadTokens).toBeUndefined();
    });
  });
});

describe('AxAIGoogleGemini Live audio chat', () => {
  it('recognizes Gemini 3.1 Flash Live as a Live audio model', () => {
    expect(
      axIsGeminiLiveAudioModel(AxAIGoogleGeminiModel.Gemini31FlashLive)
    ).toBe(true);
  });

  it('provides a native audio default config', () => {
    const config = axAIGoogleGeminiLiveAudioDefaultConfig();

    expect(config.model).toBe(AxAIGoogleGeminiModel.Gemini25FlashNativeAudio);
    expect(config.stream).toBe(false);
    expect(config.audio?.output?.enabled).toBe(true);
    expect(config.audio?.output?.voice).toBe('Kore');
    expect(config.audio?.output?.format).toBe('pcm16');
    expect(config.audio?.output?.sampleRate).toBe(24_000);
    expect(config.audio?.output?.includeTranscript).toBe(true);
    expect(config.audio?.live?.turnTimeoutMs).toBe(30_000);
  });

  it('aggregates a bounded one-turn WebSocket audio response', async () => {
    const restore = installFakeGeminiLiveWebSocket([
      {
        serverContent: {
          outputTranscription: { text: 'spoken ' },
        },
      },
      {
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 3,
          totalTokenCount: 13,
          thoughtsTokenCount: 0,
        },
      },
      {
        serverContent: {
          outputTranscription: { text: 'answer' },
          modelTurn: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=24000',
                  data: 'AQI=',
                },
              },
            ],
          },
        },
      },
      {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=24000',
                  data: 'AwQ=',
                },
              },
            ],
          },
          turnComplete: true,
        },
      },
    ]);

    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: axAIGoogleGeminiLiveAudioDefaultConfig(),
        models: [],
      });

      const res = (await ai.chat(
        {
          chatPrompt: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'answer this' },
                {
                  type: 'audio',
                  data: 'AAAA',
                  format: 'pcm16',
                  sampleRate: 16_000,
                },
              ],
            },
          ],
        },
        { stream: false }
      )) as any;

      expect(res.results[0]?.content).toBe('spoken answer');
      expect(res.results[0]?.audio).toEqual({
        data: 'AQIDBA==',
        mimeType: 'audio/pcm;rate=24000',
        format: 'pcm16',
        sampleRate: 24_000,
        channels: 1,
        isDelta: false,
      });
      expect(res.modelUsage?.tokens.promptTokens).toBe(10);

      const socket = FakeGeminiLiveWebSocket.instances[0];
      expect(socket?.url).toContain('BidiGenerateContent?key=key');
      const setup = JSON.parse(socket?.sent[0] ?? '{}');
      expect(setup.setup.generationConfig.responseModalities).toEqual([
        'AUDIO',
      ]);
      expect(
        setup.setup.generationConfig.speechConfig.voiceConfig
          .prebuiltVoiceConfig.voiceName
      ).toBe('Kore');
      expect(setup.setup.outputAudioTranscription).toEqual({});

      const audioInput = socket?.sent
        .map((item) => JSON.parse(item))
        .find((item) => item.realtimeInput?.audio);
      expect(audioInput?.realtimeInput.audio).toEqual({
        data: 'AAAA',
        mimeType: 'audio/pcm;rate=16000',
      });
    } finally {
      restore();
    }
  });

  it('streams audio deltas from the Live WebSocket', async () => {
    const restore = installFakeGeminiLiveWebSocket([
      {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/pcm;rate=24000',
                  data: 'AQI=',
                },
              },
            ],
          },
        },
      },
      {
        serverContent: {
          turnComplete: true,
        },
      },
    ]);

    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: axAIGoogleGeminiLiveAudioDefaultConfig(),
        models: [],
      });

      const stream = (await ai.chat(
        {
          chatPrompt: [{ role: 'user', content: 'say hi' }],
        },
        { stream: true }
      )) as ReadableStream<any>;

      const reader = stream.getReader();
      const chunks: any[] = [];
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        chunks.push(item.value);
      }

      expect(chunks[0]?.results[0]?.audio).toEqual({
        data: 'AQI=',
        mimeType: 'audio/pcm;rate=24000',
        format: 'pcm16',
        sampleRate: 24_000,
        channels: 1,
        isDelta: true,
      });
      expect(chunks.at(-1)?.results[0]?.audio?.data).toBe('AQI=');
      expect(chunks.at(-1)?.results[0]?.audio?.isDelta).toBe(false);
    } finally {
      restore();
    }
  });

  it('rejects structured output with Live audio output enabled', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: axAIGoogleGeminiLiveAudioDefaultConfig(),
      models: [],
    });

    await expect(
      ai.chat(
        {
          chatPrompt: [{ role: 'user', content: 'return json' }],
          responseFormat: { type: 'json_object' },
        },
        { stream: false }
      )
    ).rejects.toThrow('structured response formats');
  });

  it('rejects non-PCM input for Live audio', async () => {
    const restore = installFakeGeminiLiveWebSocket([]);

    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: axAIGoogleGeminiLiveAudioDefaultConfig(),
        models: [],
      });

      await expect(
        ai.chat(
          {
            chatPrompt: [
              {
                role: 'user',
                content: [{ type: 'audio', data: 'AAAA', format: 'wav' }],
              },
            ],
          },
          { stream: false }
        )
      ).rejects.toThrow('requires PCM audio input');
    } finally {
      restore();
    }
  });
});

describe('AxAIGoogleGemini image content mapping', () => {
  it('maps inline base64 images to inlineData', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    ai.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
          ],
        },
        capture
      ),
    });

    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'image', mimeType: 'image/png', image: 'base64data' },
            ],
          },
        ],
      },
      { stream: false }
    );

    const parts = capture.lastBody?.contents?.[0]?.parts;
    expect(parts).toContainEqual({
      inlineData: { mimeType: 'image/png', data: 'base64data' },
    });
  });

  it('maps fileUri images to fileData', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    ai.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
          ],
        },
        capture
      ),
    });

    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                mimeType: 'image/png',
                fileUri: 'gs://my-bucket/cat.png',
              },
            ],
          },
        ],
      },
      { stream: false }
    );

    const parts = capture.lastBody?.contents?.[0]?.parts;
    expect(parts).toContainEqual({
      fileData: { mimeType: 'image/png', fileUri: 'gs://my-bucket/cat.png' },
    });
  });
});
