import type { AxAPI } from '../../util/apicall.js';
import {
  axIsAudioOutputEnabled,
  axMergeChatAudioConfig,
  axOpenAIChatAudioDefaults,
} from '../audio/defaults.js';
import type { AxAudioFormat, AxChatAudioConfig } from '../audio/types.js';
import { axAudioFormatFromMimeType, axConcatBase64 } from '../audio/util.js';
import { axBaseAIDefaultConfig } from '../base.js';
import {
  type AxAIOpenAIChatRequest,
  type AxAIOpenAIChatResponse,
  type AxAIOpenAIChatResponseDelta,
  type AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from './chat_types.js';

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener?: (
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
    options?: { once?: boolean }
  ) => void;
  on?: (type: 'open' | 'message' | 'error' | 'close', listener: any) => void;
  onopen?: (event: any) => void;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  onclose?: (event: any) => void;
};

export type OpenAIRealtimeRequest<TModel> = {
  model: TModel;
  request: AxAIOpenAIChatRequest<TModel>;
  apiKey: string;
  audio: AxChatAudioConfig;
  webSocket?: any;
  debug?: boolean;
  apiName?: string;
  providerName?: string;
  wsURL?: (model: string) => string;
  createSessionUpdate?: (
    request: Readonly<OpenAIRealtimeRequest<TModel>>
  ) => object;
};

type OpenAIRealtimeCollected = {
  audioChunks: string[];
  textChunks: string[];
  transcriptChunks: string[];
  inputTranscriptChunks: string[];
  responseId?: string;
};

export const axAIOpenAIRealtimeDefaultConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: AxAIOpenAIModel.GPTRealtime2,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    audio: axMergeChatAudioConfig(axOpenAIChatAudioDefaults(), {
      output: {
        enabled: true,
        voice: 'marin',
        format: 'pcm16',
        includeTranscript: true,
      },
      input: {
        format: 'pcm16',
        mimeType: 'audio/pcm',
        sampleRate: 24_000,
        channels: 1,
      },
      live: {
        turnTimeoutMs: 30_000,
      },
    }),
    stream: false,
  });

export const axAIOpenAIRealtimeTranscriptionDefaultConfig =
  (): AxAIOpenAIConfig<AxAIOpenAIModel, AxAIOpenAIEmbedModel> =>
    structuredClone({
      ...axBaseAIDefaultConfig(),
      model: AxAIOpenAIModel.GPTRealtimeWhisper,
      embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
      audio: {
        input: {
          format: 'pcm16',
          mimeType: 'audio/pcm',
          sampleRate: 24_000,
          channels: 1,
        },
        live: {
          turnTimeoutMs: 30_000,
        },
      },
      stream: false,
    });

export const axIsOpenAIRealtimeModel = (model: string): boolean =>
  model === AxAIOpenAIModel.GPTRealtime2 ||
  model === 'gpt-realtime' ||
  model === 'gpt-realtime-1.5' ||
  model === 'gpt-realtime-mini' ||
  model.startsWith('gpt-realtime-');

export const axIsOpenAIRealtimeTranscriptionModel = (model: string): boolean =>
  model === AxAIOpenAIModel.GPTRealtimeWhisper;

export const axResolveOpenAIRealtimeAudioConfig = (
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): AxChatAudioConfig =>
  axMergeChatAudioConfig(
    axMergeChatAudioConfig(
      axAIOpenAIRealtimeDefaultConfig().audio,
      providerAudio
    ),
    requestAudio
  )!;

export const axShouldUseOpenAIRealtime = (
  model: string,
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): boolean => {
  if (axIsOpenAIRealtimeTranscriptionModel(model)) {
    return true;
  }
  return (
    axIsOpenAIRealtimeModel(model) &&
    axIsAudioOutputEnabled(
      axResolveOpenAIRealtimeAudioConfig(providerAudio, requestAudio)
    )
  );
};

export const axCreateOpenAIRealtimeApi = <TModel>(
  realtimeRequest: OpenAIRealtimeRequest<TModel>
): AxAPI => ({
  name: realtimeRequest.apiName ?? 'openai-realtime-audio',
  localCall: async <_TRequest, TResponse>(_data: _TRequest, stream?: boolean) =>
    (stream
      ? axRunOpenAIRealtimeStream(realtimeRequest)
      : await axRunOpenAIRealtimeTurn(realtimeRequest)) as
      | TResponse
      | ReadableStream<TResponse>,
});

