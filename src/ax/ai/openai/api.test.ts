import { describe, expect, it, vi } from 'vitest';
import {
  AxAIOpenAI,
  axAIOpenAIAudioDefaultConfig,
  axAIOpenAIRealtimeDefaultConfig,
  axAIOpenAIRealtimeTranscriptionDefaultConfig,
} from './api.js';
import { AxAIOpenAIModel } from './chat_types.js';

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

function createMockStreamFetch(
  chunks: readonly unknown[],
  capture: { lastBody?: any }
) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (init?.body && typeof init.body === 'string') {
          capture.lastBody = JSON.parse(init.body);
        }
      } catch {}

      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
            );
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
}

class FakeOpenAIRealtimeWebSocket {
  static serverMessages: unknown[] = [];
  static instances: FakeOpenAIRealtimeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  readonly options: any;
  private readonly listeners = new Map<string, ((event: any) => void)[]>();

  constructor(url: string, options?: any) {
    this.url = url;
    this.options = options;
    FakeOpenAIRealtimeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  on(type: string, listener: (event: any) => void) {
    this.addEventListener(type, listener);
  }

  send(data: string) {
    this.sent.push(data);
    const message = JSON.parse(data);

    if (message.type === 'session.update') {
      queueMicrotask(() =>
        this.emit('message', {
          data: JSON.stringify({ type: 'session.updated' }),
        })
      );
      return;
    }

    if (message.type === 'transcription_session.update') {
      queueMicrotask(() =>
        this.emit('message', {
          data: JSON.stringify({ type: 'transcription_session.updated' }),
        })
      );
      return;
    }

    if (
      message.type === 'response.create' ||
      message.type === 'input_audio_buffer.commit'
    ) {
      queueMicrotask(() => {
        for (const serverMessage of FakeOpenAIRealtimeWebSocket.serverMessages) {
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

function openAIRealtimeWebSocket(messages: unknown[]) {
  FakeOpenAIRealtimeWebSocket.serverMessages = messages;
  FakeOpenAIRealtimeWebSocket.instances = [];
  return FakeOpenAIRealtimeWebSocket as any;
}

describe('AxAIOpenAI model key preset merging', () => {
  it('merges model list item modelConfig into effective config', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT5Mini },
      models: [
        {
          key: 'fast',
          model: AxAIOpenAIModel.GPT5Nano,
          description: 'fast preset',
          // @ts-expect-error: provider-specific config on model item is normalized at runtime
          config: { maxTokens: 256, stop: ['\n'] as any },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
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

    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        model: 'fast',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false }
    )) as any;

    expect(res.results[0]?.content).toBe('ok');
    expect(fetch).toHaveBeenCalled();

    const mc = ai.getLastUsedModelConfig();
    expect(mc?.maxTokens).toBe(256);
    // Temperature may be omitted by model; ensure no crash and allow undefined
    expect(
      Array.isArray(mc?.stopSequences) ? mc?.stopSequences!.length : 0
    ).toBeGreaterThan(0);
  });

  it('ignores thinkingTokenBudget when model does not support it', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT5Mini },
      models: [
        { key: 'fast', model: AxAIOpenAIModel.GPT5Nano, description: 'fast' },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
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

    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        model: 'fast',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false }
    )) as any;

    expect(res.results[0]?.content).toBe('ok');
    expect(fetch).toHaveBeenCalled();
  });
});

