import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxAIRefusalError } from '../../util/apicall.js';
import {
  axFetchJsonSpeech,
  axFetchMultipartTranscription,
} from '../audio/api.js';
import type { AxAudioFormat, AxChatAudioConfig } from '../audio/types.js';
import {
  type AxAIFeatures,
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import {
  axNormalizeRequestedServiceTier,
  axResolveServiceTier,
} from '../service_tier.js';
import type {
  AxAICredentialProvider,
  AxAIInputModelList,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxModelInfo,
  AxSpeechRequest,
  AxSpeechResponse,
  AxTokenUsage,
  AxTranscriptionRequest,
  AxTranscriptionResponse,
} from '../types.js';
import {
  axAIOpenAIAudioDefaultConfig,
  axApplyOpenAIChatAudioRequest,
  axIsOpenAIChatAudioModel,
  axMapOpenAIChatAudioDelta,
  axMapOpenAIChatAudioResponse,
  axMapOpenAIInputAudioPart,
} from './audio.js';
import {
  axApplyOpenAIPromptCacheBreakpoints,
  axIsOpenAIPromptCachingEnabled,
  axResolveOpenAIPromptCacheKey,
} from './caching.js';
import {
  type AxAIOpenAIChatRequest,
  type AxAIOpenAIChatResponse,
  type AxAIOpenAIChatResponseDelta,
  type AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  type AxAIOpenAIEmbedRequest,
  type AxAIOpenAIEmbedResponse,
  AxAIOpenAIModel,
} from './chat_types.js';
import { axResolveOpenAIChatReasoningEffort } from './effort.js';
import { axModelInfoOpenAI } from './info.js';
import { axIsGPT56Family } from './model_family.js';
import {
  axAIOpenAIRealtimeDefaultConfig,
  axAIOpenAIRealtimeTranscriptionDefaultConfig,
  axCreateOpenAIRealtimeApi,
  axIsOpenAIRealtimeModel,
  axIsOpenAIRealtimeTranscriptionModel,
  axResolveOpenAIRealtimeAudioConfig,
  axShouldUseOpenAIRealtime,
  type OpenAIRealtimeRequest,
} from './realtime.js';
import { axNormalizeOpenAIUsage } from './usage.js';

export {
  axAIOpenAIAudioDefaultConfig,
  axAIOpenAIRealtimeDefaultConfig,
  axAIOpenAIRealtimeTranscriptionDefaultConfig,
};

/**
 * Checks if the given OpenAI model is a thinking/reasoning model.
 * Thinking models (o1, o3, o4 series) have different parameter restrictions.
 */
export const isOpenAIThinkingModel = (model: string): boolean => {
  const thinkingModels = [
    AxAIOpenAIModel.O1,
    AxAIOpenAIModel.O1Mini,
    AxAIOpenAIModel.O3,
    AxAIOpenAIModel.O3Mini,
    AxAIOpenAIModel.O4Mini,
    // Pro models (string values since they're not in the regular chat enum)
    'o1-pro',
    'o3-pro',
  ];
  return (
    thinkingModels.includes(model as AxAIOpenAIModel) ||
    thinkingModels.includes(model)
  );
};

export const axAIOpenAIDefaultConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    model: AxAIOpenAIModel.GPT5Mini,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    ...axBaseAIDefaultConfig(),
  });

export const axAIOpenAIBestConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    ...axAIOpenAIDefaultConfig(),
    model: AxAIOpenAIModel.GPT5,
  });

export const axAIOpenAICreativeConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    model: AxAIOpenAIModel.GPT5Mini,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    ...axBaseAIDefaultCreativeConfig(),
  });

export const axAIOpenAIFastConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> => ({
  ...axAIOpenAIDefaultConfig(),
  model: AxAIOpenAIModel.GPT5Nano,
});

export interface AxAIOpenAIArgs<
  TName = 'openai',
  TModel = AxAIOpenAIModel,
  TEmbedModel = AxAIOpenAIEmbedModel,
  TModelKey = string,
  TChatReq extends
    AxAIOpenAIChatRequest<TModel> = AxAIOpenAIChatRequest<TModel>,
> extends Omit<
    AxAIOpenAIBaseArgs<TModel, TEmbedModel, TModelKey, TChatReq>,
    'config' | 'supportFor' | 'modelInfo'
  > {
  name: TName;
  modelInfo?: AxModelInfo[];
  config?: Partial<
    AxAIOpenAIBaseArgs<TModel, TEmbedModel, TModelKey, TChatReq>['config']
  >;
}

type ChatReqUpdater<TModel, TChatReq extends AxAIOpenAIChatRequest<TModel>> = (
  req: Readonly<TChatReq>,
  config: Readonly<AxAIServiceOptions>
) => TChatReq;

type ChatRespProcessor = (resp: AxChatResponse) => AxChatResponse;
type ChatStreamRespProcessor = (
  resp: AxChatResponse,
  state: object
) => AxChatResponse;