const openAIRealtimeUrl = (model: string): string => {
  const path = axIsOpenAIRealtimeTranscriptionModel(model)
    ? 'realtime/transcription_sessions'
    : 'realtime';
  return `wss://api.openai.com/v1/${path}?model=${encodeURIComponent(model)}`;
};

const realtimeUrl = <TModel>({
  model,
  wsURL,
}: Readonly<OpenAIRealtimeRequest<TModel>>): string =>
  wsURL ? wsURL(String(model)) : openAIRealtimeUrl(String(model));

const providerName = <TModel>(
  realtimeRequest: Readonly<OpenAIRealtimeRequest<TModel>>
): string => realtimeRequest.providerName ?? 'OpenAI Realtime';

const attach = (
  socket: WebSocketLike,
  type: 'open' | 'message' | 'error' | 'close',
  listener: (event: any) => void
): void => {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener);
    return;
  }
  if (socket.on) {
    socket.on(type, listener);
    return;
  }
  (socket as any)[`on${type}`] = listener;
};

const parseWebSocketMessage = (event: any): any => {
  const data = event?.data ?? event;
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  if (data instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(data));
  }
  if (data?.toString) {
    return JSON.parse(data.toString());
  }
  return data;
};

const createSocket = <TModel>(
  realtimeRequest: Readonly<OpenAIRealtimeRequest<TModel>>
): WebSocketLike => {
  const { apiKey, webSocket } = realtimeRequest;
  const WebSocketCtor = webSocket ?? globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error(
      `${providerName(realtimeRequest)} requires a WebSocket constructor. In Node, pass the ws constructor through options.webSocket.`
    );
  }

  return new WebSocketCtor(realtimeUrl(realtimeRequest), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }) as WebSocketLike;
};

const inputAudioParts = <TModel>(
  request: Readonly<AxAIOpenAIChatRequest<TModel>>
) =>
  request.messages.flatMap((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return [];
    }
    return message.content
      .filter(
        (
          part
        ): part is Extract<
          (typeof message.content)[number],
          { type: 'input_audio' }
        > => part.type === 'input_audio'
      )
      .map((part) => part.input_audio);
  });

const textFromMessage = <TModel>(
  message: Readonly<AxAIOpenAIChatRequest<TModel>['messages'][number]>
): string | undefined => {
  if (!('content' in message) || !message.content) {
    return undefined;
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => ('text' in part ? part.text : undefined))
      .filter((item): item is string => Boolean(item))
      .join('\n');
  }
  return 'text' in message.content ? message.content.text : undefined;
};

const createSessionUpdate = <TModel>({
  model,
  request,
  audio,
}: Readonly<OpenAIRealtimeRequest<TModel>>): object => {
  const systemInstructions = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
  const output = audio.output;
  const input = audio.input;

  if (axIsOpenAIRealtimeTranscriptionModel(String(model))) {
    return {
      type: 'transcription_session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: input?.sampleRate ?? 24_000,
            },
            turn_detection: null,
            transcription: {
              model: String(model),
            },
          },
        },
      },
    };
  }

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: String(model),
      output_modalities: ['audio'],
      ...(systemInstructions ? { instructions: systemInstructions } : {}),
      audio: {
        input: {
          format: {
            type: 'audio/pcm',
            rate: input?.sampleRate ?? 24_000,
          },
        },
        output: {
          format: {
            type: 'audio/pcm',
            rate: 24_000,
          },
          voice:
            typeof output?.voice === 'object'
              ? output.voice.id
              : (output?.voice ?? 'marin'),
        },
      },
    },
  };
};

const sendInput = <TModel>(
  socket: WebSocketLike,
  realtimeRequest: Readonly<OpenAIRealtimeRequest<TModel>>
): void => {
  const { model, request } = realtimeRequest;
  const audioParts = inputAudioParts(request);

  for (const part of audioParts) {
    const format = (part.format ?? axAudioFormatFromMimeType(part.mimeType)) as
      | AxAudioFormat
      | undefined;
    if (format !== 'pcm16' && format !== 'pcm') {
      throw new Error(
        `OpenAI Realtime audio input requires pcm16 audio, received ${format ?? part.mimeType ?? 'unknown format'}`
      );
    }
    socket.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: part.data,
      })
    );
  }

  if (audioParts.length > 0) {
    socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  if (axIsOpenAIRealtimeTranscriptionModel(String(model))) {
    return;
  }

  for (const message of request.messages) {
    if (message.role !== 'user') {
      continue;
    }
    const text = textFromMessage(message);
    if (!text) {
      continue;
    }
    socket.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      })
    );
  }

  socket.send(
    JSON.stringify({
      type: 'response.create',
      response: { output_modalities: ['audio'] },
    })
  );
};