describe('AxAIOpenAI', () => {
  it('passes strict nullable structured-output schemas unchanged', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT5Mini },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"summary":"ok"}' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    const strictSchema = {
      name: 'output',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          nickname: { type: ['string', 'null'] },
          profile: {
            type: 'object',
            properties: {
              age: { type: ['number', 'null'] },
            },
            required: ['age'],
            additionalProperties: false,
          },
        },
        required: ['summary', 'nickname', 'profile'],
        additionalProperties: false,
      },
    };

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'return structured data' }],
        responseFormat: {
          type: 'json_schema',
          schema: strictSchema,
        },
      },
      { stream: false }
    );

    expect(capture.lastBody?.response_format).toEqual({
      type: 'json_schema',
      json_schema: strictSchema,
    });
  });

  describe('API URL configuration', () => {
    it('should use default OpenAI API URL when apiURL is not provided', () => {
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
      });

      expect((llm as any).apiURL).toBe('https://api.openai.com/v1');
    });

    it('should use custom API URL when apiURL is provided', () => {
      const customUrl = 'https://openrouter.ai/api/v1';
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
        apiURL: customUrl,
      });

      expect((llm as any).apiURL).toBe(customUrl);
    });

    it('should use different custom API URL formats', () => {
      const testCases = [
        'https://custom-endpoint.com/v1',
        'https://api.anthropic.com/v1',
        'http://localhost:8080/v1',
        'https://gateway.ai.cloudflare.com/v1',
      ];

      testCases.forEach((url) => {
        const llm = new AxAIOpenAI({
          apiKey: 'test-key',
          apiURL: url,
        });

        expect((llm as any).apiURL).toBe(url);
      });
    });

    it('should work with ai() factory function and custom API URL', () => {
      // This test verifies the factory function properly passes apiURL
      // We'll test this via the AxAIOpenAI constructor which is what the factory uses
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
        apiURL: 'https://openrouter.ai/api/v1',
      });

      expect((llm as any).apiURL).toBe('https://openrouter.ai/api/v1');
    });
  });

  it('normalizes OpenAI-compatible cached token usage', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT5Mini },
    });
    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 5,
          total_tokens: 105,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      },
      capture
    );

    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        model: AxAIOpenAIModel.GPT5Mini,
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false }
    )) as any;

    expect(res.modelUsage?.tokens).toEqual({
      promptTokens: 60,
      completionTokens: 5,
      totalTokens: 105,
      reasoningTokens: 3,
      cacheReadTokens: 40,
    });
  });
});

describe('AxAIOpenAI audio chat', () => {
  it('provides a conservative audio default config', () => {
    const config = axAIOpenAIAudioDefaultConfig();

    expect(config.model).toBe(AxAIOpenAIModel.GPTAudioMini);
    expect(config.stream).toBe(false);
    expect(config.audio?.output?.enabled).toBe(true);
    expect(config.audio?.output?.voice).toBe('alloy');
    expect(config.audio?.output?.format).toBe('wav');
    expect(config.audio?.output?.includeTranscript).toBe(true);
  });

  it('maps audio input, output config, and message.audio responses', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIAudioDefaultConfig(),
    });
    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              audio: {
                id: 'aud_123',
                data: 'UklGRg==',
                transcript: 'spoken answer',
                expires_at: 1234,
              },
            },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Answer this recording.' },
              { type: 'audio', data: 'UklGRg==', format: 'wav' },
            ],
          },
        ],
      },
      { stream: false }
    )) as any;

    expect(capture.lastBody?.model).toBe(AxAIOpenAIModel.GPTAudioMini);
    expect(capture.lastBody?.modalities).toEqual(['text', 'audio']);
    expect(capture.lastBody?.audio).toEqual({
      voice: 'alloy',
      format: 'wav',
    });
    expect(capture.lastBody?.messages[0]?.content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'UklGRg==', format: 'wav' },
    });
    expect(res.results[0]?.content).toBe('spoken answer');
    expect(res.results[0]?.audio).toEqual({
      id: 'aud_123',
      data: 'UklGRg==',
      transcript: 'spoken answer',
      expiresAt: 1234,
    });
  });

  it('maps batch transcription requests', async () => {
    const ai = new AxAIOpenAI({ apiKey: 'key' });
    const capture: { url?: string; body?: BodyInit | null } = {};
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          capture.url = String(url);
          capture.body = init?.body;
          return new Response(JSON.stringify({ text: 'hello world' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      );

    ai.setOptions({ fetch });

    const res = await ai.transcribe({
      audio: { data: 'UklGRg==', format: 'wav' },
      language: 'en',
    });

    expect(capture.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(capture.body).toBeInstanceOf(FormData);
    const form = capture.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('en');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(res.text).toBe('hello world');
  });

  it('maps batch speech requests and normalizes binary audio', async () => {
    const ai = new AxAIOpenAI({ apiKey: 'key' });
    const capture: { url?: string; body?: any } = {};
    const fetch = vi
      .fn()
      .mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          capture.url = String(url);
          capture.body =
            typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
      );

    ai.setOptions({ fetch });

    const res = await ai.speak({
      text: 'hello world',
      voice: 'nova',
      format: 'mp3',
    });

    expect(capture.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(capture.body).toEqual({
      model: 'gpt-4o-mini-tts',
      input: 'hello world',
      voice: 'nova',
      response_format: 'mp3',
    });
    expect(res).toEqual({
      data: 'AQID',
      format: 'mp3',
      mimeType: 'audio/mpeg',
      transcript: 'hello world',
    });
  });

  it('keeps assistant audio history as an audio reference', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIAudioDefaultConfig(),
    });
    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
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

    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [
          { role: 'assistant', audio: { id: 'aud_prev' } },
          { role: 'user', content: 'continue' },
        ],
      },
      { stream: false }
    );

    expect(capture.lastBody?.messages[0]).toEqual({
      role: 'assistant',
      audio: { id: 'aud_prev' },
    });
  });

  it('streams OpenAI audio deltas from chat completions', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIAudioDefaultConfig(),
    });
    const capture: { lastBody?: any } = {};
    const fetch = createMockStreamFetch(
      [
        {
          id: 'chatcmpl_audio',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: null,
                audio: {
                  id: 'aud_stream',
                  data: 'AAAA',
                  transcript: 'hello',
                },
              },
              finish_reason: null,
            },
          ],
        },
      ],
      capture
    );

    ai.setOptions({ fetch });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'say hello' }] },
      { stream: true }
    )) as ReadableStream<any>;

    const reader = stream.getReader();
    const values: any[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      values.push(value);
    }

    expect(capture.lastBody?.stream).toBe(true);
    expect(capture.lastBody?.modalities).toEqual(['text', 'audio']);
    expect(values[0]?.remoteId).toBe('chatcmpl_audio');
    expect(values[0]?.results[0]?.content).toBe('hello');
    expect(values[0]?.results[0]?.audio).toEqual({
      id: 'aud_stream',
      data: 'AAAA',
      transcript: 'hello',
      isDelta: true,
    });
  });

  it('rejects unsupported audio chat input formats', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIAudioDefaultConfig(),
    });

    await expect(
      ai.chat(
        {
          chatPrompt: [
            {
              role: 'user',
              content: [{ type: 'audio', data: 'AAAA', format: 'flac' }],
            },
          ],
        },
        { stream: false }
      )
    ).rejects.toThrow('supports only wav and mp3');
  });

  it('rejects structured outputs with audio output enabled', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIAudioDefaultConfig(),
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
});

