import { describe, expect, it, vi } from 'vitest';
import {
  AxAIGrok,
  axAIGrokDefaultConfig,
  axAIGrokVoiceDefaultConfig,
} from './api.js';
import { AxAIGrokModel } from './types.js';

function createMockFetch(capture: { lastBody?: any }) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body && typeof init.body === 'string') {
        capture.lastBody = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: capture.lastBody?.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok', refusal: null },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
}

class FakeGrokRealtimeWebSocket {
  static serverMessages: unknown[] = [];
  static instances: FakeGrokRealtimeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  readonly options: any;
  private readonly listeners = new Map<string, ((event: any) => void)[]>();

  constructor(url: string, options?: any) {
    this.url = url;
    this.options = options;
    FakeGrokRealtimeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
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

    if (message.type === 'response.create') {
      queueMicrotask(() => {
        for (const serverMessage of FakeGrokRealtimeWebSocket.serverMessages) {
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
  }
}

function grokRealtimeWebSocket(messages: unknown[]) {
  FakeGrokRealtimeWebSocket.serverMessages = messages;
  FakeGrokRealtimeWebSocket.instances = [];
  return FakeGrokRealtimeWebSocket as any;
}

describe('AxAIGrok models', () => {
  it('defaults to Grok 4.3 and exposes current model capabilities', () => {
    expect(axAIGrokDefaultConfig().model).toBe(AxAIGrokModel.Grok43);

    const ai = new AxAIGrok({
      apiKey: 'key',
      config: { model: AxAIGrokModel.Grok43Latest },
    });

    const features = ai.getFeatures(AxAIGrokModel.GrokLatest);
    expect(features.hasThinkingBudget).toBe(true);
    expect(features.structuredOutputs).toBe(true);
    expect(features.media.images.supported).toBe(true);
    expect(features.media.urls.webSearch).toBe(true);
  });

  it('maps thinking budget only for Grok 4.3 requests', async () => {
    const grok43Capture: { lastBody?: any } = {};
    const grok43 = new AxAIGrok({
      apiKey: 'key',
      config: {
        model: AxAIGrokModel.Grok43,
        presencePenalty: 0.1,
        frequencyPenalty: 0.1,
        stopSequences: ['END'],
      },
      options: { fetch: createMockFetch(grok43Capture) },
    });

    await grok43.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(grok43Capture.lastBody.reasoning_effort).toBe('high');
    expect(grok43Capture.lastBody.presence_penalty).toBeUndefined();
    expect(grok43Capture.lastBody.frequency_penalty).toBeUndefined();
    expect(grok43Capture.lastBody.stop).toBeUndefined();

    const fastCapture: { lastBody?: any } = {};
    const fast = new AxAIGrok({
      apiKey: 'key',
      config: { model: AxAIGrokModel.Grok41FastReasoning },
      options: { fetch: createMockFetch(fastCapture) },
    });

    await fast.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(fastCapture.lastBody.reasoning_effort).toBeUndefined();
  });
});

describe('AxAIGrok voice audio', () => {
  it('uses xAI realtime voice defaults and session shape', async () => {
    const ai = new AxAIGrok({
      apiKey: 'key',
      config: axAIGrokVoiceDefaultConfig(),
    });
    const webSocket = grokRealtimeWebSocket([
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
      { type: 'response.done', response_id: 'resp_1' },
    ]);

    const res = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'say hello' }] },
      { stream: false, webSocket }
    )) as any;

    expect(res.results[0]?.content).toBe('hello');
    expect(res.results[0]?.audio).toEqual({
      id: 'resp_1',
      data: 'AQI=',
      transcript: 'hello',
    });

    const socket = FakeGrokRealtimeWebSocket.instances[0];
    expect(socket?.url).toContain(
      '/v1/realtime?model=grok-voice-think-fast-1.0'
    );
    expect(socket?.options?.headers?.Authorization).toBe('Bearer key');

    const session = JSON.parse(socket?.sent[0] ?? '{}');
    expect(session).toMatchObject({
      type: 'session.update',
      session: {
        voice: 'eve',
        turn_detection: null,
        audio: {
          input: { format: { type: 'audio/pcm', rate: 24_000 } },
          output: { format: { type: 'audio/pcm', rate: 24_000 } },
        },
      },
    });
    expect(session.session.type).toBeUndefined();
    expect(session.session.model).toBeUndefined();
    expect(session.session.output_modalities).toBeUndefined();
  });
});
