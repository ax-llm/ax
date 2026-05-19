import type { AxAPI } from '../../util/apicall.js';
import {
  axGoogleGeminiLiveAudioDefaults,
  axIsAudioOutputEnabled,
  axMergeChatAudioConfig,
} from '../audio/defaults.js';
import type { AxChatAudioConfig, AxChatAudioOutput } from '../audio/types.js';
import {
  axAudioFormatFromMimeType,
  axAudioMimeType,
  axConcatBase64,
} from '../audio/util.js';
import { axBaseAIDefaultConfig } from '../base.js';
import {
  type AxAIGoogleGeminiChatRequest,
  type AxAIGoogleGeminiChatResponse,
  type AxAIGoogleGeminiConfig,
  type AxAIGoogleGeminiContent,
  type AxAIGoogleGeminiContentPart,
  AxAIGoogleGeminiEmbedModel,
  type AxAIGoogleGeminiGenerationConfig,
  AxAIGoogleGeminiModel,
} from './types.js';

const geminiLiveWsUrl = (audio: Readonly<AxChatAudioConfig>): string => {
  const version =
    audio.live?.enableAffectiveDialog || audio.live?.proactiveAudio
      ? 'v1alpha'
      : 'v1beta';
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`;
};

type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener?: (
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
    options?: { once?: boolean }
  ) => void;
  removeEventListener?: (
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void
  ) => void;
  onopen?: (event: any) => void;
  onmessage?: (event: any) => void;
  onerror?: (event: any) => void;
  onclose?: (event: any) => void;
};

type GeminiLiveRequest = {
  model: AxAIGoogleGeminiModel;
  request: AxAIGoogleGeminiChatRequest;
  apiKey: string;
  audio: AxChatAudioConfig;
};

type GeminiLiveCollected = {
  audioChunks: string[];
  textChunks: string[];
  outputTranscripts: string[];
  functionCalls: { name: string; args: object }[];
  usageMetadata?: AxAIGoogleGeminiChatResponse['usageMetadata'];
};

export const axAIGoogleGeminiLiveAudioDefaultConfig =
  (): AxAIGoogleGeminiConfig =>
    structuredClone({
      ...axBaseAIDefaultConfig(),
      model: AxAIGoogleGeminiModel.Gemini25FlashNativeAudio,
      embedModel: AxAIGoogleGeminiEmbedModel.TextEmbedding005,
      audio: axGoogleGeminiLiveAudioDefaults(),
      stream: false,
    });

export const axIsGeminiLiveAudioModel = (model: string): boolean =>
  model === AxAIGoogleGeminiModel.Gemini25FlashNativeAudio ||
  model === AxAIGoogleGeminiModel.Gemini31FlashLive ||
  model.includes('native-audio') ||
  model.includes('-live-') ||
  model.startsWith('gemini-live-');

export const axResolveGeminiLiveAudioConfig = (
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): AxChatAudioConfig | undefined => {
  const merged = axMergeChatAudioConfig(providerAudio, requestAudio);
  if (!axIsAudioOutputEnabled(merged)) {
    return merged;
  }
  return axMergeChatAudioConfig(axGoogleGeminiLiveAudioDefaults(), merged);
};

export const axShouldUseGeminiLiveAudio = (
  model: string,
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): boolean =>
  axIsGeminiLiveAudioModel(model) &&
  axIsAudioOutputEnabled(
    axResolveGeminiLiveAudioConfig(providerAudio, requestAudio)
  );

export const axValidateGeminiLiveAudioInput = (
  part: Readonly<AxAIGoogleGeminiContentPart>
): void => {
  if (!('inlineData' in part)) {
    return;
  }

  const { mimeType } = part.inlineData;
  if (!mimeType.startsWith('audio/')) {
    return;
  }

  const format = axAudioFormatFromMimeType(mimeType);
  if (format !== 'pcm' && format !== 'pcm16') {
    throw new Error(
      `Gemini Live audio output requires PCM audio input, received ${mimeType}`
    );
  }
};

export const axMapGeminiLiveAudioPart = (
  part: Readonly<AxAIGoogleGeminiContentPart>
): AxChatAudioOutput | undefined => {
  if (
    !('inlineData' in part) ||
    !part.inlineData.mimeType.startsWith('audio/')
  ) {
    return undefined;
  }

  const format = axAudioFormatFromMimeType(part.inlineData.mimeType);
  const sampleRate = part.inlineData.mimeType.match(/rate=(\d+)/)?.[1];

  return {
    data: part.inlineData.data,
    mimeType: part.inlineData.mimeType,
    format: format === 'pcm' ? 'pcm16' : format,
    sampleRate: sampleRate ? Number.parseInt(sampleRate, 10) : undefined,
    channels: 1,
    isDelta: (part as any).isDelta === true,
  };
};

export const axCreateGeminiLiveAudioApi = (
  liveRequest: GeminiLiveRequest
): AxAPI => ({
  name: 'gemini-live-audio',
  localCall: async <_TRequest, TResponse>(_data: _TRequest, stream?: boolean) =>
    (stream
      ? axRunGeminiLiveAudioStream(liveRequest)
      : await axRunGeminiLiveAudioTurn(liveRequest)) as
      | TResponse
      | ReadableStream<TResponse>,
});

const createSetupMessage = ({
  model,
  request,
  audio,
}: Readonly<GeminiLiveRequest>): object => {
  const output = audio.output;
  const live = audio.live;
  const speechConfig =
    typeof output?.voice === 'string'
      ? {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: output.voice,
            },
          },
        }
      : undefined;

  const generationConfig: AxAIGoogleGeminiGenerationConfig & {
    responseModalities: ['AUDIO'];
    speechConfig?: object;
  } = {
    temperature: request.generationConfig.temperature,
    topP: request.generationConfig.topP,
    topK: request.generationConfig.topK,
    frequencyPenalty: request.generationConfig.frequencyPenalty,
    maxOutputTokens: request.generationConfig.maxOutputTokens,
    thinkingConfig: request.generationConfig.thinkingConfig,
    responseModalities: ['AUDIO'],
    ...(speechConfig ? { speechConfig } : {}),
  };

  return {
    setup: {
      model: `models/${model}`,
      generationConfig,
      ...(request.systemInstruction
        ? { systemInstruction: request.systemInstruction }
        : {}),
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.toolConfig ? { toolConfig: request.toolConfig } : {}),
      ...(output?.includeTranscript !== false
        ? { outputAudioTranscription: {} }
        : {}),
      ...(live?.enableAffectiveDialog ? { enableAffectiveDialog: true } : {}),
      ...(live?.proactiveAudio
        ? { proactivity: { proactiveAudio: true } }
        : {}),
    },
  };
};

const splitLiveInput = (
  contents: readonly AxAIGoogleGeminiContent[]
): {
  clientContents: AxAIGoogleGeminiContent[];
  audioParts: { data: string; mimeType: string }[];
} => {
  const clientContents: AxAIGoogleGeminiContent[] = [];
  const audioParts: { data: string; mimeType: string }[] = [];

  for (const content of contents) {
    const clientParts: AxAIGoogleGeminiContentPart[] = [];

    for (const part of content.parts) {
      if (
        'inlineData' in part &&
        part.inlineData.mimeType.startsWith('audio/')
      ) {
        axValidateGeminiLiveAudioInput(part);
        audioParts.push({
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
        continue;
      }
      clientParts.push(part);
    }

    if (clientParts.length > 0) {
      clientContents.push({ ...content, parts: clientParts });
    }
  }

  return { clientContents, audioParts };
};

const sendLiveInput = (
  socket: WebSocketLike,
  request: Readonly<AxAIGoogleGeminiChatRequest>
): void => {
  const { clientContents, audioParts } = splitLiveInput(request.contents);

  if (clientContents.length > 0) {
    socket.send(
      JSON.stringify({
        clientContent: {
          turns: clientContents,
          turnComplete: audioParts.length === 0,
        },
      })
    );
  }

  for (const audio of audioParts) {
    socket.send(
      JSON.stringify({
        realtimeInput: {
          audio,
        },
      })
    );
  }

  if (audioParts.length > 0) {
    socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }
};

const makeGeminiLiveResponse = ({
  audioData,
  audio,
  transcript,
  text,
  functionCalls,
  usageMetadata,
  isDelta,
}: {
  audioData?: string;
  audio: Readonly<AxChatAudioConfig>;
  transcript?: string;
  text?: string;
  functionCalls?: readonly { name: string; args: object }[];
  usageMetadata?: AxAIGoogleGeminiChatResponse['usageMetadata'];
  isDelta?: boolean;
}): AxAIGoogleGeminiChatResponse => {
  const output = audio.output;
  const outputMimeType =
    output?.mimeType ??
    axAudioMimeType(output?.format, output?.sampleRate, 'audio/pcm;rate=24000');
  const parts: AxAIGoogleGeminiContentPart[] = [];

  if (text || transcript) {
    parts.push({ text: text ?? transcript ?? '' });
  }

  if (audioData) {
    parts.push({
      inlineData: {
        mimeType: outputMimeType,
        data: audioData,
      },
      ...(isDelta ? { isDelta: true } : {}),
    } as AxAIGoogleGeminiContentPart);
  }

  for (const call of functionCalls ?? []) {
    parts.push({
      functionCall: {
        name: call.name,
        args: call.args,
      },
    });
  }

  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
        finishReason: 'STOP',
        citationMetadata: { citations: [] },
      },
    ],
    usageMetadata: usageMetadata ?? {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
      thoughtsTokenCount: 0,
    },
  };
};

const normalizeUsageMetadata = (
  usageMetadata: any
): AxAIGoogleGeminiChatResponse['usageMetadata'] | undefined => {
  if (!usageMetadata) return undefined;
  return {
    promptTokenCount: usageMetadata.promptTokenCount ?? 0,
    candidatesTokenCount:
      usageMetadata.candidatesTokenCount ??
      usageMetadata.responseTokenCount ??
      0,
    totalTokenCount: usageMetadata.totalTokenCount ?? 0,
    thoughtsTokenCount: usageMetadata.thoughtsTokenCount ?? 0,
    cachedContentTokenCount: usageMetadata.cachedContentTokenCount,
  };
};

const parseWebSocketMessage = (event: any): any => {
  const data = event?.data ?? event;
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  return data;
};

const attach = (
  socket: WebSocketLike,
  type: 'open' | 'message' | 'error' | 'close',
  listener: (event: any) => void
): void => {
  if (socket.addEventListener) {
    socket.addEventListener(type, listener);
    return;
  }
  (socket as any)[`on${type}`] = listener;
};

const axRunGeminiLiveAudioTurn = async (
  liveRequest: Readonly<GeminiLiveRequest>,
  onChunk?: (response: AxAIGoogleGeminiChatResponse) => void
): Promise<AxAIGoogleGeminiChatResponse> => {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error('Gemini Live audio requires globalThis.WebSocket');
  }

  const audio = liveRequest.audio;
  const timeoutMs = audio.live?.turnTimeoutMs ?? 30_000;
  const collected: GeminiLiveCollected = {
    audioChunks: [],
    textChunks: [],
    outputTranscripts: [],
    functionCalls: [],
  };

  const socket = new WebSocketCtor(
    `${geminiLiveWsUrl(audio)}?key=${encodeURIComponent(liveRequest.apiKey)}`
  ) as unknown as WebSocketLike;

  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (response: AxAIGoogleGeminiChatResponse) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(response);
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timer = setTimeout(() => {
      fail(new Error(`Gemini Live audio turn timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    attach(socket, 'open', () => {
      socket.send(JSON.stringify(createSetupMessage(liveRequest)));
    });

    attach(socket, 'error', (event) => {
      fail(event?.error ?? event?.message ?? 'Gemini Live WebSocket error');
    });

    attach(socket, 'message', (event) => {
      try {
        const message = parseWebSocketMessage(event);

        if (message.setupComplete) {
          sendLiveInput(socket, liveRequest.request);
          return;
        }

        if (message.usageMetadata) {
          collected.usageMetadata = normalizeUsageMetadata(
            message.usageMetadata
          );
        }

        const toolCalls = message.toolCall?.functionCalls;
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            if (typeof call?.name === 'string') {
              const fnCall = { name: call.name, args: call.args ?? {} };
              collected.functionCalls.push(fnCall);
              onChunk?.(
                makeGeminiLiveResponse({
                  audio,
                  functionCalls: [fnCall],
                  isDelta: true,
                })
              );
            }
          }
        }

        const serverContent = message.serverContent;
        if (!serverContent) {
          return;
        }

        const outputTranscript = serverContent.outputTranscription?.text;
        if (typeof outputTranscript === 'string') {
          collected.outputTranscripts.push(outputTranscript);
          onChunk?.(
            makeGeminiLiveResponse({
              audio,
              transcript: outputTranscript,
              isDelta: true,
            })
          );
        }

        const parts = serverContent.modelTurn?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part.text === 'string') {
              collected.textChunks.push(part.text);
              onChunk?.(
                makeGeminiLiveResponse({
                  audio,
                  text: part.text,
                  isDelta: true,
                })
              );
              continue;
            }
            const inlineData = part.inlineData ?? part.inline_data;
            const mimeType = inlineData?.mimeType ?? inlineData?.mime_type;
            if (
              inlineData?.data &&
              typeof mimeType === 'string' &&
              mimeType.startsWith('audio/')
            ) {
              collected.audioChunks.push(inlineData.data);
              onChunk?.(
                makeGeminiLiveResponse({
                  audio,
                  audioData: inlineData.data,
                  isDelta: true,
                })
              );
            }
          }
        }

        if (serverContent.turnComplete) {
          const transcript = collected.outputTranscripts.join('');
          const text = collected.textChunks.join('');
          finish(
            makeGeminiLiveResponse({
              audio,
              audioData: axConcatBase64(collected.audioChunks),
              transcript: transcript || undefined,
              text: text || undefined,
              functionCalls: collected.functionCalls,
              usageMetadata: collected.usageMetadata,
            })
          );
        }
      } catch (error) {
        fail(error);
      }
    });
  });
};

const axRunGeminiLiveAudioStream = (
  liveRequest: Readonly<GeminiLiveRequest>
): ReadableStream<AxAIGoogleGeminiChatResponse> =>
  new ReadableStream<AxAIGoogleGeminiChatResponse>({
    start(controller) {
      axRunGeminiLiveAudioTurn(liveRequest, (chunk) =>
        controller.enqueue(chunk)
      )
        .then((finalResponse) => {
          controller.enqueue(finalResponse);
          controller.close();
        })
        .catch((error) => controller.error(error));
    },
  });
