import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxAIRefusalError } from '../../util/apicall.js';
import {
  type AxAIFeatures,
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import type {
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
  AxTokenUsage,
} from '../types.js';
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
import { axModelInfoOpenAI } from './info.js';

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
  req: Readonly<TChatReq>
) => TChatReq;

export interface AxAIOpenAIBaseArgs<
  TModel,
  TEmbedModel,
  TModelKey,
  TChatReq extends AxAIOpenAIChatRequest<TModel>,
> {
  apiKey: string;
  apiURL?: string;
  config: Readonly<AxAIOpenAIConfig<TModel, TEmbedModel>>;
  options?: Readonly<AxAIServiceOptions & { streamingUsage?: boolean }>;
  modelInfo: Readonly<AxModelInfo[]>;
  models?: AxAIInputModelList<TModel, TEmbedModel, TModelKey>;
  chatReqUpdater?: ChatReqUpdater<TModel, TChatReq>;
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
    private streamingUsage: boolean,
    private readonly chatReqUpdater?: ChatReqUpdater<TModel, TChatReq>
  ) {}

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

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
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

    const messages = createMessages(req);

    const frequencyPenalty =
      req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty;

    const stream = req.modelConfig?.stream ?? this.config.stream;

    const store = this.config.store;

    const isThinkingModel = isOpenAIThinkingModel(model as string);

    let reqValue: AxAIOpenAIChatRequest<TModel> = {
      model,
      messages,
      ...(this.config?.responseFormat
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
      ...(store ? { store: store } : {}),
      ...(this.config.serviceTier
        ? { service_tier: this.config.serviceTier }
        : {}),
      ...(this.config.user ? { user: this.config.user } : {}),
    };

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
      switch (config.thinkingTokenBudget) {
        case 'none':
          reqValue.reasoning_effort = undefined; // Explicitly set to undefined
          break;
        case 'minimal':
          reqValue.reasoning_effort = 'minimal';
          break;
        case 'low':
          reqValue.reasoning_effort = 'medium';
          break;
        case 'medium':
          reqValue.reasoning_effort = 'high';
          break;
        case 'high':
          reqValue.reasoning_effort = 'high';
          break;
        case 'highest':
          reqValue.reasoning_effort = 'high';
          break;
      }
    }

    // If a per-model key mapped numeric thinking budget to an Ax level via models[],
    // set reasoning_effort accordingly when not overridden above
    if (!reqValue.reasoning_effort && (config as any)?.thinkingTokenBudget) {
      switch ((config as any).thinkingTokenBudget) {
        case 'minimal':
          reqValue.reasoning_effort = 'minimal';
          break;
        case 'low':
          reqValue.reasoning_effort = 'medium';
          break;
        case 'medium':
        case 'high':
        case 'highest':
          reqValue.reasoning_effort = 'high';
          break;
      }
    }

    if (this.chatReqUpdater) {
      reqValue = this.chatReqUpdater(reqValue as TChatReq);
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
    this.tokensUsed = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined;

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

      return {
        index: choice.index,
        id: `${choice.index}`,
        content: choice.message.content ?? undefined,
        thought: choice.message.reasoning_content,
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

    return {
      results,
      remoteId: id,
    };
  }

  createChatStreamResp(
    resp: Readonly<AxAIOpenAIChatResponseDelta>,
    state: object
  ): AxChatResponse {
    const { id, usage, choices } = resp;

    this.tokensUsed = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined;

    const sstate = state as {
      indexIdMap: Record<number, string>;
    };

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {};
    }

    const results = choices.map(
      ({
        index,
        delta: {
          content,
          role,
          refusal,
          tool_calls: toolCalls,
          reasoning_content: thought,
          annotations,
        },
        finish_reason: oaiFinishReason,
      }) => {
        // Check for refusal and throw exception if present
        if (refusal) {
          throw new AxAIRefusalError(refusal, undefined, id);
        }

        const finishReason = mapFinishReason(oaiFinishReason);

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

        return {
          index,
          content: content ?? undefined,
          role,
          thought,
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

    return { results };
  }

  createEmbedResp(resp: Readonly<AxAIOpenAIEmbedResponse>): AxEmbedResponse {
    const { data, usage } = resp;

    this.tokensUsed = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined;

    return { embeddings: data.map((v) => v.embedding) };
  }
}

const mapFinishReason = (
  finishReason: AxAIOpenAIChatResponse['choices'][0]['finish_reason']
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
  req: Readonly<AxInternalChatRequest<TModel>>
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
                  const data = c.data;
                  return {
                    type: 'input_audio' as const,
                    input_audio: {
                      data,
                      format: c.format === 'wav' ? 'wav' : undefined,
                    },
                  };
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
            ...(msg.content ? { content: msg.content } : {}),
            name: msg.name,
            tool_calls: toolCalls,
          };
        }

        if (msg.content === undefined) {
          throw new Error(
            'Assistant content is required when no tool calls are provided'
          );
        }

        return {
          role: 'assistant' as const,
          content: msg.content,
          ...(msg.name ? { name: msg.name } : {}),
        };
      }

      case 'function':
        return {
          role: 'tool' as const,
          content: msg.result,
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
  constructor({
    apiKey,
    config,
    options,
    apiURL,
    modelInfo,
    models,
    chatReqUpdater,
    supportFor,
  }: Readonly<
    Omit<AxAIOpenAIBaseArgs<TModel, TEmbedModel, TModelKey, TChatReq>, 'name'>
  >) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set');
    }

    const aiImpl = new AxAIOpenAIImpl<TModel, TEmbedModel, TChatReq>(
      config,
      options?.streamingUsage ?? true,
      chatReqUpdater
    );

    super(aiImpl, {
      name: 'OpenAI',
      apiURL: apiURL ? apiURL : 'https://api.openai.com/v1',
      headers: async () => ({ Authorization: `Bearer ${apiKey}` }),
      modelInfo,
      defaults: {
        model: config.model,
        embedModel: config.embedModel,
      },
      options,
      supportFor,
      models,
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
    if (!apiKey || apiKey === '') {
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
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
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
            formats: ['wav', 'mp3', 'ogg'],
            maxDuration: 25 * 60, // 25 minutes
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
          supported: false,
          types: [],
        },
        thinking: mi?.supported?.thinkingBudget ?? false,
        multiTurn: true,
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

      return out as typeof item;
    });

    super({
      apiKey,
      apiURL,
      config: {
        ...axAIOpenAIDefaultConfig(),
        ...config,
      },
      options,
      modelInfo,
      models: normalizedModels ?? models,
      supportFor,
    });

    super.setName('OpenAI');
  }
}