const makeChatResponse = <TModel>({
  model,
  collected,
  isDelta,
}: {
  model: TModel;
  collected: Readonly<OpenAIRealtimeCollected>;
  isDelta?: boolean;
}): AxAIOpenAIChatResponse => {
  const transcript =
    collected.transcriptChunks.join('') ||
    collected.inputTranscriptChunks.join('');
  const text = collected.textChunks.join('') || transcript;
  const audioData = axConcatBase64(collected.audioChunks);

  return {
    id: collected.responseId ?? 'realtime',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: String(model),
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || null,
          refusal: null,
          audio: audioData
            ? {
                id: collected.responseId ?? 'realtime-audio',
                data: audioData,
                transcript: transcript || undefined,
              }
            : null,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    system_fingerprint: '',
    ...(isDelta ? { __isDelta: true } : {}),
  } as AxAIOpenAIChatResponse;
};

const makeChatDelta = <TModel>({
  model,
  collected,
  finishReason,
}: {
  model: TModel;
  collected: Readonly<OpenAIRealtimeCollected>;
  finishReason?: 'stop';
}): AxAIOpenAIChatResponseDelta => ({
  id: collected.responseId ?? 'realtime',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: String(model),
  choices: [
    {
      index: 0,
      delta: {
        role: 'assistant',
        content:
          collected.textChunks.join('') ||
          collected.inputTranscriptChunks.join('') ||
          collected.transcriptChunks.join('') ||
          null,
        audio:
          collected.audioChunks.length > 0
            ? {
                id: collected.responseId ?? 'realtime-audio',
                data: axConcatBase64(collected.audioChunks),
                transcript: collected.transcriptChunks.join('') || undefined,
              }
            : null,
      },
      finish_reason: finishReason ?? null,
    },
  ],
  system_fingerprint: '',
});

