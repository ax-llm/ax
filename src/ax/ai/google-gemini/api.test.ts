import { describe, expect, it, vi } from 'vitest';

import { f, fn } from '../../dsp/sig.js';
import { axAIProviderProfiles } from '../provider_profiles.generated.js';
import { ai as createAI } from '../wrap.js';
import {
  AxAIGoogleGemini,
  axAIGoogleGeminiDefaultConfig,
  axAIGoogleGeminiDefaultCreativeConfig,
  axAIGoogleGeminiLiveAudioDefaultConfig,
} from './api.js';
import { axModelInfoGoogleGemini } from './info.js';
import { axIsGeminiLiveAudioModel } from './live_audio.js';
import {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiEmbedTypes,
  AxAIGoogleGeminiModel,
} from './types.js';

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
  capture: { calls: Array<{ url: string; body?: any; method?: string }> }
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

      capture.calls.push({ url: String(url), body, method: init?.method });

      const responseBody = bodies[Math.min(index, bodies.length - 1)];
      index++;

      if (responseBody instanceof Response) {
        return responseBody;
      }
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

// How the fake server frames its JSON. The real Live endpoint uses binary
// frames, which a WebSocket delivers as a Blob unless binaryType is
// 'arraybuffer'. 'bytes' ignores binaryType and hands over a view into a
// larger buffer, like a pooled Node Buffer from `ws`.
type FakeGeminiLiveFrames = 'binary' | 'text' | 'bytes';

class FakeGeminiLiveWebSocket {
  static serverMessages: unknown[] = [];
  static instances: FakeGeminiLiveWebSocket[] = [];
  static frames: FakeGeminiLiveFrames = 'binary';
  static closeOnSetup?: { code: number; reason: string };

