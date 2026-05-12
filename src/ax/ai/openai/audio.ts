import {
  axIsAudioOutputEnabled,
  axMergeChatAudioConfig,
  axOpenAIChatAudioDefaults,
} from '../audio/defaults.js';
import type {
  AxAudioFormat,
  AxChatAudioConfig,
  AxChatAudioOutput,
} from '../audio/types.js';
import { axAudioFormatFromMimeType } from '../audio/util.js';
import { axBaseAIDefaultConfig } from '../base.js';
import type { AxInternalChatRequest } from '../types.js';
import {
  type AxAIOpenAIChatRequest,
  type AxAIOpenAIChatResponse,
  type AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from './chat_types.js';

type AxOpenAIInputAudioFormat = 'wav' | 'mp3';
type AxOpenAIRealtimeInputAudioFormat = AxOpenAIInputAudioFormat | 'pcm16';
type AxOpenAIOutputAudioFormat =
  | 'wav'
  | 'mp3'
  | 'flac'
  | 'opus'
  | 'aac'
  | 'pcm16';

type AxOpenAIAudioPart = {
  type: 'audio';
  data: string;
  format?: AxAudioFormat;
  mimeType?: string;
  sampleRate?: number;
  channels?: number;
};

export const axAIOpenAIAudioDefaultConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: AxAIOpenAIModel.GPTAudioMini,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    audio: axOpenAIChatAudioDefaults(),
    stream: false,
  });

export const axIsOpenAIChatAudioModel = (model: string): boolean =>
  model === AxAIOpenAIModel.GPTAudio ||
  model === AxAIOpenAIModel.GPTAudioMini ||
  model.startsWith('gpt-audio-');

export const axResolveOpenAIChatAudioConfig = (
  providerAudio?: Readonly<AxChatAudioConfig>,
  requestAudio?: Readonly<AxChatAudioConfig>
): AxChatAudioConfig | undefined => {
  const merged = axMergeChatAudioConfig(providerAudio, requestAudio);
  if (!axIsAudioOutputEnabled(merged)) {
    return merged;
  }
  return axMergeChatAudioConfig(axOpenAIChatAudioDefaults(), merged);
};

const resolveOpenAIInputAudioFormat = (
  part: Readonly<AxOpenAIAudioPart>
): AxOpenAIInputAudioFormat => {
  const format = part.format ?? axAudioFormatFromMimeType(part.mimeType);
  if (format === 'wav' || format === 'mp3') {
    return format;
  }

  throw new Error(
    `OpenAI audio chat input supports only wav and mp3 audio, received ${format ?? part.mimeType ?? 'unknown format'}`
  );
};

const resolveOpenAIOutputAudioFormat = (
  format?: AxAudioFormat
): AxOpenAIOutputAudioFormat => {
  const resolved = format ?? 'wav';
  switch (resolved) {
    case 'wav':
      return 'wav';
    case 'mp3':
      return 'mp3';
    case 'flac':
      return 'flac';
    case 'opus':
      return 'opus';
    case 'aac':
      return 'aac';
    case 'pcm16':
      return 'pcm16';
    case 'pcm':
      return 'pcm16';
    case 'ogg':
      throw new Error('OpenAI audio chat output does not support ogg format');
  }
};

export const axMapOpenAIInputAudioPart = (
  part: Readonly<AxOpenAIAudioPart>,
  options?: Readonly<{ allowPcm16?: boolean }>
): {
  type: 'input_audio';
  input_audio: {
    data: string;
    format: AxOpenAIRealtimeInputAudioFormat;
    mimeType?: string;
    sampleRate?: number;
    channels?: number;
  };
} => {
  const format = part.format ?? axAudioFormatFromMimeType(part.mimeType);
  if (options?.allowPcm16 && (format === 'pcm16' || format === 'pcm')) {
    return {
      type: 'input_audio',
      input_audio: {
        data: part.data,
        format: 'pcm16',
        mimeType: part.mimeType,
        sampleRate: part.sampleRate,
        channels: part.channels,
      },
    };
  }

  return {
    type: 'input_audio',
    input_audio: {
      data: part.data,
      format: resolveOpenAIInputAudioFormat(part),
      mimeType: part.mimeType,
      sampleRate: part.sampleRate,
      channels: part.channels,
    },
  };
};

export const axApplyOpenAIChatAudioRequest = <TModel>(
  reqValue: AxAIOpenAIChatRequest<TModel>,
  req: Readonly<AxInternalChatRequest<TModel>>,
  providerAudio?: Readonly<AxChatAudioConfig>
): AxAIOpenAIChatRequest<TModel> => {
  const audio = axResolveOpenAIChatAudioConfig(
    providerAudio,
    req.modelConfig?.audio
  );

  if (!axIsAudioOutputEnabled(audio)) {
    return reqValue;
  }

  if (req.responseFormat || reqValue.response_format) {
    throw new Error(
      'OpenAI audio chat models do not support structured response formats with audio output'
    );
  }

  const output = audio?.output;
  const format = resolveOpenAIOutputAudioFormat(output?.format);

  return {
    ...reqValue,
    modalities: ['text', 'audio'],
    audio: {
      voice: output?.voice ?? 'alloy',
      format,
    },
  };
};

export const axMapOpenAIChatAudioResponse = (
  audio:
    | NonNullable<AxAIOpenAIChatResponse['choices'][number]['message']['audio']>
    | null
    | undefined
): AxChatAudioOutput | undefined => {
  if (!audio?.data) {
    return undefined;
  }

  return {
    id: audio.id,
    data: audio.data,
    transcript: audio.transcript,
    expiresAt: audio.expires_at,
  };
};

export const axMapOpenAIChatAudioDelta = (
  audio:
    | NonNullable<
        import('./chat_types.js').AxAIOpenAIChatResponseDelta['choices'][number]['delta']['audio']
      >
    | null
    | undefined
): AxChatAudioOutput | undefined => {
  if (!audio) {
    return undefined;
  }

  const data = audio.data ?? audio.delta;
  if (!data) {
    return undefined;
  }

  return {
    id: audio.id,
    data,
    transcript: audio.transcript,
    expiresAt: audio.expires_at,
    isDelta: true,
  };
};
