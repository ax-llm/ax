import {
  axIsAudioOutputEnabled,
  axMergeChatAudioConfig,
} from '../audio/defaults.js';
import { axBaseAIDefaultConfig } from '../base.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';
import {
  axCreateOpenAIRealtimeApi,
  type OpenAIRealtimeRequest,
} from '../openai/realtime.js';
import type { AxChatAudioConfig } from '../types.js';
import { type AxAIGrokEmbedModels, AxAIGrokModel } from './types.js';

const axGrokAudioDefaults = (): AxChatAudioConfig => ({
  input: {
    format: 'pcm16',
    mimeType: 'audio/pcm',
    sampleRate: 24_000,
    channels: 1,
  },
  output: {
    enabled: true,
    voice: 'eve',
    format: 'pcm16',
    mimeType: 'audio/pcm',
    sampleRate: 24_000,
    channels: 1,
    includeTranscript: true,
  },
  live: {
    turnTimeoutMs: 30_000,
  },
});

export const axAIGrokDefaultConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    model: AxAIGrokModel.Grok46,
    ...axBaseAIDefaultConfig(),
  });

export const axAIGrokBestConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    ...axAIGrokDefaultConfig(),
    model: AxAIGrokModel.Grok46,
  });

export const axAIGrokVoiceDefaultConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: AxAIGrokModel.GrokVoiceThinkFast,
    audio: axGrokAudioDefaults(),
    stream: false,
  });

export const axIsGrokVoiceModel = (model: string): boolean =>
  model === AxAIGrokModel.GrokVoiceThinkFast ||
  model === AxAIGrokModel.GrokVoiceFast ||
  model.startsWith('grok-voice-');

export const axResolveGrokRealtimeAudioConfig = (
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): AxChatAudioConfig =>
  axMergeChatAudioConfig(
    axMergeChatAudioConfig(axGrokAudioDefaults(), providerAudio),
    requestAudio
  )!;

export const axShouldUseGrokRealtime = (
  model: string,
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): boolean =>
  axIsGrokVoiceModel(model) &&
  axIsAudioOutputEnabled(
    axResolveGrokRealtimeAudioConfig(providerAudio, requestAudio)
  );

export const axCreateGrokRealtimeApi = <TModel>(
  realtimeRequest: OpenAIRealtimeRequest<TModel>
) =>
  axCreateOpenAIRealtimeApi({
    ...realtimeRequest,
    apiName: 'grok-realtime-audio',
    providerName: 'Grok Realtime',
    wsURL: (model) =>
      `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(model)}`,
    createSessionUpdate: ({ request, audio }) => {
      const systemInstructions = request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n');
      const input = audio.input;
      const output = audio.output;

      return {
        type: 'session.update',
        session: {
          voice:
            typeof output?.voice === 'object'
              ? output.voice.id
              : (output?.voice ?? 'eve'),
          ...(systemInstructions ? { instructions: systemInstructions } : {}),
          turn_detection: null,
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
                rate: output?.sampleRate ?? 24_000,
              },
            },
          },
        },
      };
    },
  });