type RealtimeAdapter<TModel> = {
  apiName: string;
  shouldUse: (
    model: string,
    providerAudio?: Readonly<AxChatAudioConfig>,
    requestAudio?: Readonly<AxChatAudioConfig>
  ) => boolean;
  resolveAudioConfig: (
    providerAudio?: Readonly<AxChatAudioConfig>,
    requestAudio?: Readonly<AxChatAudioConfig>
  ) => AxChatAudioConfig;
  createApi: (request: OpenAIRealtimeRequest<TModel>) => AxAPI;
};

type AxOpenAIBatchAudioConfig = {
  transcriptionModel?: string;
  speechModel?: string;
  speechVoice?: string;
  speechFormat?: AxAudioFormat;
};

export type AxOpenAIReasoningContentMode =
  | 'none'
  | 'deepseek'
  | {
      assistantField?: string;
      responseFields: readonly string[];
      assistantDetailsField?: string;
      responseDetailsFields?: readonly string[];
    };

const resolveReasoningAdapter = (
  mode: AxOpenAIReasoningContentMode
): {
  assistantField?: string;
  responseFields: readonly string[];
  assistantDetailsField?: string;
  responseDetailsFields: readonly string[];
} => {
  if (mode === 'none') {
    return { responseFields: [], responseDetailsFields: [] };
  }
  if (mode === 'deepseek') {
    return {
      assistantField: 'reasoning_content',
      responseFields: ['reasoning_content'],
      responseDetailsFields: [],
    };
  }
  return { responseDetailsFields: [], ...mode };
};

const readReasoning = (
  value: unknown,
  mode: AxOpenAIReasoningContentMode
): {
  thought?: string;
  thoughtBlocks?: { data: string; encrypted: boolean; signature?: string }[];
} => {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const adapter = resolveReasoningAdapter(mode);
  let thought: string | undefined;
  for (const field of adapter.responseFields) {
    const content = record[field];
    if (typeof content === 'string' && content.length > 0) {
      thought = content;
      break;
    }
  }
  for (const field of adapter.responseDetailsFields) {
    const details = record[field];
    if (!Array.isArray(details) || details.length === 0) continue;
    const thoughtBlocks = details.map((detail) => {
      const detailRecord =
        detail && typeof detail === 'object'
          ? (detail as Record<string, unknown>)
          : undefined;
      const summary = detailRecord?.summary;
      const text = detailRecord?.text;
      if (!thought && typeof summary === 'string') thought = summary;
      if (!thought && typeof text === 'string') thought = text;
      const type = String(detailRecord?.type ?? '');
      const id = detailRecord?.id;
      return {
        data: JSON.stringify(detail),
        encrypted: type.includes('encrypted'),
        ...(typeof id === 'string' ? { signature: id } : {}),
      };
    });
    return { thought, thoughtBlocks };
  }
  return thought
    ? { thought, thoughtBlocks: [{ data: thought, encrypted: false }] }
    : {};
};

type AxAIOpenAIBaseInternalArgs<
  TModel,
  TEmbedModel,
  TModelKey,
  TChatReq extends AxAIOpenAIChatRequest<TModel>,
> = Omit<
  AxAIOpenAIBaseArgs<TModel, TEmbedModel, TModelKey, TChatReq>,
  'name'
> & {
  /** @internal OpenAI-compatible reasoning trace wire format. */
  reasoningContentMode?: AxOpenAIReasoningContentMode;
};

export interface AxAIOpenAIBaseArgs<
  TModel,
  TEmbedModel,
  TModelKey,
  TChatReq extends AxAIOpenAIChatRequest<TModel>,
> {
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  credentialProfile?: string;
  apiURL?: string;
  config: Readonly<AxAIOpenAIConfig<TModel, TEmbedModel>>;
  options?: Readonly<AxAIServiceOptions & { streamingUsage?: boolean }>;
  modelInfo: Readonly<AxModelInfo[]>;
  models?: AxAIInputModelList<TModel, TEmbedModel, TModelKey>;
  chatReqUpdater?: ChatReqUpdater<TModel, TChatReq>;
  chatRespProcessor?: ChatRespProcessor;
  chatStreamRespProcessor?: ChatStreamRespProcessor;
  realtime?: RealtimeAdapter<TModel>;
  /**
   * Opt in to OpenAI prompt caching on GPT-5.6+ models. Off by default because
   * this request builder is shared: Azure OpenAI is typed on the same model
   * enum, so a `gpt-5.6-*` deployment would otherwise pick up parameters its API
   * version may reject. Only `AxAIOpenAI` sets it today.
   */
  promptCaching?: boolean;
  supportFor: AxAIFeatures | ((model: TModel) => AxAIFeatures);
}

class AxAIOpenAIImpl<
  TModel,
  TEmbedModel,
  TChatReq extends AxAIOpenAIChatRequest<TModel>,
