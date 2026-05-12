import { getModelInfo } from '../../dsp/modelinfo.js';
import {
  axIsAudioOutputEnabled,
  axMergeChatAudioConfig,
} from '../audio/defaults.js';
import { axBaseAIDefaultConfig } from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js';
import {
  axCreateOpenAIRealtimeApi,
  type OpenAIRealtimeRequest,
} from '../openai/realtime.js';
import type {
  AxAIServiceOptions,
  AxChatAudioConfig,
  AxModelInfo,
} from '../types.js';
import { axModelInfoGrok } from './info.js';
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
    model: AxAIGrokModel.Grok43,
    ...axBaseAIDefaultConfig(),
  });

export const axAIGrokBestConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    ...axAIGrokDefaultConfig(),
    model: AxAIGrokModel.Grok43,
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

export interface AxAIGrokSearchSource {
  type: 'web' | 'x' | 'news' | 'rss';
  country?: string; // ISO alpha-2 code for web and news
  excludedWebsites?: string[]; // Max 5 websites for web and news
  allowedWebsites?: string[]; // Max 5 websites for web only
  safeSearch?: boolean; // For web and news, default true
  xHandles?: string[]; // For X source
  links?: string[]; // For RSS source, max 1 link
}

export interface AxAIGrokOptionsTools {
  searchParameters?: {
    mode?: 'auto' | 'on' | 'off';
    returnCitations?: boolean;
    fromDate?: string; // ISO8601 format YYYY-MM-DD
    toDate?: string; // ISO8601 format YYYY-MM-DD
    maxSearchResults?: number; // Default 20
    sources?: AxAIGrokSearchSource[];
  };
}

export type AxAIGrokChatRequest = AxAIOpenAIChatRequest<AxAIGrokModel> & {
  search_parameters?: {
    mode?: 'auto' | 'on' | 'off';
    return_citations?: boolean;
    from_date?: string;
    to_date?: string;
    max_search_results?: number;
    sources?: AxAIGrokSearchSource[];
  };
};

export type AxAIGrokArgs<TModelKey> = AxAIOpenAIArgs<
  'grok',
  AxAIGrokModel,
  AxAIGrokEmbedModels,
  TModelKey,
  AxAIGrokChatRequest
> & {
  options?: Readonly<AxAIServiceOptions & AxAIGrokOptionsTools> & {
    tokensPerMinute?: number;
  };
  modelInfo?: AxModelInfo[];
};

export class AxAIGrok<TModelKey> extends AxAIOpenAIBase<
  AxAIGrokModel,
  AxAIGrokEmbedModels,
  TModelKey,
  AxAIGrokChatRequest
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIGrokArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Grok API key not set');
    }

    const Config = {
      ...axAIGrokDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoGrok, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIGrokModel) => {
      const isVoiceModel = axIsGrokVoiceModel(model);
      const mi = getModelInfo<AxAIGrokModel, AxAIGrokEmbedModels, TModelKey>({
        model,
        modelInfo,
        models,
      });
      return {
        functions: !isVoiceModel,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        structuredOutputs: mi?.supported?.structuredOutputs ?? false,
        media: {
          images: {
            supported: !isVoiceModel,
            formats: isVoiceModel ? [] : ['image/jpeg', 'image/png'],
            maxSize: isVoiceModel ? undefined : 20 * 1024 * 1024,
            detailLevels: isVoiceModel
              ? undefined
              : (['high', 'low', 'auto'] as ('high' | 'low' | 'auto')[]),
          },
          audio: {
            supported: isVoiceModel,
            formats: isVoiceModel ? ['pcm16', 'pcm'] : [],
            output: {
              supported: isVoiceModel,
              formats: isVoiceModel ? ['pcm16', 'pcm'] : [],
              sampleRate: isVoiceModel ? 24_000 : undefined,
              voices: isVoiceModel ? ['eve', 'ara', 'rex', 'sal', 'leo'] : [],
            },
          },
          files: {
            supported: false,
            formats: [],
            uploadMethod: 'none' as const,
          },
          urls: {
            supported: false,
            webSearch: true,
            contextFetching: false,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: mi?.supported?.thinkingBudget ?? false,
        multiTurn: true,
      };
    };

    // Chat request updater to add Grok's search parameters
    const chatReqUpdater = (
      req: AxAIGrokChatRequest,
      requestOptions: Readonly<AxAIServiceOptions>
    ): AxAIGrokChatRequest => {
      const mi = getModelInfo<AxAIGrokModel, AxAIGrokEmbedModels, TModelKey>({
        model: req.model,
        modelInfo,
        models,
      });
      const isGrok43 = mi?.name === AxAIGrokModel.Grok43;
      let nextReq = req;

      if (isGrok43 && mi?.supported?.thinkingBudget) {
        switch (requestOptions.thinkingTokenBudget) {
          case 'none':
            nextReq = { ...nextReq, reasoning_effort: 'none' };
            break;
          case 'minimal':
          case 'low':
            nextReq = { ...nextReq, reasoning_effort: 'low' };
            break;
          case 'medium':
            nextReq = { ...nextReq, reasoning_effort: 'medium' };
            break;
          case 'high':
          case 'highest':
            nextReq = { ...nextReq, reasoning_effort: 'high' };
            break;
        }
      } else if (nextReq.reasoning_effort) {
        const { reasoning_effort: _reasoningEffort, ...rest } = nextReq;
        nextReq = rest as AxAIGrokChatRequest;
      }

      if (isGrok43) {
        const {
          presence_penalty: _presencePenalty,
          frequency_penalty: _frequencyPenalty,
          stop: _stop,
          ...rest
        } = nextReq;
        nextReq = rest as AxAIGrokChatRequest;
      }

      if (options?.searchParameters) {
        const searchParams = options.searchParameters;
        return {
          ...nextReq,
          search_parameters: {
            mode: searchParams.mode,
            return_citations: searchParams.returnCitations,
            from_date: searchParams.fromDate,
            to_date: searchParams.toDate,
            max_search_results: searchParams.maxSearchResults,
            sources: searchParams.sources?.map((source) => ({
              type: source.type,
              country: source.country,
              excluded_websites: source.excludedWebsites,
              allowed_websites: source.allowedWebsites,
              safe_search: source.safeSearch,
              x_handles: source.xHandles,
              links: source.links,
            })),
          },
        };
      }
      return nextReq;
    };

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://api.x.ai/v1',
      modelInfo,
      models,
      supportFor,
      chatReqUpdater,
      realtime: {
        apiName: 'Grok Realtime',
        shouldUse: axShouldUseGrokRealtime,
        resolveAudioConfig: axResolveGrokRealtimeAudioConfig,
        createApi: axCreateGrokRealtimeApi,
      },
    });

    super.setName('Grok');
  }
}