  binaryType = 'blob';
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
        const rejection = FakeGeminiLiveWebSocket.closeOnSetup;
        if (rejection) {
          this.emit('close', rejection);
          return;
        }
        this.emit('message', { data: this.frame({ setupComplete: {} }) });
      });
      return;
    }

    if (
      message.clientContent?.turnComplete === true ||
      message.realtimeInput?.audioStreamEnd === true
    ) {
      queueMicrotask(() => {
        for (const serverMessage of FakeGeminiLiveWebSocket.serverMessages) {
          this.emit('message', { data: this.frame(serverMessage) });
        }
      });
    }
  }

  close() {
    this.emit('close', {});
  }

  private frame(message: unknown): unknown {
    const json = JSON.stringify(message);
    if (FakeGeminiLiveWebSocket.frames === 'text') {
      return json;
    }
    const bytes = new TextEncoder().encode(json);
    if (FakeGeminiLiveWebSocket.frames === 'bytes') {
      const pooled = new Uint8Array(bytes.length + 8);
      pooled.set(bytes, 4);
      return pooled.subarray(4, 4 + bytes.length);
    }
    return this.binaryType === 'arraybuffer' ? bytes.buffer : new Blob([bytes]);
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

function installFakeGeminiLiveWebSocket(
  messages: unknown[],
  options: {
    frames?: FakeGeminiLiveFrames;
    closeOnSetup?: { code: number; reason: string };
  } = {}
) {
  const original = globalThis.WebSocket;
  FakeGeminiLiveWebSocket.serverMessages = messages;
  FakeGeminiLiveWebSocket.instances = [];
  FakeGeminiLiveWebSocket.frames = options.frames ?? 'binary';
  FakeGeminiLiveWebSocket.closeOnSetup = options.closeOnSetup;
  (globalThis as any).WebSocket = FakeGeminiLiveWebSocket;

  return () => {
    (globalThis as any).WebSocket = original;
  };
}

describe('AxAIGoogleGemini schema validation', () => {
  it('accepts a renewable credential provider without a static API key', async () => {
    const requests: Array<{
      profile: string;
      operation: string;
      method: string;
      url: string;
    }> = [];
    const fetch = vi
      .fn()
      .mockImplementation(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          expect(new Headers(init?.headers).get('authorization')).toBe(
            'Bearer renewable-gemini-token'
          );
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'ok' }] },
                  finishReason: 'STOP',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      );
    const ai = new AxAIGoogleGemini({
      credentialProvider: async (request) => {
        requests.push(request);
        return { Authorization: 'Bearer renewable-gemini-token' };
      },
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      options: { fetch },
    });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    expect(requests).toEqual([
      expect.objectContaining({
        profile: 'google-gemini',
        operation: 'chat',
        method: 'POST',
      }),
    ]);
  });

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

  it('sends fn() tool schemas as parametersJsonSchema, never the OpenAPI-subset parameters field', async () => {
    // Gemini's `parameters` field rejects `additionalProperties` with HTTP 400
    // ("Unknown name additionalProperties ... Cannot find field"), and fn()
    // emits it on every object schema.
    const getWeather = fn('getWeather')
      .description('Get the current weather for a city')
      .arg('city', f.string('City'))
      .arg(
        'options',
        f.object({ units: f.string('Units').optional() }).optional()
      )
      .returns(f.string('Weather'))
      .handler(async () => 'sunny')
      .build();
    expect(getWeather.parameters.additionalProperties).toBe(false);

    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini36Flash },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    ai.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'getWeather',
                      args: { city: 'Paris' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        },
        capture
      ),
    });

    const res = await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Weather in Paris?' }],
        functions: [getWeather],
      },
      { stream: false }
    );

    const declarations = capture.lastBody?.tools?.[0]?.function_declarations;
    expect(declarations).toHaveLength(1);
    const [declaration] = declarations;
    expect(Object.keys(declaration).sort()).toEqual([
      'description',
      'name',
      'parametersJsonSchema',
    ]);
    expect(declaration).not.toHaveProperty('parameters');
    expect(declaration.parametersJsonSchema).toEqual(getWeather.parameters);
    expect(
      declaration.parametersJsonSchema.properties.options.additionalProperties
    ).toBe(false);

    if (res instanceof ReadableStream) {
      throw new Error('expected a non-streaming response');
    }
    expect(res.results[0]?.functionCalls?.[0]?.function).toEqual({
      name: 'getWeather',
      params: { city: 'Paris' },
    });
  });

  it('nests allowed_function_names inside function_calling_config for forced function calls', async () => {
    // Gemini 400s on allowedFunctionNames at the toolConfig level.
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini36Flash },
      models: [],
    });

    const capture: { lastBody?: any } = {};
    ai.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'getTime',
                      args: { city: 'Paris' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        },
        capture
      ),
    });

    const parameters = {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    } as const;
    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Time in Paris?' }],
        functions: [
          { name: 'getWeather', description: 'Get the weather', parameters },
          { name: 'getTime', description: 'Get the time', parameters },
        ],
        functionCall: { type: 'function', function: { name: 'getTime' } },
      },
      { stream: false }
    );

    expect(capture.lastBody?.toolConfig).toEqual({
      function_calling_config: {
        mode: 'ANY',
        allowed_function_names: ['getTime'],
      },
    });
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

  it('routes Vertex chat requests through the US multi-region endpoint', async () => {
    const capture: { calls: Array<{ url: string; body?: any }> } = {
      calls: [],
    };
    const fetch = createSequencedMockFetch(
      [
        {
          candidates: [
            {
              content: { parts: [{ text: 'multi-region ok' }] },
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
      region: 'us',
      config: { model: AxAIGoogleGeminiModel.Gemini31FlashLite },
      options: { fetch },
    });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi multi-region' }],
      },
      { stream: false }
    );

    expect(capture.calls[0]?.url).toBe(
      'https://aiplatform.us.rep.googleapis.com/v1/projects/demo-project/locations/us/publishers/google/models/gemini-3.1-flash-lite:generateContent'
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

  it('sends the Vertex embedding task type as task_type', async () => {
    const capture: { calls: Array<{ url: string; body?: any }> } = {
      calls: [],
    };
    const fetch = createSequencedMockFetch(
      [{ predictions: [{ embeddings: { values: [0.1, 0.2, 0.3] } }] }],
      capture
    );

    const ai = new AxAIGoogleGemini({
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: {
        model: AxAIGoogleGeminiModel.Gemini25Flash,
        embedType: AxAIGoogleGeminiEmbedTypes.RetrievalDocument,
      },
    });

    ai.setOptions({ fetch });

    await ai.embed({
      embedModel: AxAIGoogleGeminiEmbedModel.GeminiEmbedding001,
      texts: ['hello world'],
    });

    // Vertex :predict silently ignores `taskType` and embeds as RETRIEVAL_QUERY.
    const instance = capture.calls[0]?.body?.instances?.[0];
    expect(instance).toEqual({
      content: 'hello world',
      task_type: 'RETRIEVAL_DOCUMENT',
    });
  });

  describe('gemini-embedding-2 on Vertex', () => {
    const embedContentResponse = {
      embedding: { values: [0.1, 0.2, 0.3] },
      usageMetadata: { promptTokenCount: 2, totalTokenCount: 2 },
    };

    const createVertexAI = (
      fetch: typeof globalThis.fetch,
      options: { beta?: boolean } = {}
    ) =>
      new AxAIGoogleGemini({
        apiKey: async () => 'vertex-token',
        projectId: 'demo-project',
        region: 'us-central1',
        config: {
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          embedModel: AxAIGoogleGeminiEmbedModel.GeminiEmbedding2,
          embedType: AxAIGoogleGeminiEmbedTypes.RetrievalDocument,
          dimensions: 768,
        },
        options: { ...options, fetch },
      });

    it('sends one text to the global :embedContent endpoint with no task type', async () => {
      const capture: { calls: Array<{ url: string; body?: any }> } = {
        calls: [],
      };
      const fetch = createSequencedMockFetch([embedContentResponse], capture);
      const ai = createVertexAI(fetch);

      const res = await ai.embed({ texts: ['hello world'] });

      // Vertex serves this model only at locations/global; us-central1 404s.
      expect(capture.calls[0]?.url).toBe(
        'https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/publishers/google/models/gemini-embedding-2:embedContent'
      );
      // embedType is configured, but the model takes no task type.
      expect(capture.calls[0]?.body).toEqual({
        content: { parts: [{ text: 'hello world' }] },
        outputDimensionality: 768,
      });
      expect(res.embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect(res.modelUsage?.model).toBe('gemini-embedding-2');
      expect(res.modelUsage?.tokens).toEqual({
        promptTokens: 2,
        completionTokens: 0,
        totalTokens: 2,
      });
      expect(ai.getLastUsedEmbedModel()).toBe('gemini-embedding-2');
    });

    it('honors options.beta by routing onto v1beta1', async () => {
      const capture: { calls: Array<{ url: string; body?: any }> } = {
        calls: [],
      };
      const fetch = createSequencedMockFetch([embedContentResponse], capture);
      const ai = createVertexAI(fetch, { beta: true });

      await ai.embed({ texts: ['hello world'] });

      expect(capture.calls[0]?.url).toBe(
        'https://aiplatform.googleapis.com/v1beta1/projects/demo-project/locations/global/publishers/google/models/gemini-embedding-2:embedContent'
      );
    });

    it('rejects more than one text without calling Vertex', async () => {
      const capture: { calls: Array<{ url: string; body?: any }> } = {
        calls: [],
      };
      const fetch = createSequencedMockFetch([embedContentResponse], capture);
      const ai = createVertexAI(fetch);

      // Vertex would fuse both texts into one vector.
      await expect(ai.embed({ texts: ['a', 'b'] })).rejects.toThrow(
        'gemini-embedding-2 on Vertex embeds one text per request'
      );
      expect(fetch).not.toHaveBeenCalled();
    });
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
    expect(defaultCfg.model).toBe(AxAIGoogleGeminiModel.Gemini36Flash);
  });

  it('maps modelConfig.n to Gemini candidateCount', async () => {
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

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { n: 3 },
      },
      { stream: false }
    );

    expect(capture.lastBody?.generationConfig?.candidateCount).toBe(3);
  });

  it.each([
    AxAIGoogleGeminiModel.Gemini38Flash,
    AxAIGoogleGeminiModel.Gemini37Flash,
    AxAIGoogleGeminiModel.Gemini36Flash,
    AxAIGoogleGeminiModel.Gemini35FlashLite,
  ])('omits deprecated sampling parameters for %s', async (model) => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model, temperature: 0.4, topP: 0.8, topK: 20 },
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
        modelConfig: { temperature: 0.2, topP: 0.7, topK: 10 },
      },
      { stream: false }
    );

    expect(capture.lastBody?.generationConfig).not.toHaveProperty(
      'temperature'
    );
    expect(capture.lastBody?.generationConfig).not.toHaveProperty('topP');
    expect(capture.lastBody?.generationConfig).not.toHaveProperty('topK');
  });

  it.each([
    AxAIGoogleGeminiModel.Gemini38Flash,
    AxAIGoogleGeminiModel.Gemini37Flash,
    AxAIGoogleGeminiModel.Gemini36Flash,
  ])(
    'omits unsupported candidate and penalty parameters for %s',
    async (model) => {
      const capture: { lastBody?: any } = {};
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model, n: 2, frequencyPenalty: 0.4 },
        models: [],
        options: {
          fetch: createMockFetch(
            {
              candidates: [
                {
                  content: { parts: [{ text: 'ok' }] },
                  finishReason: 'STOP',
                },
              ],
            },
            capture
          ),
        },
      });

      await ai.chat(
        {
          chatPrompt: [{ role: 'user', content: 'hi' }],
          modelConfig: { n: 3, frequencyPenalty: 0.2 },
        },
        { stream: false }
      );

      expect(capture.lastBody?.generationConfig).not.toHaveProperty(
        'candidateCount'
      );
      expect(capture.lastBody?.generationConfig).not.toHaveProperty(
        'frequencyPenalty'
      );
      expect(capture.lastBody?.generationConfig).not.toHaveProperty(
        'presencePenalty'
      );
    }
  );

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

  it.each([
    {
      model: AxAIGoogleGeminiModel.Gemini35Flash,
      requested: 'highest' as const,
      expectedLevel: 'high',
    },
    {
      model: AxAIGoogleGeminiModel.Gemini38Flash,
      requested: 'minimal' as const,
      expectedLevel: 'low',
    },
    {
      model: AxAIGoogleGeminiModel.Gemini37Flash,
      requested: 'minimal' as const,
      expectedLevel: 'low',
    },
    {
      model: AxAIGoogleGeminiModel.Gemini31Pro,
      requested: 'medium' as const,
      expectedLevel: 'medium',
    },
    {
      model: AxAIGoogleGeminiModel.Gemini31FlashImage,
      requested: 'medium' as const,
      expectedLevel: 'high',
    },
    {
      model: 'gemini-3-pro-preview',
      requested: 'medium' as const,
      expectedLevel: 'high',
    },
  ])(
    'maps $model $requested to the supported Gemini 3 level',
    async ({ model, requested, expectedLevel }) => {
      const capture: { lastBody?: any } = {};
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model: model as AxAIGoogleGeminiModel },
        models: [],
        options: {
          fetch: createMockFetch(
            {
              candidates: [
                {
                  content: { parts: [{ text: 'ok' }] },
                  finishReason: 'STOP',
                },
              ],
            },
            capture
          ),
        },
      });

      await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { thinkingTokenBudget: requested, showThoughts: true, stream: false }
      );

      expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
        thinkingLevel: expectedLevel,
        includeThoughts: true,
      });
    }
  );

  it.each([
    {
      model: AxAIGoogleGeminiModel.Gemini25Flash,
      requested: 'high' as const,
      expectedBudget: 10_000,
      expectedThoughts: true,
    },
    {
      model: AxAIGoogleGeminiModel.Gemini25Flash,
      requested: 'none' as const,
      expectedBudget: 0,
      expectedThoughts: false,
    },
    {
      model: AxAIGoogleGeminiModel.Gemini25Pro,
      requested: 'none' as const,
      expectedBudget: 200,
      expectedThoughts: false,
    },
  ])(
    'maps $model $requested to numeric budget $expectedBudget',
    async ({ model, requested, expectedBudget, expectedThoughts }) => {
      const capture: { lastBody?: any } = {};
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: { model },
        models: [],
        options: {
          fetch: createMockFetch(
            {
              candidates: [
                {
                  content: { parts: [{ text: 'ok' }] },
                  finishReason: 'STOP',
                },
              ],
            },
            capture
          ),
        },
      });

      await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { thinkingTokenBudget: requested, showThoughts: true, stream: false }
      );

      expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
        thinkingBudget: expectedBudget,
        includeThoughts: expectedThoughts,
      });
    }
  );

  it('clamps custom level mappings to the selected model family', async () => {
    const capture: { lastBody?: any } = {};
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        model: AxAIGoogleGeminiModel.Gemini38Flash,
        thinkingLevelMapping: { minimal: 'minimal' },
      },
      models: [],
      options: {
        fetch: createMockFetch(
          {
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          },
          capture
        ),
      },
    });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { thinkingTokenBudget: 'minimal', stream: false }
    );

    expect(
      capture.lastBody?.generationConfig?.thinkingConfig?.thinkingLevel
    ).toBe('low');
  });

  it('resolves named model presets before selecting level or budget fields', async () => {
    const capture: { lastBody?: any } = {};
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [
        {
          key: 'modern',
          model: AxAIGoogleGeminiModel.Gemini38Flash,
          description: 'Gemini 3 preset',
          thinkingTokenBudget: 'minimal',
          showThoughts: true,
        },
        {
          key: 'legacy',
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          description: 'Gemini 2.5 preset',
          thinkingTokenBudget: 'high',
          showThoughts: true,
        },
      ],
      options: {
        fetch: createMockFetch(
          {
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          },
          capture
        ),
      },
    });

    await ai.chat(
      { model: 'modern', chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );
    expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: 'low',
      includeThoughts: true,
    });

    await ai.chat(
      { model: 'legacy', chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );
    expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
      thinkingBudget: 10_000,
      includeThoughts: true,
    });

    await ai.chat(
      { model: 'modern', chatPrompt: [{ role: 'user', content: 'hi' }] },
      {
        thinkingTokenBudget: 'high',
        showThoughts: false,
        stream: false,
      }
    );
    expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: 'high',
      includeThoughts: false,
    });
  });

  it('rejects numeric thinking budgets in Gemini 3 named model presets', () => {
    expect(
      () =>
        new AxAIGoogleGemini({
          apiKey: 'key',
          config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
          models: [
            {
              key: 'modern',
              model: AxAIGoogleGeminiModel.Gemini35Flash,
              description: 'Gemini 3 preset',
              config: { thinking: { thinkingTokenBudget: 1000 } },
            },
          ],
        })
    ).toThrow(/do not support numeric thinkingTokenBudget/);
  });

  it.each(['google-gemini', 'gemini', 'google_gemini'])(
    'uses native Gemini thinking for the %s deployment profile name',
    async (profile) => {
      const capture: { lastBody?: any } = {};
      const service = createAI({
        name: profile,
        apiKey: 'key',
        config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
      } as any);
      service.setOptions({
        fetch: createMockFetch(
          {
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
          },
          capture
        ),
      });

      await service.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { thinkingTokenBudget: 'high', stream: false }
      );

      expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
        thinkingLevel: 'high',
      });
    }
  );

  it('uses native Gemini thinking when the google-gemini profile targets Vertex', async () => {
    const capture: { lastBody?: any } = {};
    const service = createAI({
      name: 'google-gemini',
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
    });
    service.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            {
              content: { parts: [{ text: 'ok' }] },
              finishReason: 'STOP',
            },
          ],
        },
        capture
      ),
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { thinkingTokenBudget: 'high', stream: false }
    );

    expect(capture.lastBody?.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: 'high',
    });
  });

  it('does not apply native Gemini thinking to the OpenAI-compatible vertex-ai profile', async () => {
    const fetch = vi.fn();
    const service = createAI({
      name: 'vertex-ai',
      apiKey: 'token',
      apiURL: 'https://vertex.example.test/v1',
      config: { model: AxAIGoogleGeminiModel.Gemini35Flash },
      options: { fetch },
    });

    await expect(
      service.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { thinkingTokenBudget: 'high', stream: false }
      )
    ).rejects.toThrow(/Thinking is not verified for profile vertex-ai/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves medium thinking for Gemini 3.1 Pro', async () => {
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
    expect(reqBody.generationConfig.thinkingConfig.thinkingLevel).toBe(
      'medium'
    );
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

  it('maps thinkingTokenBudget none to the minimum and always hides thoughts', async () => {
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
    expect(reqBody?.generationConfig?.thinkingConfig?.thinkingLevel).toBe(
      'minimal'
    );
    expect(reqBody?.generationConfig?.thinkingConfig?.includeThoughts).toBe(
      false
    );
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
                  functionCall: {
                    id: 'provider-call-foo',
                    name: 'foo',
                    args: {},
                  },
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
    expect(res.results[0]?.functionCalls?.[0].id).toBe('provider-call-foo');
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
        functionId: 'provider-call-foo',
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
    expect(assistantMsg.parts[0].functionCall.id).toBe('provider-call-foo');
    expect(assistantMsg.parts[0].functionCall.name).toBe('foo');
    expect(assistantMsg.parts[0].thought_signature).toBe('sig123');
    expect(reqBody.contents[2].parts[0].functionResponse).toMatchObject({
      id: 'provider-call-foo',
      name: 'foo',
    });
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
      { role: 'function', functionId: 'id1', result: 'r1' },
      { role: 'function', functionId: 'id2', result: 'r2' },
    ];

    await ai.chat({ chatPrompt: history }, { stream: false });

    const reqBody = capture.lastBody;
    // Expected: User, Model, User (with 2 parts)
    expect(reqBody.contents).toHaveLength(3);
    const lastUserMsg = reqBody.contents[2];
    expect(lastUserMsg.role).toBe('user');
    expect(lastUserMsg.parts).toHaveLength(2);
    expect(reqBody.contents[1].parts[0].functionCall.id).toBe('id1');
    expect(reqBody.contents[1].parts[1].functionCall.id).toBe('id2');
    expect(lastUserMsg.parts[0].functionResponse.id).toBe('id1');
    expect(lastUserMsg.parts[0].functionResponse.name).toBe('f1');
    expect(lastUserMsg.parts[1].functionResponse.id).toBe('id2');
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

    it.each([
      AxAIGoogleGeminiModel.Gemini38Flash,
      AxAIGoogleGeminiModel.Gemini37Flash,
      AxAIGoogleGeminiModel.Gemini36Flash,
      AxAIGoogleGeminiModel.Gemini35FlashLite,
    ])(
      'omits deprecated sampling parameters for cached %s requests',
      async (model) => {
        const ai = new AxAIGoogleGemini({
          apiKey: 'key',
          config: { model, temperature: 0.4, topP: 0.8, topK: 20 },
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
              { role: 'system', content: 'Cache this', cache: true },
              { role: 'user', content: 'hi' },
            ],
            modelConfig: { temperature: 0.2, topP: 0.7, topK: 10 },
          },
          {
            stream: false,
            contextCache: { minTokens: 0, registry },
          }
        );

        const generationConfig = capture.calls[1]?.body?.generationConfig;
        expect(generationConfig).not.toHaveProperty('temperature');
        expect(generationConfig).not.toHaveProperty('topP');
        expect(generationConfig).not.toHaveProperty('topK');
        if (model !== AxAIGoogleGeminiModel.Gemini35FlashLite) {
          expect(generationConfig).not.toHaveProperty('candidateCount');
          expect(generationConfig).not.toHaveProperty('frequencyPenalty');
        }
      }
    );

    it('sends the service tier only on the cached generate request', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: {
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          serviceTier: 'flex',
        },
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
            { role: 'system', content: 'Cache this', cache: true },
            { role: 'user', content: 'hi' },
          ],
        },
        {
          stream: false,
          contextCache: { minTokens: 0, registry },
        }
      );

      expect(capture.calls[0]?.body).not.toHaveProperty('service_tier');
      expect(capture.calls[1]?.body?.service_tier).toBe('flex');
    });

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
      for (const declaration of cacheCreateReq.tools[0].function_declarations) {
        expect(declaration).not.toHaveProperty('parameters');
        expect(declaration.parametersJsonSchema?.required).toEqual(['query']);
      }
      expect(cacheCreateReq.toolConfig?.function_calling_config?.mode).toBe(
        'ANY'
      );
      expect(cacheCreateReq.toolConfig).toEqual({
        function_calling_config: {
          mode: 'ANY',
          allowed_function_names: ['spawnSearchAgent'],
        },
      });

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
      expect(cacheCreateReq.toolConfig).toEqual({
        function_calling_config: {
          mode: 'ANY',
          allowed_function_names: ['spawnSearchAgent'],
        },
      });

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
                    name: '__axOutput',
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
        '__axOutput'
      );
      expect(cacheCreateReq.contents[1]?.parts?.[0]?.functionCall?.id).toBe(
        'example-0'
      );
      expect(
        cacheCreateReq.contents[2]?.parts?.[0]?.functionResponse?.name
      ).toBe('__axOutput');
      expect(cacheCreateReq.contents[2]?.parts?.[0]?.functionResponse?.id).toBe(
        'example-0'
      );

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
                    name: '__axOutput',
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
              name: '__axOutput',
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
      ).toEqual(['searchWeb', '__axOutput']);
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
        '__axOutput'
      );
      expect(generateReq.contents[1]?.parts?.[0]?.functionCall?.id).toBe(
        'example-0'
      );
      expect(generateReq.contents[2]?.parts?.[0]?.functionResponse?.name).toBe(
        '__axOutput'
      );
      expect(generateReq.contents[2]?.parts?.[0]?.functionResponse?.id).toBe(
        'example-0'
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

    it('routes Vertex cache creation through the EU multi-region endpoint', async () => {
      const ai = new AxAIGoogleGemini({
        apiKey: async () => 'vertex-token',
        projectId: 'demo-project',
        region: 'eu',
        config: { model: AxAIGoogleGeminiModel.Gemini31FlashLite },
        models: [],
      });

      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createSequencedMockFetch(
        [
          {
            ...cacheCreateResponse,
            name: 'projects/demo-project/locations/eu/cachedContents/abc123',
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
        'https://aiplatform.eu.rep.googleapis.com/v1/projects/demo-project/locations/eu/cachedContents'
      );
      expect(capture.calls[0]?.body?.model).toBe(
        `projects/demo-project/locations/eu/publishers/google/models/${AxAIGoogleGeminiModel.Gemini31FlashLite}`
      );
      expect(capture.calls[1]?.body?.cachedContent).toBe(
        'projects/demo-project/locations/eu/cachedContents/abc123'
      );
    });

    it('refreshes a regional Vertex cache with PATCH and the provider expiry', async () => {
      const cacheName =
        'projects/demo-project/locations/us-central1/cachedContents/abc123';
      const providerExpiry = '2099-02-03T04:05:06Z';
      const ai = new AxAIGoogleGemini({
        apiKey: async () => 'vertex-token',
        projectId: 'demo-project',
        region: 'us-central1',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });
      const capture = {
        calls: [] as Array<{ url: string; body?: any; method?: string }>,
      };
      const fetch = createSequencedMockFetch(
        [
          {
            ...cacheCreateResponse,
            name: cacheName,
            expireTime: providerExpiry,
          },
          generateResponse,
        ],
        capture
      );
      let entry = {
        cacheName,
        expiresAt: Date.now() + 60_000,
        tokenCount: 4096,
      };
      const registry = {
        get: vi.fn(async () => entry),
        set: vi.fn(async (_key: string, value: typeof entry) => {
          entry = value;
        }),
      };

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
          retry: { maxRetries: 0 },
          contextCache: { minTokens: 0, registry },
        }
      );

      expect(capture.calls).toHaveLength(2);
      expect(capture.calls[0]).toMatchObject({
        url: `https://us-central1-aiplatform.googleapis.com/v1/${cacheName}?updateMask=ttl`,
        method: 'PATCH',
        body: { ttl: '3600s' },
      });
      expect(capture.calls[1]?.body?.cachedContent).toBe(cacheName);
      expect(entry.expiresAt).toBe(Date.parse(providerExpiry));
    });

    it('includes the API key and update mask for Gemini cache refreshes', () => {
      const ai = new AxAIGoogleGemini({
        apiKey: 'gemini-key',
        config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
        models: [],
      });
      const op = (ai as any).aiImpl.buildCacheUpdateTTLOp(
        'cachedContents/abc123',
        7200
      );

      expect(op.apiConfig).toMatchObject({
        name: '/cachedContents/abc123?updateMask=ttl',
        method: 'PATCH',
      });
      expect(op.request).toEqual({ ttl: '7200s' });
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

describe('AxAIGoogleGemini inference service tiers', () => {
  it.each(['standard', 'flex', 'priority'] as const)(
    'sends and reports the %s inference service tier',
    async (serviceTier) => {
      const capture: { lastBody?: any } = {};
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: {
          model: AxAIGoogleGeminiModel.Gemini25Flash,
          serviceTier,
        },
        models: [],
      });

      ai.setOptions({
        fetch: createMockFetch(
          {
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
              thoughtsTokenCount: 0,
              serviceTier,
            },
          },
          capture
        ),
      });

      const response = await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hello' }] },
        { stream: false }
      );

      expect(capture.lastBody?.service_tier).toBe(serviceTier);
      expect(response.modelUsage?.tokens?.serviceTier).toBe(serviceTier);
    }
  );

  it('lets per-call serviceTier override the instance default', async () => {
    const capture: { lastBody?: any } = {};
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        model: AxAIGoogleGeminiModel.Gemini25Flash,
        serviceTier: 'standard',
      },
      models: [],
    });
    ai.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            {
              content: { parts: [{ text: 'ok' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        },
        capture
      ),
    });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false, serviceTier: 'flex' }
    );

    expect(capture.lastBody?.service_tier).toBe('flex');
  });

  it('omits auto when the Gemini API has no explicit auto value', async () => {
    const capture: { lastBody?: any } = {};
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [],
    });
    ai.setOptions({
      fetch: createMockFetch(
        {
          candidates: [
            {
              content: { parts: [{ text: 'ok' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        },
        capture
      ),
    });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false, serviceTier: 'auto' }
    );

    expect(capture.lastBody).not.toHaveProperty('service_tier');
  });

  it('normalizes an unspecified response tier to standard', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
      models: [],
    });

    ai.setOptions({
      fetch: createMockFetch({
        candidates: [
          {
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
          thoughtsTokenCount: 0,
          serviceTier: 'unspecified',
        },
      }),
    });

    const response = await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false }
    );

    expect(response.modelUsage?.tokens?.serviceTier).toBe('standard');
  });

  it.each(['standard', 'flex', 'priority'] as const)(
    'rejects the %s inference service tier for Vertex AI',
    (serviceTier) => {
      expect(
        () =>
          new AxAIGoogleGemini({
            apiKey: async () => 'token',
            projectId: 'project',
            region: 'us-central1',
            config: {
              model: AxAIGoogleGeminiModel.Gemini25Flash,
              serviceTier,
            },
            models: [],
          })
      ).toThrow('not supported by Vertex AI');
    }
  );
});