> implements
    AxAIServiceImpl<
      TModel,
      TEmbedModel,
      AxAIOpenAIChatRequest<TModel>,
      AxAIOpenAIEmbedRequest<TEmbedModel>,
      AxAIOpenAIChatResponse,
      AxAIOpenAIChatResponseDelta,
      AxAIOpenAIEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined;

  constructor(
    private readonly config: Readonly<AxAIOpenAIConfig<TModel, TEmbedModel>>,
    private readonly apiKey: string,
    private streamingUsage: boolean,
    private readonly options?: Readonly<AxAIServiceOptions>,
    private readonly chatReqUpdater?: ChatReqUpdater<TModel, TChatReq>,
    private readonly chatRespProcessor?: ChatRespProcessor,
    private readonly chatStreamRespProcessor?: ChatStreamRespProcessor,
    private readonly realtime?: RealtimeAdapter<TModel>,
    private readonly promptCaching: boolean = false,
    private readonly reasoningContentMode: AxOpenAIReasoningContentMode = 'none',
    private readonly supportFor?:
      | AxAIFeatures
      | ((model: TModel) => AxAIFeatures)
  ) {}

  /**
   * Declaring implicit caching support is what stops `AxBaseAI` throwing
   * `Context caching is not supported by this provider/model` when a caller
   * passes `contextCache` — which is the very option that makes
   * `AxPromptTemplate` set the `cache: true` flags this provider reads. The
   * `promptCaching` conjunct keeps Azure and the other OpenAI-compatible
   * providers throwing exactly as they do today.
   */
  supportsImplicitCaching = (model: TModel): boolean =>
    this.promptCaching && axIsGPT56Family(model);

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  getModelConfig(): AxModelConfig {
    const { config } = this;

    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      topP: config.topP,
      n: config.n,
      stream: config.stream,
    };
  }

  createChatReq = (
    req: Readonly<AxInternalChatRequest<TModel>>,
    config: Readonly<AxAIServiceOptions>
  ): [AxAPI, AxAIOpenAIChatRequest<TModel>] => {
    const model = req.model;
    const realtimeAudio = (
      this.realtime?.resolveAudioConfig ?? axResolveOpenAIRealtimeAudioConfig
    )(this.config.audio, req.modelConfig?.audio);
    const useRealtime = (this.realtime?.shouldUse ?? axShouldUseOpenAIRealtime)(
      model as string,
      this.config.audio,
      req.modelConfig?.audio
    );
    const requestedServiceTier =
      config.serviceTier ??
      this.options?.serviceTier ??
      this.config.serviceTier;
    const normalizedServiceTier =
      axNormalizeRequestedServiceTier(requestedServiceTier);
    if (
      useRealtime &&
      normalizedServiceTier !== undefined &&
      normalizedServiceTier !== 'auto'
    ) {
      throw new Error('Service tiers are not supported by realtime models');
    }
    const features =
      typeof this.supportFor === 'function'
        ? this.supportFor(model)
        : this.supportFor;
    const serviceTier = useRealtime
      ? undefined
      : axResolveServiceTier({
          requested: requestedServiceTier,
          supported: features?.serviceTiers,
          mapping: {
            auto: 'auto',
            standard: 'default',
            flex: 'flex',
            priority: 'priority',
          },
          provider: 'OpenAI-compatible',
          model: String(model),
        });

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig: AxAPI = {
      name: '/chat/completions',
    };

    const tools = req.functions?.map((v) => ({
      type: 'function' as const,
      function: {
        name: v.name,
        description: v.description,
        parameters: v.parameters,
      },
    }));

    const toolsChoice =
      !req.functionCall && req.functions && req.functions.length > 0
        ? 'auto'
        : req.functionCall;

    let messages = createMessages(req, useRealtime, this.reasoningContentMode);

    // Prompt caching. `messages` is index-aligned with `req.chatPrompt` because
    // createMessages is a plain map, which is what makes the absolute-index
    // breakpoint scheme in caching.ts stable across turns.
    const promptCachingEnabled = axIsOpenAIPromptCachingEnabled(
      req,
      config,
      this.promptCaching
    );
    let promptCacheKey: string | undefined;
    let breakpointCount = 0;
    if (promptCachingEnabled) {
      const applied = axApplyOpenAIPromptCacheBreakpoints(
        messages,
        req.chatPrompt
      );
      messages = applied.messages;
      breakpointCount = applied.markerCount;
      // The key helps implicit matching too, so it is sent whenever caching was
      // asked for — even when no message could take a marker.
      promptCacheKey = axResolveOpenAIPromptCacheKey(config, this.options);
      if (!promptCacheKey) {
        (config.logger ?? this.options?.logger)?.({
          name: 'Notification',
          id: 'openai-prompt-cache-key-missing',
          value:
            'OpenAI prompt caching is enabled but neither promptCacheKey nor sessionId is set. GPT-5.6+ needs a key that is stable per conversation for reliable cache matching.',
        });
      }
    }

    const frequencyPenalty =
      req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty;

    const stream = req.modelConfig?.stream ?? this.config.stream;

    const store = this.config.store;

    const isThinkingModel = isOpenAIThinkingModel(model as string);

    let reqValue: AxAIOpenAIChatRequest<TModel> = {
      model,
      messages,
      ...(req.responseFormat
        ? {
            response_format:
              req.responseFormat.type === 'json_schema'
                ? {
                    type: 'json_schema',
                    json_schema: req.responseFormat.schema,
                  }
                : req.responseFormat,
          }
        : this.config?.responseFormat
          ? { response_format: { type: this.config.responseFormat } }
          : {}),
      ...(tools ? { tools } : {}),
      ...(toolsChoice ? { tool_choice: toolsChoice } : {}),
      // For thinking models, don't set these parameters as they're not supported
      ...(isThinkingModel
        ? {}
        : {
            ...((req.modelConfig?.maxTokens ?? this.config.maxTokens) !==
            undefined
              ? {
                  max_completion_tokens: (req.modelConfig?.maxTokens ??
                    this.config.maxTokens)!,
                }
              : {}),
            ...(req.modelConfig?.temperature !== undefined
              ? { temperature: req.modelConfig.temperature }
              : {}),
            ...(req.modelConfig?.topP !== undefined
              ? { top_p: req.modelConfig.topP }
              : {}),
            ...((req.modelConfig?.n ?? this.config.n) !== undefined
              ? { n: (req.modelConfig?.n ?? this.config.n)! }
              : {}),
            ...((req.modelConfig?.presencePenalty ??
              this.config.presencePenalty) !== undefined
              ? {
                  presence_penalty: (req.modelConfig?.presencePenalty ??
                    this.config.presencePenalty)!,
                }
              : {}),
            ...(frequencyPenalty !== undefined
              ? { frequency_penalty: frequencyPenalty }
              : {}),
          }),
      ...((req.modelConfig?.stopSequences ?? this.config.stop) &&
      (req.modelConfig?.stopSequences ?? this.config.stop)!.length > 0
        ? { stop: (req.modelConfig?.stopSequences ?? this.config.stop)! }
        : {}),
      ...(this.config.logitBias !== undefined
        ? { logit_bias: this.config.logitBias }
        : {}),
      ...(stream && this.streamingUsage
        ? { stream: true, stream_options: { include_usage: true } }
        : {}),
      // `explicit` deliberately drops the implicit breakpoint at the newest
      // user/tool message: that entry covers the volatile trailing message and
      // so is written but never read back.
      ...(breakpointCount > 0
        ? { prompt_cache_options: { mode: 'explicit' as const } }
        : {}),
      ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
      ...(store ? { store: store } : {}),
      ...(serviceTier ? { service_tier: serviceTier } : {}),
      ...(this.config.user ? { user: this.config.user } : {}),
    };

    if (useRealtime) {
      if (req.responseFormat || reqValue.response_format) {
        throw new Error(
          `${this.realtime?.apiName ?? 'OpenAI Realtime'} models do not support structured response formats with audio output or transcription`
        );
      }
      const realtimeApi = (
        this.realtime?.createApi ?? axCreateOpenAIRealtimeApi
      )({
        model,
        request: reqValue,
        apiKey: this.apiKey,
        audio: realtimeAudio,
        webSocket: config.webSocket ?? this.options?.webSocket,
        debug: config.debug ?? this.options?.debug,
      });
      apiConfig.name = realtimeApi.name;
      apiConfig.localCall = realtimeApi.localCall;
    } else {
      reqValue = axApplyOpenAIChatAudioRequest(
        reqValue,
        req,
        this.config.audio
      );
    }

    if (this.config.reasoningEffort) {
      reqValue.reasoning_effort = this.config.reasoningEffort;
    }

    if (this.config.webSearchOptions) {
      reqValue.web_search_options = {
        ...(this.config.webSearchOptions.searchContextSize && {
          search_context_size: this.config.webSearchOptions.searchContextSize,
        }),
        ...(this.config.webSearchOptions.userLocation && {
          user_location: {
            approximate: {
              type: 'approximate',
              ...(this.config.webSearchOptions.userLocation.approximate
                .city && {
                city: this.config.webSearchOptions.userLocation.approximate
                  .city,
              }),
              ...(this.config.webSearchOptions.userLocation.approximate
                .country && {
                country:
                  this.config.webSearchOptions.userLocation.approximate.country,
              }),
              ...(this.config.webSearchOptions.userLocation.approximate
                .region && {
                region:
                  this.config.webSearchOptions.userLocation.approximate.region,
              }),
              ...(this.config.webSearchOptions.userLocation.approximate
                .timezone && {
                timezone:
                  this.config.webSearchOptions.userLocation.approximate
                    .timezone,
              }),
            },
          },
        }),
      };
    }

    // Then, override based on prompt-specific config
    if (config?.thinkingTokenBudget) {
      reqValue.reasoning_effort = axResolveOpenAIChatReasoningEffort(
        model,
        config.thinkingTokenBudget
      );
    }

    if (this.chatReqUpdater) {
      reqValue = this.chatReqUpdater(reqValue as TChatReq, config);
    }

    return [apiConfig, reqValue];
  };

  createEmbedReq = (
    req: Readonly<AxInternalEmbedRequest<TEmbedModel>>
  ): [AxAPI, AxAIOpenAIEmbedRequest<TEmbedModel>] => {
    const model = req.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: '/embeddings',
    };

    const reqValue = {
      model: model,
      input: req.texts,
      dimensions: this.config.dimensions,
    };

    return [apiConfig, reqValue];
  };

  createChatResp(resp: Readonly<AxAIOpenAIChatResponse>): AxChatResponse {
    const { id, usage, choices, error } = resp;

    if (error) {
      throw error;
    }
    this.tokensUsed = axNormalizeOpenAIUsage(
      usage,
      resp.service_tier_used ?? resp.service_tier
    );

    const results = choices.map((choice) => {
      // Check for refusal and throw exception if present
      if (choice.message.refusal) {
        throw new AxAIRefusalError(choice.message.refusal, resp.model, resp.id);
      }

      const finishReason = mapFinishReason(choice.finish_reason);

      const functionCalls = choice.message.tool_calls?.map(
        ({ id, function: { arguments: params, name } }) => ({
          id: id,
          type: 'function' as const,
          function: { name, params },
        })
      );

      const audio = axMapOpenAIChatAudioResponse(choice.message.audio);
      const reasoning = readReasoning(
        choice.message,
        this.reasoningContentMode
      );

      return {
        index: choice.index,
        id: `${choice.index}`,
        content: choice.message.content ?? audio?.transcript ?? undefined,
        audio,
        thought: reasoning.thought,
        thoughtBlocks: reasoning.thoughtBlocks,
        citations: choice.message.annotations
          ?.filter((a) => a?.type === 'url_citation' && (a as any).url_citation)
          .map((a) => ({
            url: (a as any).url_citation?.url,
            title: (a as any).url_citation?.title,
            description: (a as any).url_citation?.description,
          })),
        functionCalls,
        finishReason,
      };
    });

    const chatResp: AxChatResponse = { results, remoteId: id };
    return this.chatRespProcessor ? this.chatRespProcessor(chatResp) : chatResp;
  }

  createChatStreamResp = (
    resp: Readonly<AxAIOpenAIChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    const { id, usage, choices } = resp;

    const sstate = state as {
      indexIdMap: Record<number, string>;
      serviceTier?: unknown;
    };
    sstate.serviceTier =
      resp.service_tier_used ?? resp.service_tier ?? sstate.serviceTier;
    this.tokensUsed = axNormalizeOpenAIUsage(usage, sstate.serviceTier);

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {};
    }

    const results = choices.map(
      ({ index, delta, finish_reason: oaiFinishReason }) => {
        const {
          content,
          role,
          refusal,
          audio: audioDelta,
          tool_calls: toolCalls,
          annotations,
        } = delta;
        // Check for refusal and throw exception if present
        if (refusal) {
          throw new AxAIRefusalError(refusal, undefined, id);
        }

        const finishReason = mapFinishReason(oaiFinishReason);
        const reasoning = readReasoning(delta, this.reasoningContentMode);

        const functionCalls = toolCalls
          ?.map(({ id: Id, index, function: { name, arguments: params } }) => {
            if (
              typeof Id === 'string' &&
              typeof index === 'number' &&
              !sstate.indexIdMap[index]
            ) {
              sstate.indexIdMap[index] = Id;
            }

            const id = sstate.indexIdMap[index];
            if (!id) {
              return null;
            }

            return {
              id,
              type: 'function' as const,
              function: { name, params },
            };
          })
          .filter((v) => v !== null);

        const audio = axMapOpenAIChatAudioDelta(audioDelta);

        return {
          index,
          content: content ?? audio?.transcript ?? undefined,
          role,
          audio,
          thought: reasoning.thought,
          thoughtBlocks: reasoning.thoughtBlocks,
          citations: annotations
            ?.filter(
              (a) => a?.type === 'url_citation' && (a as any).url_citation
            )
            .map((a) => ({
              url: (a as any).url_citation?.url,
              title: (a as any).url_citation?.title,
              description: (a as any).url_citation?.description,
            })),
          functionCalls,
          finishReason,
          id,
        };
      }
    );

    const chatStreamResp: AxChatResponse = { results, remoteId: id };
    return this.chatStreamRespProcessor
      ? this.chatStreamRespProcessor(chatStreamResp, state)
      : chatStreamResp;
  };

  createEmbedResp(resp: Readonly<AxAIOpenAIEmbedResponse>): AxEmbedResponse {
    const { data, usage } = resp;

    this.tokensUsed = axNormalizeOpenAIUsage(usage);

    return { embeddings: data.map((v) => v.embedding) };
  }
}