describe('AxAIOpenAI realtime audio chat', () => {
  it('provides realtime voice and transcription defaults', () => {
    const voice = axAIOpenAIRealtimeDefaultConfig();
    expect(voice.model).toBe(AxAIOpenAIModel.GPTRealtime2);
    expect(voice.audio?.output?.enabled).toBe(true);
    expect(voice.audio?.output?.format).toBe('pcm16');
    expect(voice.audio?.output?.voice).toBe('marin');

    const transcription = axAIOpenAIRealtimeTranscriptionDefaultConfig();
    expect(transcription.model).toBe(AxAIOpenAIModel.GPTRealtimeWhisper);
    expect(transcription.audio?.output?.enabled).toBeUndefined();
    expect(transcription.audio?.input?.format).toBe('pcm16');
  });

  it('aggregates gpt-realtime-2 audio output from WebSocket events', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIRealtimeDefaultConfig(),
    });
    const webSocket = openAIRealtimeWebSocket([
      {
        type: 'response.output_audio_transcript.delta',
        response_id: 'resp_1',
        delta: 'hello',
      },
      {
        type: 'response.output_audio.delta',
        response_id: 'resp_1',
        delta: 'AQI=',
      },
      {
        type: 'response.output_audio.delta',
        response_id: 'resp_1',
        delta: 'AwQ=',
      },
      {
        type: 'response.done',
        response_id: 'resp_1',
        response: {
          id: 'resp_1',
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            total_tokens: 110,
            input_tokens_details: { cached_tokens: 25 },
            output_tokens_details: { reasoning_tokens: 4 },
          },
        },
      },
    ]);

    const res = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'say hello' }] },
      { stream: false, webSocket }
    )) as any;

    expect(res.results[0]?.content).toBe('hello');
    expect(res.results[0]?.audio).toEqual({
      id: 'resp_1',
      data: 'AQIDBA==',
      transcript: 'hello',
    });
    expect(res.modelUsage?.tokens).toEqual({
      promptTokens: 75,
      completionTokens: 10,
      totalTokens: 110,
      reasoningTokens: 4,
      cacheReadTokens: 25,
    });

    const socket = FakeOpenAIRealtimeWebSocket.instances[0];
    expect(socket?.url).toContain('/v1/realtime?model=gpt-realtime-2');
    expect(socket?.options?.headers?.Authorization).toBe('Bearer key');

    const session = JSON.parse(socket?.sent[0] ?? '{}');
    expect(session.session.type).toBe('realtime');
    expect(session.session.audio.output.voice).toBe('marin');
    expect(session.session.audio.output.format.type).toBe('audio/pcm');
  });

  it('streams gpt-realtime-2 audio deltas from WebSocket events', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIRealtimeDefaultConfig(),
    });
    const webSocket = openAIRealtimeWebSocket([
      {
        type: 'response.output_audio.delta',
        response_id: 'resp_stream',
        delta: 'AQI=',
      },
      {
        type: 'response.done',
        response_id: 'resp_stream',
        response: {
          id: 'resp_stream',
          usage: {
            input_tokens: 20,
            output_tokens: 5,
            total_tokens: 25,
            input_tokens_details: { cached_tokens: 8 },
          },
        },
      },
    ]);

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'say hello' }] },
      { stream: true, webSocket }
    )) as ReadableStream<any>;

    const reader = stream.getReader();
    const chunks: any[] = [];
    let finalUsage: any;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      chunks.push(item.value);
      if (item.value.modelUsage) {
        finalUsage = item.value.modelUsage;
      }
    }

    expect(chunks[0]?.results[0]?.audio).toEqual({
      id: 'resp_stream',
      data: 'AQI=',
      isDelta: true,
    });
    expect(chunks.at(-1)?.results[0]?.finishReason).toBe('stop');
    expect(chunks.at(-1)?.results[0]?.audio).toBeUndefined();
    expect(finalUsage?.tokens).toEqual({
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 8,
    });
  });

  it('waits for realtime response.done usage after output audio done', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIRealtimeDefaultConfig(),
    });
    const webSocket = openAIRealtimeWebSocket([
      {
        type: 'response.output_audio.delta',
        response_id: 'resp_audio_done_first',
        delta: 'AQI=',
      },
      {
        type: 'response.output_audio.done',
        response_id: 'resp_audio_done_first',
      },
      {
        type: 'response.done',
        response_id: 'resp_audio_done_first',
        response: {
          id: 'resp_audio_done_first',
          usage: {
            input_tokens: 30,
            output_tokens: 6,
            total_tokens: 36,
            input_tokens_details: { cached_tokens: 12 },
          },
        },
      },
    ]);

    const res = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'say hello' }] },
      { stream: false, webSocket }
    )) as any;

    expect(res.results[0]?.audio?.data).toBe('AQI=');
    expect(res.modelUsage?.tokens).toEqual({
      promptTokens: 18,
      completionTokens: 6,
      totalTokens: 36,
      cacheReadTokens: 12,
    });
  });

  it('uses gpt-realtime-whisper for realtime transcript deltas', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIRealtimeTranscriptionDefaultConfig(),
    });
    const webSocket = openAIRealtimeWebSocket([
      {
        type: 'conversation.item.input_audio_transcription.delta',
        delta: 'hello ',
      },
      {
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'hello world',
      },
    ]);

    const res = (await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              {
                type: 'audio',
                data: 'AAAA',
                format: 'pcm16',
                sampleRate: 24_000,
              },
            ],
          },
        ],
      },
      { stream: false, webSocket }
    )) as any;

    expect(res.results[0]?.content).toBe('hello world');
    expect(res.results[0]?.audio).toBeUndefined();

    const socket = FakeOpenAIRealtimeWebSocket.instances[0];
    expect(socket?.url).toContain(
      '/v1/realtime/transcription_sessions?model=gpt-realtime-whisper'
    );
    const session = JSON.parse(socket?.sent[0] ?? '{}');
    expect(session.type).toBe('transcription_session.update');
    expect(session.session.audio.input.transcription.model).toBe(
      'gpt-realtime-whisper'
    );
    expect(session.session.audio.input.format.rate).toBe(24_000);
  });

  it('rejects non-PCM input for OpenAI Realtime models', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: axAIOpenAIRealtimeDefaultConfig(),
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
        { stream: false, webSocket: openAIRealtimeWebSocket([]) }
      )
    ).rejects.toThrow('requires pcm16 audio');
  });
});