describe('AxAIGoogleGemini Live audio chat', () => {
  it('recognizes Gemini 3.1 Flash Live as a Live audio model', () => {
    expect(
      axIsGeminiLiveAudioModel(AxAIGoogleGeminiModel.Gemini31FlashLive)
    ).toBe(true);
  });

  it('provides a Live audio default config', () => {
    const config = axAIGoogleGeminiLiveAudioDefaultConfig();

    expect(config.model).toBe(AxAIGoogleGeminiModel.Gemini38Live);
    expect(config.stream).toBe(false);
    expect(config.audio?.output?.enabled).toBe(true);
    expect(config.audio?.output?.voice).toBe('Kore');
    expect(config.audio?.output?.format).toBe('pcm16');
    expect(config.audio?.output?.sampleRate).toBe(24_000);
    expect(config.audio?.output?.includeTranscript).toBe(true);
    expect(config.audio?.live?.turnTimeoutMs).toBe(30_000);
  });

  it.each([
    {
      model: AxAIGoogleGeminiModel.Gemini31FlashLive,
      expected: { thinkingLevel: 'high', includeThoughts: true },
    },
    {
      model: AxAIGoogleGeminiModel.Gemini25FlashNativeAudio,
      expected: { thinkingBudget: 10_000, includeThoughts: true },
    },
    {
      model: AxAIGoogleGeminiModel.Gemini38LiveExtendedThinking,
      expected: { thinkingLevel: 'high', includeThoughts: true },
    },
    {
      // 3.8 Live refuses every thinking setting, so none is sent.
      model: AxAIGoogleGeminiModel.Gemini38Live,
      expected: undefined,
    },
  ])(
    'uses model-aware thinking in Live setup for $model',
    async ({ model, expected }) => {
      const restore = installFakeGeminiLiveWebSocket([
        { serverContent: { turnComplete: true } },
      ]);

      try {
        const ai = new AxAIGoogleGemini({
          apiKey: 'key',
          config: {
            ...axAIGoogleGeminiLiveAudioDefaultConfig(),
            model,
          },
          models: [],
        });

        await ai.chat(
          {
            chatPrompt: [{ role: 'user', content: 'answer aloud' }],
          },
          {
            thinkingTokenBudget: 'high',
            showThoughts: true,
            stream: false,
          }
        );

        const socket = FakeGeminiLiveWebSocket.instances[0];
        const setup = JSON.parse(socket?.sent[0] ?? '{}');
        expect(setup.setup.generationConfig.thinkingConfig).toEqual(expected);
      } finally {
        restore();
      }
    }
  );

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

  // A frame the client cannot read leaves the turn waiting for its timeout;
  // a short timeout keeps that failure quick and readable.
  const quickTimeoutLiveConfig = () => {
    const config = axAIGoogleGeminiLiveAudioDefaultConfig();
    return {
      ...config,
      audio: { ...config.audio, live: { turnTimeoutMs: 1_000 } },
    };
  };

  it.each(['binary', 'text', 'bytes'] as const)(
    'reads Live server messages sent in %s frames',
    async (frames) => {
      const restore = installFakeGeminiLiveWebSocket(
        [
          {
            serverContent: {
              outputTranscription: { text: 'hi' },
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
              turnComplete: true,
            },
          },
        ],
        { frames }
      );

      try {
        const ai = new AxAIGoogleGemini({
          apiKey: 'key',
          config: quickTimeoutLiveConfig(),
          models: [],
        });

        const res = (await ai.chat(
          { chatPrompt: [{ role: 'user', content: 'say hi' }] },
          { stream: false }
        )) as any;

        expect(FakeGeminiLiveWebSocket.instances[0]?.binaryType).toBe(
          'arraybuffer'
        );
        expect(res.results[0]?.content).toBe('hi');
        expect(res.results[0]?.audio?.data).toBe('AQI=');
      } finally {
        restore();
      }
    }
  );

  it('keeps thought summaries out of the spoken answer', async () => {
    const restore = installFakeGeminiLiveWebSocket([
      {
        serverContent: {
          modelTurn: {
            parts: [{ text: '**Picking a greeting**\n\n', thought: true }],
          },
        },
      },
      { serverContent: { outputTranscription: { text: 'Hello there.' } } },
      {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' },
              },
            ],
          },
        },
      },
      { serverContent: { turnComplete: true } },
    ]);

    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: axAIGoogleGeminiLiveAudioDefaultConfig(),
        models: [],
      });

      const res = (await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'say hello' }] },
        { stream: false }
      )) as any;

      expect(res.results[0]?.content).toBe('Hello there.');
      expect(res.results[0]?.thought).toBe('**Picking a greeting**\n\n');
      expect(res.results[0]?.audio?.data).toBe('AQI=');
    } finally {
      restore();
    }
  });

  it('waits for the answer after an extended-thinking acknowledgement', async () => {
    const spoken = (text: string, data: string) => ({
      serverContent: {
        outputTranscription: { text },
        modelTurn: {
          parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data } }],
        },
      },
    });
    const restore = installFakeGeminiLiveWebSocket([
      spoken('Let me think.', 'AQI='),
      {
        serverContent: { turnComplete: true, interactionStatus: 'IN_PROGRESS' },
      },
      spoken('Hello there.', 'AwQ='),
      { serverContent: { turnComplete: true, interactionStatus: 'IDLE' } },
    ]);

    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: quickTimeoutLiveConfig(),
        models: [],
      });

      const res = (await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'say hello' }] },
        { stream: false }
      )) as any;

      expect(res.results[0]?.content).toBe('Let me think. Hello there.');
      expect(res.results[0]?.audio?.data).toBe('AQIDBA==');
    } finally {
      restore();
    }
  });

  it('fails with the close reason when the Live server rejects the setup', async () => {
    const restore = installFakeGeminiLiveWebSocket([], {
      closeOnSetup: {
        code: 1007,
        reason: 'Thinking level must be specified for this model.',
      },
    });

    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: quickTimeoutLiveConfig(),
        models: [],
      });

      await expect(
        ai.chat(
          { chatPrompt: [{ role: 'user', content: 'say hi' }] },
          { stream: false }
        )
      ).rejects.toThrow(
        'Gemini Live WebSocket closed before completion (code 1007): Thinking level must be specified for this model.'
      );
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

  it('rejects inference service tiers for Live audio', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: {
        ...axAIGoogleGeminiLiveAudioDefaultConfig(),
        serviceTier: 'flex',
      },
      models: [],
    });

    await expect(
      ai.chat(
        { chatPrompt: [{ role: 'user', content: 'say hi' }] },
        { stream: false }
      )
    ).rejects.toThrow('not supported by the Live API');
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

