import { describe, expect, it, vi } from 'vitest';

import { MemoryImpl } from '../../mem/memory.js';
import { axGetSupportedAIModels } from '../catalog.js';
import { AxAIOpenAIResponsesImpl } from '../openai/responses_api.js';
import type { OpenAIResponsesResponseDelta } from '../openai/responses_types.js';
import { axGetAIProfile } from '../provider_profiles.js';
import type { AxChatResponse } from '../types.js';
import { ai } from '../wrap.js';
import { AxAIMetaModel } from './types.js';

describe('Meta Model API profiles', () => {
  it('registers all three API surfaces with Muse Spark 1.3 defaults', () => {
    expect(axGetAIProfile('meta')).toMatchObject({
      transport: 'openai-responses',
      baseURL: 'https://api.meta.ai/v1',
      defaultModel: AxAIMetaModel.MuseSpark13,
    });
    expect(axGetAIProfile('meta-chat').transport).toBe('openai-chat');
    expect(axGetAIProfile('meta-messages').transport).toBe(
      'anthropic-messages'
    );
  });

  it('uses stateless Responses reasoning and replays encrypted state', async () => {
    const bodies: Record<string, any>[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'response-1',
          object: 'response',
          created: 1,
          model: AxAIMetaModel.MuseSpark13,
          output: [
            {
              type: 'reasoning',
              id: 'reasoning-1',
              status: 'completed',
              summary: [{ type: 'summary_text', text: 'Checked the facts.' }],
              encrypted_content: 'opaque-state',
            },
            {
              type: 'message',
              id: 'message-1',
              role: 'assistant',
              status: 'completed',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: 'Done.' }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    });
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13, stream: false },
      options: { fetch, promptCacheKey: 'spark-session' },
    });

    const first = await service.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'solve it', cache: true }],
          },
        ],
      },
      { thinkingTokenBudget: 'highest', showThoughts: true }
    );
    if (first instanceof ReadableStream) throw new Error('expected response');

    expect(bodies[0]).toMatchObject({
      model: AxAIMetaModel.MuseSpark13,
      store: false,
      reasoning: { effort: 'xhigh', summary: 'auto' },
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: 'spark-session',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'solve it',
            },
          ],
        },
      ],
    });
    expect(first.results[0]).toMatchObject({
      content: 'Done.',
      phase: 'final_answer',
      thought: 'Checked the facts.',
      thoughtBlocks: [
        {
          id: 'reasoning-1',
          data: 'Checked the facts.',
          summary: 'Checked the facts.',
          encrypted: true,
          encryptedContent: 'opaque-state',
        },
      ],
    });

    await service.chat({
      chatPrompt: [
        { role: 'user', content: 'solve it' },
        {
          role: 'assistant',
          content: 'Done.',
          thought: first.results[0]?.thought,
          thoughtBlocks: first.results[0]?.thoughtBlocks,
        },
        { role: 'user', content: 'continue' },
      ],
    });
    expect((bodies[1]?.input as any[])[1]).toMatchObject({
      type: 'reasoning',
      id: 'reasoning-1',
      encrypted_content: 'opaque-state',
      summary: [{ type: 'summary_text', text: 'Checked the facts.' }],
    });

    await expect(
      service.chat(
        { chatPrompt: [{ role: 'user', content: 'skip reasoning' }] },
        { thinkingTokenBudget: 'none' }
      )
    ).rejects.toThrow('does not support reasoning level none');
  });

  it('returns Muse Image output through chat and replays it normally', async () => {
    const bodies: Record<string, any>[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'response-image',
          object: 'response',
          created: 1,
          model: AxAIMetaModel.MuseImage10,
          output: [
            {
              type: 'reasoning',
              id: 'image-plan',
              summary: [
                { type: 'summary_text', text: 'Planned the composition.' },
              ],
            },
            {
              type: 'image_generation_call',
              id: 'image-1',
              status: 'completed',
              result: 'aW1hZ2U=',
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    });
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: {
        model: AxAIMetaModel.MuseImage10,
        stream: false,
        imageGeneration: {
          size: '1024x1536',
          outputFormat: 'webp',
          enableImageSearch: true,
        },
      },
      options: { fetch },
    });
    const response = await service.chat({
      chatPrompt: [{ role: 'user', content: 'paint a lighthouse' }],
    });
    if (response instanceof ReadableStream)
      throw new Error('expected response');

    expect(bodies[0]?.tools).toEqual([
      {
        type: 'image_generation',
        size: '1024x1536',
        output_format: 'webp',
        enable_image_search: true,
      },
    ]);
    expect(response.results[0]?.images).toEqual([
      {
        id: 'image-1',
        data: 'aW1hZ2U=',
        mimeType: 'image/webp',
      },
    ]);
    expect(response.results[0]?.functionCalls).toBeUndefined();

    await service.chat({
      chatPrompt: [
        { role: 'user', content: 'paint a lighthouse' },
        {
          role: 'assistant',
          images: response.results[0]?.images,
          thoughtBlocks: response.results[0]?.thoughtBlocks,
        },
        { role: 'user', content: 'make it sunset' },
      ],
    });
    expect((bodies[1]?.input as any[])[1]).toMatchObject({
      type: 'image_generation_call',
      id: 'image-1',
      status: 'completed',
      result: null,
    });
    expect(
      (bodies[1]?.input as any[]).some((item) => item.type === 'reasoning')
    ).toBe(false);

    await expect(
      service.chat({
        chatPrompt: [{ role: 'user', content: 'draw' }],
        functions: [{ name: 'ordinaryTool' }],
      })
    ).rejects.toThrow('does not permit function tools');
  });

  it('maps Spark functions, structured output, citations, and tool validation', async () => {
    const bodies: Record<string, any>[] = [];
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13, stream: false },
      options: {
        fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              id: 'response-tools',
              object: 'response',
              created: 1,
              model: AxAIMetaModel.MuseSpark13,
              output: [
                {
                  type: 'message',
                  id: 'message-cited',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    {
                      type: 'output_text',
                      text: '{"answer":"Ax"}',
                      annotations: [
                        {
                          type: 'url_citation',
                          url: 'https://axllm.dev',
                          title: 'Ax',
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'function_call',
                  id: 'tool-item',
                  call_id: 'call-1',
                  name: 'lookup',
                  arguments: '{"topic":"Ax"}',
                },
              ],
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }),
      },
    });

    const response = await service.chat({
      chatPrompt: [{ role: 'user', content: 'look it up' }],
      functions: [
        {
          name: 'lookup',
          description: 'Look up a topic',
          parameters: {
            type: 'object',
            properties: { topic: { type: 'string' } },
            required: ['topic'],
          },
        },
      ],
      responseFormat: {
        type: 'json_schema',
        schema: {
          name: 'answer',
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
            required: ['answer'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });
    if (response instanceof ReadableStream)
      throw new Error('expected response');

    expect(bodies[0]).toMatchObject({
      tools: [{ type: 'function', name: 'lookup' }],
      text: { format: { type: 'json_schema' } },
    });
    expect(response.results[0]?.functionCalls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'lookup', params: '{"topic":"Ax"}' },
      },
    ]);
    expect(response.results[0]?.citations).toEqual([
      { url: 'https://axllm.dev', title: 'Ax' },
    ]);

    await expect(
      service.chat({
        chatPrompt: [{ role: 'user', content: 'force it' }],
        functions: [{ name: 'lookup', description: 'Look up a topic' }],
        functionCall: { type: 'function', function: { name: 'lookup' } },
      })
    ).rejects.toThrow('does not support explicitly named tool choices');
  });

  it('maps partial streamed image output to images', () => {
    const impl = new AxAIOpenAIResponsesImpl(
      {
        model: AxAIMetaModel.MuseImage10,
        imageGeneration: { outputFormat: 'png' },
      },
      true
    );
    const response = impl.createChatStreamResp(
      {
        type: 'response.image_generation_call.partial_image',
        item_id: 'image-1',
        output_index: 0,
        partial_image_index: 0,
        partial_image_b64: 'AAAA',
        sequence_number: 1,
      } as OpenAIResponsesResponseDelta,
      {}
    ) as AxChatResponse;
    expect(response.results[0]?.images).toEqual([
      {
        id: 'image-1',
        data: 'AAAA',
        mimeType: 'image/png',
        isDelta: true,
      },
    ]);
    expect(response.results[0]?.finishReason).toBeUndefined();
  });

  it('preserves encrypted-only reasoning and merges replay metadata by item ID', () => {
    const impl = new AxAIOpenAIResponsesImpl(
      { model: AxAIMetaModel.MuseSpark13, includeEncryptedReasoning: true },
      true
    );
    const response = impl.createChatResp({
      id: 'response-encrypted',
      object: 'response',
      created: 1,
      model: AxAIMetaModel.MuseSpark13,
      output: [
        {
          type: 'reasoning',
          id: 'reasoning-only',
          summary: [],
          encrypted_content: 'opaque-only',
        },
      ],
    });
    expect(response.results[0]?.thoughtBlocks).toEqual([
      {
        id: 'reasoning-only',
        data: '',
        summary: '',
        encrypted: true,
        encryptedContent: 'opaque-only',
      },
    ]);

    const memory = new MemoryImpl();
    memory.updateResult({
      index: 0,
      thoughtBlocks: [
        {
          id: 'commentary',
          data: 'Checking.',
          encrypted: false,
          phase: 'commentary',
        },
      ],
    });
    memory.updateResult(
      impl.createChatStreamResp(
        {
          type: 'response.reasoning_summary_text.delta',
          item_id: 'reasoning',
          delta: 'Plan',
        } as OpenAIResponsesResponseDelta,
        {}
      ).results[0]!
    );
    memory.updateResult(
      impl.createChatStreamResp(
        {
          type: 'response.output_item.done',
          item: {
            type: 'reasoning',
            id: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Plan.' }],
            encrypted_content: 'opaque-final',
          },
        } as OpenAIResponsesResponseDelta,
        {}
      ).results[0]!
    );
    memory.updateResult({
      index: 0,
      thoughtBlocks: response.results[0]!.thoughtBlocks,
    });
    expect(memory.history(0)[0]).toMatchObject({
      thoughtBlocks: [
        { id: 'commentary', data: 'Checking.', phase: 'commentary' },
        {
          id: 'reasoning',
          data: 'Plan.',
          summary: 'Plan.',
          encryptedContent: 'opaque-final',
        },
        { id: 'reasoning-only', data: '', encryptedContent: 'opaque-only' },
      ],
    });
  });

  it('labels default Muse Image output as WebP', async () => {
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseImage10, stream: false },
      options: {
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                id: 'image-response',
                object: 'response',
                created: 1,
                model: AxAIMetaModel.MuseImage10,
                output: [
                  {
                    type: 'image_generation_call',
                    id: 'image-default',
                    result: 'AAAA',
                  },
                  {
                    type: 'image_generation_call',
                    id: 'image-url',
                    result: 'https://example.com/image.webp',
                  },
                ],
              }),
              { headers: { 'Content-Type': 'application/json' } }
            )
        ),
      },
    });
    const response = await service.chat({
      chatPrompt: [{ role: 'user', content: 'Draw a boat' }],
    });
    if (response instanceof ReadableStream)
      throw new Error('expected response');
    expect(response.results[0]?.images?.[0]?.mimeType).toBe('image/webp');
    expect(response.results[0]?.images).toHaveLength(2);
    expect(response.results[0]?.images?.[1]?.url).toBe(
      'https://example.com/image.webp'
    );
  });

  it('uses Chat Completions and Messages independently', async () => {
    const chatCapture: Record<string, any> = {};
    const chat = ai({
      name: 'meta-chat',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13, stream: false },
      options: {
        promptCacheKey: 'chat-session',
        fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          chatCapture.url = String(url);
          chatCapture.headers = new Headers(init?.headers);
          chatCapture.body = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              id: 'chat-1',
              model: AxAIMetaModel.MuseSpark13,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'chat ok' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }),
      },
    });
    await chat.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            cache: true,
            content: [
              { type: 'text', text: 'hi' },
              {
                type: 'file',
                mimeType: 'application/pdf',
                data: 'cGRm',
                filename: 'brief.pdf',
              },
              {
                type: 'file',
                mimeType: 'video/mp4',
                fileUri: 'https://example.com/clip.mp4',
              },
            ],
          },
        ],
      },
      { thinkingTokenBudget: 'highest' }
    );
    expect(chatCapture.url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(chatCapture.body.reasoning_effort).toBe('xhigh');
    expect(chatCapture.body.prompt_cache_key).toBe('chat-session');
    expect(chatCapture.body).not.toHaveProperty('prompt_cache_options');
    expect(chatCapture.body.messages[0].content).toEqual([
      { type: 'text', text: 'hi' },
      {
        type: 'file',
        file: {
          file_data: 'data:application/pdf;base64,cGRm',
          filename: 'brief.pdf',
        },
      },
      {
        type: 'video_url',
        video_url: { url: 'https://example.com/clip.mp4' },
      },
    ]);
    expect(chatCapture.headers.get('authorization')).toBe('Bearer meta-key');

    const messagesCapture: Record<string, any> = {};
    const messages = ai({
      name: 'meta-messages',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13, stream: false },
      options: {
        fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          messagesCapture.url = String(url);
          messagesCapture.headers = new Headers(init?.headers);
          messagesCapture.body = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              id: 'message-1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'messages ok' }],
              model: AxAIMetaModel.MuseSpark13,
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }),
      },
    });
    await messages.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi', cache: true }],
        responseFormat: {
          type: 'json_schema',
          schema: {
            name: 'answer',
            schema: {
              type: 'object',
              properties: { answer: { type: 'string' } },
              required: ['answer'],
            },
          },
        },
      },
      { thinkingTokenBudget: 'highest' }
    );
    expect(messagesCapture.url).toBe('https://api.meta.ai/v1/messages');
    expect(messagesCapture.body.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
    expect(messagesCapture.body.output_config).toMatchObject({
      effort: 'xhigh',
      format: { type: 'json_schema' },
    });
    expect(messagesCapture.body.reasoning_effort).toBeUndefined();
    expect(JSON.stringify(messagesCapture.body)).not.toContain('cache_control');
    expect(messagesCapture.headers.get('authorization')).toBe(
      'Bearer meta-key'
    );
    expect(messagesCapture.headers.has('x-api-key')).toBe(false);
    await messages.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Do not use tools' }],
        functions: [{ name: 'lookup' }],
        functionCall: 'none',
      },
      { thinkingTokenBudget: 'minimal' }
    );
    expect(messagesCapture.body.tool_choice).toEqual({ type: 'none' });
    expect(messagesCapture.body.output_config.effort).toBe('low');
    expect(messagesCapture.body.reasoning_effort).toBeUndefined();
    await expect(
      messages.chat({
        chatPrompt: [{ role: 'user', content: 'Force a tool' }],
        functions: [{ name: 'lookup' }],
        functionCall: { type: 'function', function: { name: 'lookup' } },
      })
    ).rejects.toThrow('does not support explicitly named tool choices');
  });

  it('maps Muse Voice batch multipart and normalizes turns', async () => {
    const capture: Record<string, any> = {};
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13, stream: false },
      options: {
        fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
          capture.url = String(url);
          capture.headers = new Headers(init?.headers);
          const form = init?.body as FormData;
          const requestPart = form.get('request');
          if (!(requestPart instanceof Blob)) throw new Error('request blob');
          capture.requestType = requestPart.type;
          capture.request = JSON.parse(await requestPart.text());
          capture.audio = form.get('audio');
          return new Response(
            JSON.stringify({
              sessionId: 'session-1',
              transcript: 'Hello world',
              audioDurationMs: 2250,
              turns: [
                {
                  turnId: 'turn-1',
                  startMs: 250,
                  endMs: 2250,
                  transcript: 'Hello world',
                  speaker: 'speaker-1',
                },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        }),
      },
    });
    const response = await service.transcribe({
      model: AxAIMetaModel.MuseVoiceTranscribe10,
      audio: { data: 'UklGRg==', format: 'wav' },
      mode: 'diarization',
      languageBias: ['en', 'es'],
      keywords: ['Ax'],
      partialMode: 'delta',
      emitAudioProgress: true,
      sessionId: 'caller-session',
    });

    expect(capture.url).toBe(
      'https://api.meta.ai/v1/asr/transcribe?sessionId=caller-session'
    );
    expect(capture.requestType).toBe('application/json');
    expect(capture.request).toMatchObject({
      model: AxAIMetaModel.MuseVoiceTranscribe10,
      audioEncoding: 'WAV',
      mode: 'DIARIZATION',
      languageBias: ['en', 'es'],
      keywords: ['Ax'],
      partialMode: 'DELTA',
      emitAudioProgress: true,
    });
    expect(capture.request).not.toHaveProperty('sessionId');
    expect(capture.audio).toBeInstanceOf(Blob);
    expect(response).toEqual({
      text: 'Hello world',
      duration: 2.25,
      sessionId: 'session-1',
      segments: [
        {
          id: 'turn-1',
          text: 'Hello world',
          start: 0.25,
          end: 2.25,
          speaker: 'speaker-1',
        },
      ],
    });

    await expect(
      service.transcribe({
        model: AxAIMetaModel.MuseSpark13,
        audio: { data: 'UklGRg==', format: 'wav' },
      })
    ).rejects.toThrow(
      `Meta Voice transcribe requires ${AxAIMetaModel.MuseVoiceTranscribe10}`
    );
  });

  it('folds Muse Voice batch SSE progress, diarization, and overlapping turns', async () => {
    const events = [
      { type: 'speechStart', turnId: 'turn-1', audioProcessedMs: 0 },
      { type: 'transcript', transcript: 'Hello', audioProcessedMs: 100 },
      { type: 'speaker', label: 'speaker-1' },
      { type: 'speechStart', turnId: 'turn-2', audioProcessedMs: 120 },
      { type: 'transcript', transcript: 'Second', audioProcessedMs: 200 },
      { type: 'speaker', label: 'speaker-2' },
      {
        type: 'speechComplete',
        turnId: 'turn-1',
        transcript: 'Hello world',
        audioProcessedMs: 300,
      },
      {
        type: 'speechComplete',
        turnId: 'turn-2',
        transcript: 'Second turn',
        audioProcessedMs: 400,
      },
      {
        type: 'audioProgress',
        sessionId: 'server-session',
        audioProcessedMs: 450,
      },
    ];
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13 },
      options: {
        fetch: vi.fn(
          async () =>
            new Response(
              events
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
              { headers: { 'Content-Type': 'text/event-stream' } }
            )
        ),
      },
    });
    const response = await service.transcribe({
      model: AxAIMetaModel.MuseVoiceTranscribe10,
      audio: { data: 'UklGRg==', format: 'wav' },
      partialMode: 'cumulative',
      emitAudioProgress: true,
    });
    expect(response).toMatchObject({
      text: 'Hello world\nSecond turn',
      duration: 0.45,
      audioProcessedMs: 450,
      sessionId: 'server-session',
      segments: [
        { id: 'turn-1', text: 'Hello world', speaker: 'speaker-1' },
        { id: 'turn-2', text: 'Second turn', speaker: 'speaker-2' },
      ],
    });
  });

  it('streams Muse Voice PCM with handshake auth and graceful endStream', async () => {
    class MockWebSocket {
      static instance: MockWebSocket;
      readonly sent: Array<string | Uint8Array> = [];
      readonly listeners = new Map<string, Array<(event: any) => void>>();
      readonly url: string;

      constructor(url: string) {
        this.url = url;
        MockWebSocket.instance = this;
        queueMicrotask(() => this.emit('open', {}));
      }

      addEventListener(type: string, listener: (event: any) => void) {
        this.listeners.set(type, [
          ...(this.listeners.get(type) ?? []),
          listener,
        ]);
      }

      send(data: string | Uint8Array) {
        this.sent.push(data);
        if (this.sent.length === 1) {
          queueMicrotask(() => this.message({ sessionId: 'voice-session' }));
          return;
        }
        if (data === JSON.stringify({ type: 'endStream' })) {
          queueMicrotask(() => {
            this.message({
              type: 'speechStart',
              sessionId: 'voice-session',
              turnId: 'turn-1',
            });
            this.message({
              type: 'transcript',
              transcript: 'Hello',
              audioProcessedMs: 100,
            });
            this.message({
              type: 'speaker',
              label: 'speaker-1',
              audioProcessedMs: 100,
            });
            this.message({
              type: 'speechStart',
              turnId: 'turn-2',
            });
            this.message({
              type: 'transcript',
              transcript: 'Second',
            });
            this.message({
              type: 'speaker',
              label: 'speaker-2',
              audioProcessedMs: 200,
            });
            this.message({
              type: 'audioProgress',
              audioProcessedMs: 250,
            });
            this.message({
              type: 'speechComplete',
              turnId: 'turn-1',
              transcript: 'Hello world',
              audioProcessedMs: 300,
            });
            this.message({
              type: 'speechComplete',
              turnId: 'turn-2',
              transcript: 'Second turn',
              audioProcessedMs: 400,
            });
            queueMicrotask(() => this.emit('close', { code: 1000 }));
          });
        }
      }

      close() {}

      private message(value: object) {
        this.emit('message', { data: JSON.stringify(value) });
      }

      private emit(type: string, event: any) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }

    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: {
        model: AxAIMetaModel.MuseSpark13,
        realtimeTranscription: {
          mode: 'diarization',
          languageBias: ['en'],
          keywords: ['Ax'],
          partialMode: 'cumulative',
          emitAudioProgress: true,
        },
      },
      options: { webSocket: MockWebSocket },
    });
    const stream = await service.chat(
      {
        model: AxAIMetaModel.MuseVoiceTranscribe10,
        modelConfig: {
          stream: true,
          audio: {
            input: {
              format: 'pcm16',
              mimeType: 'audio/pcm',
              sampleRate: 24_000,
              channels: 1,
            },
          },
        },
        chatPrompt: [
          {
            role: 'user',
            content: [{ type: 'audio', data: 'AAE=', format: 'pcm16' }],
          },
        ],
      },
      { sessionId: 'caller-session' }
    );
    if (!(stream instanceof ReadableStream)) throw new Error('expected stream');
    const chunks: AxChatResponse[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(MockWebSocket.instance.url).toBe(
      'wss://api.meta.ai/v1/asr/realtime?sessionId=caller-session'
    );
    const handshake = JSON.parse(MockWebSocket.instance.sent[0] as string);
    expect(handshake).toMatchObject({
      model: AxAIMetaModel.MuseVoiceTranscribe10,
      authorization: { accessToken: 'Bearer meta-key' },
      mode: 'DIARIZATION',
      languageBias: ['en'],
      keywords: ['Ax'],
      partialMode: 'CUMULATIVE',
      emitAudioProgress: true,
      audioEncoding: 'PCM_24KHZ',
    });
    expect(MockWebSocket.instance.sent[1]).toBeInstanceOf(Uint8Array);
    expect(MockWebSocket.instance.sent.at(-1)).toBe(
      JSON.stringify({ type: 'endStream' })
    );
    expect(
      chunks.flatMap((chunk) => chunk.results).map((result) => result.content)
    ).toEqual(expect.arrayContaining(['Hello world', 'Second turn']));
    expect(
      chunks
        .flatMap((chunk) => chunk.results)
        .map((result) => result.name)
        .filter(Boolean)
    ).toEqual(expect.arrayContaining(['speaker-1', 'speaker-2']));
    expect(chunks.at(-1)?.results[0]?.finishReason).toBe('stop');
    expect(chunks.at(-1)?.remoteSessionId).toBe('voice-session');
  });

  it('rejects abnormal Node-style realtime closure', async () => {
    class NodeMockWebSocket {
      readonly listeners = new Map<string, (...args: any[]) => void>();
      constructor(_url: string) {
        queueMicrotask(() => this.listeners.get('open')?.({}));
      }
      on(type: string, listener: (...args: any[]) => void) {
        this.listeners.set(type, listener);
      }
      send(data: string | Uint8Array) {
        if (typeof data === 'string' && data.includes('authorization')) {
          queueMicrotask(() =>
            this.listeners.get('message')?.(
              JSON.stringify({ sessionId: 'node-session' })
            )
          );
        } else if (data === JSON.stringify({ type: 'endStream' })) {
          queueMicrotask(() => this.listeners.get('close')?.(1011, 'failed'));
        }
      }
      close() {}
    }
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      config: { model: AxAIMetaModel.MuseSpark13, stream: false },
      options: { webSocket: NodeMockWebSocket },
    });
    await expect(
      service.chat({
        model: AxAIMetaModel.MuseVoiceTranscribe10,
        modelConfig: {
          stream: false,
          audio: { input: { sampleRate: 16_000, channels: 1 } },
        },
        chatPrompt: [
          {
            role: 'user',
            content: [{ type: 'audio', data: 'AAE=', format: 'pcm16' }],
          },
        ],
      })
    ).rejects.toThrow('closed before graceful completion (code 1011)');
  });

  it('preserves provider errors before the realtime handshake completes', async () => {
    class RejectedSocket {
      readonly listeners = new Map<string, (event: any) => void>();
      constructor(_url: string) {
        queueMicrotask(() => this.listeners.get('open')?.({}));
      }
      addEventListener(type: string, listener: (event: any) => void) {
        this.listeners.set(type, listener);
      }
      send(_data: string | Uint8Array) {
        queueMicrotask(() =>
          this.listeners.get('message')?.({
            data: JSON.stringify({
              type: 'error',
              message: 'Invalid access token',
            }),
          })
        );
      }
      close() {}
    }
    const service = ai({
      name: 'meta',
      apiKey: 'invalid-key',
      config: { model: AxAIMetaModel.MuseVoiceTranscribe10, stream: false },
      options: { webSocket: RejectedSocket },
    });
    await expect(
      service.chat({
        chatPrompt: [
          {
            role: 'user',
            content: [{ type: 'audio', data: 'AAE=', format: 'pcm16' }],
          },
        ],
      })
    ).rejects.toThrow('Invalid access token');
  });

  it('honors a custom realtime endpoint and closes the socket on cancellation', async () => {
    class CancellableSocket {
      static instance: CancellableSocket;
      readonly listeners = new Map<string, (event: any) => void>();
      closed = false;
      constructor(readonly url: string) {
        CancellableSocket.instance = this;
        queueMicrotask(() => this.listeners.get('open')?.({}));
      }
      addEventListener(type: string, listener: (event: any) => void) {
        this.listeners.set(type, listener);
      }
      send(data: string | Uint8Array) {
        if (typeof data === 'string' && data.includes('authorization')) {
          queueMicrotask(() => {
            for (const message of [
              { sessionId: 'cancel-session' },
              { type: 'speechStart', turnId: 'turn-1' },
              { type: 'transcript', transcript: 'Hello' },
            ])
              this.listeners.get('message')?.({
                data: JSON.stringify(message),
              });
          });
        }
      }
      close() {
        this.closed = true;
      }
    }
    const service = ai({
      name: 'meta',
      apiKey: 'meta-key',
      apiURL: 'https://proxy.example/v1',
      config: { model: AxAIMetaModel.MuseVoiceTranscribe10, stream: true },
      options: { webSocket: CancellableSocket },
    });
    const stream = await service.chat({
      chatPrompt: [
        {
          role: 'user',
          content: [{ type: 'audio', data: 'AAE=', format: 'pcm16' }],
        },
      ],
    });
    if (!(stream instanceof ReadableStream)) throw new Error('expected stream');
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(CancellableSocket.instance.url).toBe(
      'wss://proxy.example/v1/asr/realtime'
    );
    await vi.waitFor(() =>
      expect(CancellableSocket.instance.closed).toBe(true)
    );
  });

  it('catalogs image output and Contributor data use without defaulting to it', () => {
    const meta = axGetSupportedAIModels().find(
      (provider) => provider.name === 'meta'
    );
    const image = meta?.models.find(
      (model) => model.name === AxAIMetaModel.MuseImage10
    );
    const contributor = meta?.models.find(
      (model) => model.name === AxAIMetaModel.MuseSpark13Contributor
    );
    const spark = meta?.models.find(
      (model) => model.name === AxAIMetaModel.MuseSpark13
    );
    const messagesSpark = axGetSupportedAIModels()
      .find((provider) => provider.name === 'meta-messages')
      ?.models.find((model) => model.name === AxAIMetaModel.MuseSpark13);
    expect(meta?.defaultModel).toBe(AxAIMetaModel.MuseSpark13);
    expect(meta?.capabilities.thinkingLevels).not.toContain('none');
    expect(spark).toMatchObject({
      type: 'text',
      capabilities: { audioInput: true },
    });
    expect(spark?.capabilities.thinkingLevels).not.toContain('none');
    expect(messagesSpark).toMatchObject({
      supported: {
        structuredOutputs: true,
        structuredOutputModes: ['native', 'function'],
      },
      capabilities: { structuredOutputs: true },
    });
    expect(image).toMatchObject({
      type: 'image',
      capabilities: {
        textInput: true,
        imageInput: true,
        textOutput: false,
        imageOutput: true,
      },
    });
    expect(contributor).toMatchObject({
      isDefault: false,
      dataUse: {
        providerTraining: 'allowed',
        appliesTo: ['prompt', 'completion'],
      },
    });
    expect(
      axGetSupportedAIModels({ type: 'image' })
        .find((provider) => provider.name === 'meta')
        ?.models.map((model) => model.name)
    ).toEqual([AxAIMetaModel.MuseImage10]);
  });
});