const mapFinishReason = (
  finishReason:
    | AxAIOpenAIChatResponse['choices'][0]['finish_reason']
    | null
    | undefined
): AxChatResponseResult['finishReason'] => {
  switch (finishReason) {
    case 'stop':
      return 'stop' as const;
    case 'length':
      return 'length' as const;
    case 'content_filter':
      return 'error' as const;
    case 'tool_calls':
      return 'function_call' as const;
  }
};

function createMessages<TModel>(
  req: Readonly<AxInternalChatRequest<TModel>>,
  allowRealtimeAudio = false,
  reasoningContentMode: AxOpenAIReasoningContentMode = 'none'
): AxAIOpenAIChatRequest<TModel>['messages'] {
  type UserContent = Extract<
    AxAIOpenAIChatRequest<TModel>['messages'][number],
    { role: 'user' }
  >['content'];

  const openaiReq = req.chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'system':
        return { role: 'system' as const, content: msg.content };

      case 'user': {
        const content: UserContent = Array.isArray(msg.content)
          ? msg.content.map((c) => {
              switch (c.type) {
                case 'text':
                  return { type: 'text' as const, text: c.text };
                case 'image': {
                  const url = `data:${c.mimeType};base64,${c.image}`;
                  return {
                    type: 'image_url' as const,
                    image_url: { url, details: c.details ?? 'auto' },
                  };
                }
                case 'audio': {
                  return axMapOpenAIInputAudioPart(c, {
                    allowPcm16: allowRealtimeAudio,
                  });
                }
                default:
                  throw new Error('Invalid content type');
              }
            })
          : msg.content;
        return {
          role: 'user' as const,
          ...(msg.name ? { name: msg.name } : {}),
          content,
        };
      }

      case 'assistant': {
        const reasoningAdapter = resolveReasoningAdapter(reasoningContentMode);
        const reasoningContent = reasoningAdapter.assistantField
          ? (msg.thought ??
            msg.thoughtBlocks?.map((block) => block.data).join(''))
          : undefined;
        const reasoningDetails = reasoningAdapter.assistantDetailsField
          ? msg.thoughtBlocks
              ?.map((block) => {
                try {
                  return JSON.parse(block.data) as unknown;
                } catch {
                  return undefined;
                }
              })
              .filter((detail) => detail !== undefined)
          : undefined;
        const reasoningDetailsPayload =
          reasoningAdapter.assistantDetailsField && reasoningDetails?.length
            ? {
                [reasoningAdapter.assistantDetailsField]: reasoningDetails,
              }
            : {};
        const toolCalls = msg.functionCalls?.map((v) => ({
          id: v.id,
          type: 'function' as const,
          function: {
            name: v.function.name,
            arguments:
              typeof v.function.params === 'object'
                ? JSON.stringify(v.function.params)
                : v.function.params,
          },
        }));

        if (toolCalls && toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            ...(reasoningAdapter.assistantField
              ? { content: msg.content ?? '' }
              : msg.content
                ? { content: msg.content }
                : {}),
            ...(reasoningContent && reasoningAdapter.assistantField
              ? { [reasoningAdapter.assistantField]: reasoningContent }
              : {}),
            ...reasoningDetailsPayload,
            name: msg.name,
            tool_calls: toolCalls,
          };
        }

        if (
          msg.content === undefined &&
          !msg.audio &&
          !reasoningContent &&
          !reasoningDetails?.length
        ) {
          throw new Error(
            'Assistant content is required when no tool calls are provided'
          );
        }

        return {
          role: 'assistant' as const,
          ...(msg.content !== undefined ? { content: msg.content } : {}),
          ...(reasoningContent && reasoningAdapter.assistantField
            ? { [reasoningAdapter.assistantField]: reasoningContent }
            : {}),
          ...reasoningDetailsPayload,
          ...(msg.audio ? { audio: { id: msg.audio.id } } : {}),
          ...(msg.name ? { name: msg.name } : {}),
        };
      }

      case 'function':
        return {
          role: 'tool' as const,
          content:
            msg.content
              ?.map((part) => {
                if (part.type === 'text') return part.text;
                if (part.type === 'image') {
                  return part.altText ?? `[MCP image result: ${part.mimeType}]`;
                }
                if (part.type === 'audio') {
                  return (
                    part.transcription ??
                    `[MCP audio result: ${part.mimeType ?? 'application/octet-stream'}]`
                  );
                }
                if (part.type === 'url') {
                  return (
                    part.cachedContent ??
                    [part.title, part.description, part.url]
                      .filter(Boolean)
                      .join('\n')
                  );
                }
                return (
                  part.extractedText ??
                  `[MCP file result: ${part.filename ?? 'file'} (${part.mimeType})]`
                );
              })
              .join('\n') ?? msg.result,
          tool_call_id: msg.functionId,
        };
      default:
        throw new Error('Invalid role');
    }
  });
  return openaiReq;
}