const axRunOpenAIRealtimeTurn = async <TModel>(
  realtimeRequest: Readonly<OpenAIRealtimeRequest<TModel>>,
  onChunk?: (response: AxAIOpenAIChatResponseDelta) => void
): Promise<AxAIOpenAIChatResponse> => {
  const socket = createSocket(realtimeRequest);
  const timeoutMs = realtimeRequest.audio.live?.turnTimeoutMs ?? 30_000;
  const collected: OpenAIRealtimeCollected = {
    audioChunks: [],
    textChunks: [],
    transcriptChunks: [],
    inputTranscriptChunks: [],
  };
  const debug = (message: string) => {
    if (realtimeRequest.debug) {
      console.log(
        `[${providerName(realtimeRequest).toLowerCase()}] ${message}`
      );
    }
  };

  return await new Promise((resolve, reject) => {
    let done = false;
    let inputSent = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const hasCollectedOutput = () =>
      collected.audioChunks.length > 0 ||
      collected.textChunks.length > 0 ||
      collected.transcriptChunks.length > 0 ||
      collected.inputTranscriptChunks.length > 0;
    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    };
    const finishAfterIdle = () => {
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        debug('finishing after output idle');
        finish();
      }, 1500);
    };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearIdleTimer();
      try {
        socket.close();
      } catch {}
      resolve(makeChatResponse({ model: realtimeRequest.model, collected }));
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearIdleTimer();
      try {
        socket.close();
      } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timer = setTimeout(() => {
      fail(
        new Error(
          `${providerName(realtimeRequest)} turn timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    attach(socket, 'open', () => {
      debug('socket open; sending session update');
      socket.send(
        JSON.stringify(
          realtimeRequest.createSessionUpdate
            ? realtimeRequest.createSessionUpdate(realtimeRequest)
            : createSessionUpdate(realtimeRequest)
        )
      );
    });

    attach(socket, 'error', (event) => {
      fail(event?.error ?? event?.message ?? 'OpenAI Realtime WebSocket error');
    });

    attach(socket, 'close', (event) => {
      debug(
        `socket close${event?.code ? ` code=${event.code}` : ''}${
          event?.reason ? ` reason=${event.reason}` : ''
        }`
      );
      if (!done) {
        if (hasCollectedOutput()) {
          finish();
          return;
        }
        fail(
          `${providerName(realtimeRequest)} WebSocket closed before completion${
            event?.code ? ` (code ${event.code})` : ''
          }${event?.reason ? `: ${event.reason}` : ''}`
        );
      }
    });

    attach(socket, 'message', (event) => {
      try {
        const message = parseWebSocketMessage(event);
        debug(`event ${message.type ?? '(unknown)'}`);

        if (message.type === 'error') {
          fail(
            message.error?.message ?? `${providerName(realtimeRequest)} error`
          );
          return;
        }

        if (
          message.type === 'session.created' ||
          message.type === 'session.updated' ||
          message.type === 'transcription_session.updated' ||
          message.type === 'transcription_session.created'
        ) {
          if (!inputSent) {
            inputSent = true;
            debug('session ready; sending input');
            sendInput(socket, realtimeRequest);
          }
          return;
        }

        if (typeof message.response_id === 'string') {
          collected.responseId = message.response_id;
        }

        if (
          message.type === 'response.output_audio.delta' ||
          message.type === 'response.audio.delta'
        ) {
          const chunk: OpenAIRealtimeCollected = {
            audioChunks: [message.delta],
            textChunks: [],
            transcriptChunks: [],
            inputTranscriptChunks: [],
            responseId: collected.responseId,
          };
          collected.audioChunks.push(message.delta);
          finishAfterIdle();
          onChunk?.(
            makeChatDelta({ model: realtimeRequest.model, collected: chunk })
          );
          return;
        }

        if (
          message.type === 'response.output_text.delta' ||
          message.type === 'response.text.delta'
        ) {
          const chunk: OpenAIRealtimeCollected = {
            audioChunks: [],
            textChunks: [message.delta],
            transcriptChunks: [],
            inputTranscriptChunks: [],
            responseId: collected.responseId,
          };
          collected.textChunks.push(message.delta);
          finishAfterIdle();
          onChunk?.(
            makeChatDelta({ model: realtimeRequest.model, collected: chunk })
          );
          return;
        }

        if (
          message.type === 'response.output_audio_transcript.delta' ||
          message.type === 'response.audio_transcript.delta'
        ) {
          const chunk: OpenAIRealtimeCollected = {
            audioChunks: [],
            textChunks: [],
            transcriptChunks: [message.delta],
            inputTranscriptChunks: [],
            responseId: collected.responseId,
          };
          collected.transcriptChunks.push(message.delta);
          finishAfterIdle();
          onChunk?.(
            makeChatDelta({ model: realtimeRequest.model, collected: chunk })
          );
          return;
        }

        if (
          message.type === 'conversation.item.input_audio_transcription.delta'
        ) {
          const chunk: OpenAIRealtimeCollected = {
            audioChunks: [],
            textChunks: [],
            transcriptChunks: [],
            inputTranscriptChunks: [message.delta],
            responseId: collected.responseId,
          };
          collected.inputTranscriptChunks.push(message.delta);
          finishAfterIdle();
          onChunk?.(
            makeChatDelta({ model: realtimeRequest.model, collected: chunk })
          );
          return;
        }

        if (
          message.type === 'response.output_audio_transcript.done' ||
          message.type === 'response.audio_transcript.done'
        ) {
          if (typeof message.transcript === 'string') {
            collected.transcriptChunks = [message.transcript];
          }
          return;
        }

        if (
          message.type === 'response.output_audio.done' ||
          message.type === 'response.audio.done'
        ) {
          finish();
          return;
        }

        if (
          message.type ===
          'conversation.item.input_audio_transcription.completed'
        ) {
          if (typeof message.transcript === 'string') {
            collected.inputTranscriptChunks = [message.transcript];
          }
          if (
            axIsOpenAIRealtimeTranscriptionModel(String(realtimeRequest.model))
          ) {
            finish();
          }
          return;
        }

        if (message.type === 'response.done') {
          finish();
          return;
        }

        if (
          message.type === 'response.output_item.done' ||
          message.type === 'response.content_part.done' ||
          message.type === 'response.completed'
        ) {
          finish();
        }
      } catch (error) {
        fail(error);
      }
    });
  });
};

const axRunOpenAIRealtimeStream = <TModel>(
  realtimeRequest: Readonly<OpenAIRealtimeRequest<TModel>>
): ReadableStream<AxAIOpenAIChatResponseDelta> =>
  new ReadableStream<AxAIOpenAIChatResponseDelta>({
    start(controller) {
      axRunOpenAIRealtimeTurn(realtimeRequest, (chunk) =>
        controller.enqueue(chunk)
      )
        .then(() => {
          controller.enqueue(
            makeChatDelta({
              model: realtimeRequest.model,
              collected: {
                audioChunks: [],
                textChunks: [],
                transcriptChunks: [],
                inputTranscriptChunks: [],
              },
              finishReason: 'stop',
            })
          );
          controller.close();
        })
        .catch((error) => controller.error(error));
    },
  });