describe('AxAIGoogleGemini Sept-2026 models and audio defaults', () => {
  const liveSetupThinking = async (
    options: Record<string, unknown>
  ): Promise<unknown> => {
    const restore = installFakeGeminiLiveWebSocket([
      { serverContent: { turnComplete: true } },
    ]);
    try {
      const ai = new AxAIGoogleGemini({
        apiKey: 'key',
        config: {
          ...axAIGoogleGeminiLiveAudioDefaultConfig(),
          model: AxAIGoogleGeminiModel.Gemini38LiveExtendedThinking,
        },
        models: [],
      });
      await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'answer aloud' }] },
        { stream: false, ...options }
      );
      const socket = FakeGeminiLiveWebSocket.instances.at(-1);
      return JSON.parse(socket?.sent[0] ?? '{}').setup.generationConfig
        .thinkingConfig;
    } finally {
      restore();
    }
  };

  it('uses Gemini 3.6 Flash as the chat default', () => {
    expect(axAIGoogleGeminiDefaultConfig().model).toBe(
      AxAIGoogleGeminiModel.Gemini36Flash
    );
    expect(axAIGoogleGeminiDefaultCreativeConfig().model).toBe(
      AxAIGoogleGeminiModel.Gemini36Flash
    );
  });

  it('gives Live Extended Thinking the thinking level its setup requires', async () => {
    expect(await liveSetupThinking({})).toEqual({ thinkingLevel: 'medium' });
    // `minimal` is refused too, so `none` lands on the lowest level served.
    expect(await liveSetupThinking({ thinkingTokenBudget: 'none' })).toEqual({
      thinkingLevel: 'low',
      includeThoughts: false,
    });
  });

  it('recognizes the 3.8 Live models without catching live transcription', () => {
    expect(axIsGeminiLiveAudioModel(AxAIGoogleGeminiModel.Gemini38Live)).toBe(
      true
    );
    expect(
      axIsGeminiLiveAudioModel(
        AxAIGoogleGeminiModel.Gemini38LiveExtendedThinking
      )
    ).toBe(true);
    expect(axIsGeminiLiveAudioModel('gemini-3.5-transcribe-live')).toBe(false);
  });

  it.each([
    {
      mimeType: 'audio/wav',
      expected: { format: 'wav' },
    },
    {
      mimeType: 'audio/l16; rate=24000; channels=1',
      expected: { format: 'pcm16', sampleRate: 24_000, channels: 1 },
    },
  ])(
    'speaks with 3.8 Flash TTS by default and labels $mimeType audio',
    async ({ mimeType, expected }) => {
      let url = '';
      let body: any;
      const ai = new AxAIGoogleGemini({ apiKey: 'key' });
      const result = await ai.speak(
        { text: 'Hello from Ax.' },
        {
          fetch: async (input, init) => {
            url = String(input);
            body = JSON.parse(String(init?.body));
            return Response.json({
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [{ inlineData: { mimeType, data: 'UklGRg==' } }],
                  },
                },
              ],
            });
          },
        }
      );
      expect(url).toContain('/models/gemini-3.8-flash-tts:generateContent');
      expect(body.generationConfig.speechConfig).toEqual({
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      });
      expect(result).toMatchObject({ data: 'UklGRg==', mimeType, ...expected });
    }
  );

  it('transcribes with 3.5 Transcribe by default and reads its transcription parts', async () => {
    let url = '';
    const ai = new AxAIGoogleGemini({ apiKey: 'key' });
    const result = await ai.transcribe(
      { audio: { data: 'UklGRg==', format: 'wav' } },
      {
        fetch: async (input) => {
          url = String(input);
          return Response.json({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ audioTranscription: { text: '10 9 8' } }],
                },
              },
            ],
          });
        },
      }
    );
    expect(url).toContain('/models/gemini-3.5-transcribe:generateContent');
    expect(result.text).toBe('10 9 8');
  });

  it('leaves thought parts out of a transcript from a general model', async () => {
    const ai = new AxAIGoogleGemini({ apiKey: 'key' });
    const result = await ai.transcribe(
      {
        audio: { data: 'UklGRg==', format: 'wav' },
        model: AxAIGoogleGeminiModel.Gemini38Flash,
      },
      {
        fetch: async () =>
          Response.json({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    { text: 'The user wants a transcript.', thought: true },
                    { text: '10 9 8' },
                  ],
                },
              },
            ],
          }),
      }
    );
    expect(result.text).toBe('10 9 8');
  });

  it('keeps the TypeScript audio defaults in step with the provider profile', () => {
    const operations = axAIProviderProfiles['google-gemini'].operations as any;
    expect(operations.speak.defaultModel).toBe(
      AxAIGoogleGeminiModel.Gemini38FlashTTS
    );
    expect(operations.transcribe.defaultModel).toBe(
      AxAIGoogleGeminiModel.Gemini35Transcribe
    );
    expect(operations.realtime.defaultModel).toBe(
      axAIGoogleGeminiLiveAudioDefaultConfig().model
    );
    expect(axAIProviderProfiles['google-gemini'].defaults.model).toBe(
      axAIGoogleGeminiDefaultConfig().model
    );
  });

  it('points the image members at GA ids and still prices the preview ids', () => {
    expect(AxAIGoogleGeminiModel.Gemini31FlashImage).toBe(
      'gemini-3.1-flash-image'
    );
    expect(AxAIGoogleGeminiModel.Gemini3ProImage).toBe('gemini-3-pro-image');
    for (const preview of [
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
    ]) {
      expect(
        axModelInfoGoogleGemini.some((m) => m.aliases?.includes(preview))
      ).toBe(true);
    }
  });

  it.each([
    [AxAIGoogleGeminiModel.Gemini38FlashTTS, 1, 18],
    [AxAIGoogleGeminiModel.Gemini38FlashLiteTTS, 1, 12],
    [AxAIGoogleGeminiModel.Gemini31FlashTTS, 1, 20],
  ])('prices TTS model %s per text and audio token', (name, input, output) => {
    const entry = axModelInfoGoogleGemini.find((m) => m.name === name);
    expect(entry).toMatchObject({
      promptTokenCostPer1M: input,
      completionTokenCostPer1M: output,
      contextWindow: 8192,
      maxTokens: 16_384,
      audio: { input: false, output: true },
    });
  });
});