export class AxAIOpenAIBase<
  TModel,
  TEmbedModel,
  TModelKey,
  TChatReq extends
    AxAIOpenAIChatRequest<TModel> = AxAIOpenAIChatRequest<TModel>,
> extends AxBaseAI<
  TModel,
  TEmbedModel,
  AxAIOpenAIChatRequest<TModel>,
  AxAIOpenAIEmbedRequest<TEmbedModel>,
  AxAIOpenAIChatResponse,
  AxAIOpenAIChatResponseDelta,
  AxAIOpenAIEmbedResponse,
  TModelKey
> {
  protected batchAudioConfig: AxOpenAIBatchAudioConfig = {
    transcriptionModel: 'gpt-4o-mini-transcribe',
    speechModel: 'gpt-4o-mini-tts',
    speechVoice: 'alloy',
    speechFormat: 'mp3',
  };
  protected readonly openAICompatibleApiKey: string;
  protected readonly openAICompatibleApiURL: string;

  constructor({
    apiKey,
    credentialProvider,
    credentialProfile,
    config,
    options,
    apiURL,
    modelInfo,
    models,
    chatReqUpdater,
    chatRespProcessor,
    chatStreamRespProcessor,
    realtime,
    promptCaching,
    reasoningContentMode,
    supportFor,
  }: Readonly<
    AxAIOpenAIBaseInternalArgs<TModel, TEmbedModel, TModelKey, TChatReq>
  >) {
    if ((!apiKey || apiKey === '') && !credentialProvider) {
      throw new Error('OpenAI API key not set');
    }

    const effectiveApiKey = apiKey || 'renewable-credential';

    const aiImpl = new AxAIOpenAIImpl<TModel, TEmbedModel, TChatReq>(
      config,
      effectiveApiKey,
      options?.streamingUsage ?? true,
      options,
      chatReqUpdater,
      chatRespProcessor,
      chatStreamRespProcessor,
      realtime,
      promptCaching ?? false,
      reasoningContentMode ?? 'none',
      supportFor
    );

    const resolvedApiURL = apiURL ? apiURL : 'https://api.openai.com/v1';
    super(aiImpl, {
      name: 'OpenAI',
      apiURL: resolvedApiURL,
      headers: async () =>
        apiKey
          ? { Authorization: `Bearer ${apiKey}` }
          : ({} as Record<string, string>),
      profile: credentialProfile,
      credentialProvider,
      modelInfo,
      defaults: {
        model: config.model,
        embedModel: config.embedModel,
      },
      options,
      supportFor,
      models,
    });

    this.openAICompatibleApiKey = apiKey ?? '';
    this.openAICompatibleApiURL = resolvedApiURL;
  }

  protected setBatchAudioConfig(config: Readonly<AxOpenAIBatchAudioConfig>) {
    this.batchAudioConfig = { ...this.batchAudioConfig, ...config };
  }

  override async transcribe(
    req: Readonly<AxTranscriptionRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    const model =
      typeof req.model === 'string'
        ? req.model
        : this.batchAudioConfig.transcriptionModel;
    const serviceOptions = this.getOptions();
    return await axFetchMultipartTranscription({
      url: `${this.openAICompatibleApiURL}/audio/transcriptions`,
      headers: await this.buildHeaders(
        {},
        {
          operation: 'transcribe',
          method: 'POST',
          url: `${this.openAICompatibleApiURL}/audio/transcriptions`,
        }
      ),
      audio: req.audio,
      fields: {
        model: model ?? this.batchAudioConfig.transcriptionModel,
        language: req.language,
        prompt: req.prompt,
        temperature: req.temperature,
        response_format: req.responseFormat ?? 'json',
      },
      fetch: options?.fetch ?? serviceOptions.fetch,
      abortSignal: options?.abortSignal ?? serviceOptions.abortSignal,
    });
  }

  override async speak(
    req: Readonly<AxSpeechRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxSpeechResponse> {
    const format = req.format ?? this.batchAudioConfig.speechFormat ?? 'mp3';
    const model =
      typeof req.model === 'string'
        ? req.model
        : this.batchAudioConfig.speechModel;
    const voice =
      typeof req.voice === 'object'
        ? req.voice.id
        : (req.voice ?? this.batchAudioConfig.speechVoice ?? 'alloy');
    const serviceOptions = this.getOptions();
    return await axFetchJsonSpeech({
      url: `${this.openAICompatibleApiURL}/audio/speech`,
      headers: await this.buildHeaders(
        {},
        {
          operation: 'speak',
          method: 'POST',
          url: `${this.openAICompatibleApiURL}/audio/speech`,
        }
      ),
      body: {
        model,
        input: req.text,
        voice,
        response_format: format === 'pcm' ? 'pcm16' : format,
        ...(req.speed !== undefined ? { speed: req.speed } : {}),
      },
      format,
      transcript: req.text,
      fetch: options?.fetch ?? serviceOptions.fetch,
      abortSignal: options?.abortSignal ?? serviceOptions.abortSignal,
    });
  }
}

export class AxAIOpenAI<TModelKey = string> extends AxAIOpenAIBase<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel,
  TModelKey
> {
  constructor({
    apiKey,
    credentialProvider,
    apiURL,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<
    Omit<
      AxAIOpenAIArgs<
        'openai',
        AxAIOpenAIModel,
        AxAIOpenAIEmbedModel,
        TModelKey
      >,
      'name'
    >
  >) {
    if ((!apiKey || apiKey === '') && !credentialProvider) {
      throw new Error('OpenAI API key not set');
    }

    modelInfo = [...axModelInfoOpenAI, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIOpenAIModel) => {
      const mi = getModelInfo<AxAIOpenAIModel, AxAIOpenAIEmbedModel, TModelKey>(
        {
          model,
          modelInfo,
          models: models as AxAIInputModelList<
            AxAIOpenAIModel,
            AxAIOpenAIEmbedModel,
            TModelKey
          >,
        }
      );
      const isAudioModel = axIsOpenAIChatAudioModel(model);
      const isRealtimeModel = axIsOpenAIRealtimeModel(model);
      const isRealtimeTranscriptionModel =
        axIsOpenAIRealtimeTranscriptionModel(model);
      const nativeStructuredOutputs = mi?.supported?.structuredOutputs ?? true;
      const structuredOutputModes =
        mi?.supported?.structuredOutputModes ??
        (nativeStructuredOutputs
          ? (['native', 'function', 'json_object'] as const)
          : (['function', 'json_object'] as const));
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        structuredOutputs: structuredOutputModes.includes('native'),
        structuredOutputModes,
        media: {
          images: {
            supported: true,
            formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            maxSize: 20 * 1024 * 1024, // 20MB
            detailLevels: ['high', 'low', 'auto'] as (
              | 'high'
              | 'low'
              | 'auto'
            )[],
          },
          audio: {
            supported: true,
            formats:
              isAudioModel || isRealtimeModel
                ? ['wav', 'mp3', 'pcm16']
                : ['wav', 'mp3', 'ogg'],
            maxDuration: 25 * 60, // 25 minutes
            output: {
              supported: isAudioModel || isRealtimeModel,
              formats: ['wav', 'mp3', 'flac', 'opus', 'aac', 'pcm16'],
              voices: [
                'alloy',
                'ash',
                'ballad',
                'coral',
                'echo',
                'fable',
                'nova',
                'onyx',
                'sage',
                'shimmer',
                'marin',
                'cedar',
              ],
            },
            ...(isRealtimeTranscriptionModel
              ? { output: { supported: false, formats: [], voices: [] } }
              : {}),
          },
          files: {
            supported: true,
            formats: [
              'text/plain',
              'application/pdf',
              'image/jpeg',
              'image/png',
            ],
            maxSize: 512 * 1024 * 1024, // 512MB
            uploadMethod: 'upload' as 'inline' | 'upload' | 'cloud' | 'none',
          },
          urls: {
            supported: false,
            webSearch: true, // Available via web search options
            contextFetching: false,
          },
        },
        caching: {
          // GPT-5.6+ caches only at explicit breakpoints; earlier families
          // predate the parameters entirely. `cacheBreakpoints` is inert today
          // (callers only test for `=== false`) but records that this provider
          // needs positional markers rather than Anthropic's auto-lookback.
          supported: axIsGPT56Family(model),
          types: axIsGPT56Family(model)
            ? (['ephemeral'] as ('ephemeral' | 'persistent')[])
            : [],
          cacheBreakpoints: true,
        },
        thinking: mi?.supported?.thinkingBudget ?? false,
        multiTurn: true,
        serviceTiers:
          mi?.supported?.serviceTiers ??
          (isRealtimeModel || isRealtimeTranscriptionModel
            ? []
            : (['standard', 'flex', 'priority'] as const)),
      };
    };

    // Normalize per-model presets to allow provider-specific item.config to influence defaults
    const normalizedModels = models?.map((item) => {
      const anyItem = item as any;
      const cfg = anyItem?.config as
        | Partial<AxAIOpenAIConfig<AxAIOpenAIModel, AxAIOpenAIEmbedModel>>
        | undefined;
      if (!cfg) return item;

      const modelConfig: Partial<AxModelConfig> = {};
      if (cfg.maxTokens !== undefined) modelConfig.maxTokens = cfg.maxTokens;
      if (cfg.temperature !== undefined)
        modelConfig.temperature = cfg.temperature;
      if (cfg.topP !== undefined) modelConfig.topP = cfg.topP;
      if (cfg.presencePenalty !== undefined)
        modelConfig.presencePenalty = cfg.presencePenalty as number;
      if (cfg.frequencyPenalty !== undefined)
        modelConfig.frequencyPenalty = cfg.frequencyPenalty as number;
      // Support both AxModelConfig.stopSequences and OpenAI's stop
      const stopSeq = (cfg as any).stopSequences ?? (cfg as any).stop;
      if (stopSeq !== undefined)
        modelConfig.stopSequences = stopSeq as string[];
      if (cfg.n !== undefined) modelConfig.n = cfg.n as number;
      if (cfg.stream !== undefined) modelConfig.stream = cfg.stream as boolean;

      const out: any = { ...anyItem };
      if (Object.keys(modelConfig).length > 0) {
        out.modelConfig = { ...(anyItem.modelConfig ?? {}), ...modelConfig };
      }

      // Map numeric thinking budget to closest Ax level for convenience
      const numericBudget = (cfg as any)?.thinking?.thinkingTokenBudget;
      if (typeof numericBudget === 'number') {
        const candidates = [
          ['minimal', 200],
          ['low', 800],
          ['medium', 5000],
          ['high', 10000],
          ['highest', 24500],
        ] as const;
        let bestName: 'minimal' | 'low' | 'medium' | 'high' | 'highest' =
          'minimal';
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const [name, value] of candidates) {
          const diff = Math.abs(numericBudget - value);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestName = name as typeof bestName;
          }
        }
        out.thinkingTokenBudget = bestName;
      }
      if ((cfg as any)?.thinking?.includeThoughts !== undefined) {
        out.showThoughts = !!(cfg as any).thinking.includeThoughts;
      }
      if (cfg.serviceTier !== undefined) {
        out.serviceTier = axNormalizeRequestedServiceTier(cfg.serviceTier);
      }

      return out as typeof item;
    });

    super({
      apiKey,
      credentialProvider,
      credentialProfile: 'openai',
      apiURL,
      config: {
        ...axAIOpenAIDefaultConfig(),
        ...config,
      },
      options,
      modelInfo,
      models: normalizedModels ?? models,
      promptCaching: true,
      supportFor,
    });

    super.setName('OpenAI');
  }
}
