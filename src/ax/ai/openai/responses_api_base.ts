import type { AxAIOpenAIResponsesConfig } from '@ax-llm/ax/index.js';
import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAIFeatures } from '../base.js';
import { AxBaseAI } from '../base.js';
import type {
  AxAIInputModelList,
  AxAIServiceOptions,
  AxModelConfig,
  AxModelInfo,
} from '../types.js';
import type {
  AxAIOpenAIEmbedRequest,
  AxAIOpenAIEmbedResponse,
} from './chat_types.js';
import { AxAIOpenAIEmbedModel } from './chat_types.js';
import { axModelInfoOpenAIResponses } from './info.js';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type {
  AxAIOpenAIResponsesRequest,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesResponseDelta,
} from './responses_types.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

// Helper functions to create default configurations
export const axAIOpenAIResponsesDefaultConfig = (): AxAIOpenAIResponsesConfig<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel
> => ({
  model: AxAIOpenAIResponsesModel.GPT4O,
  embedModel: AxAIOpenAIEmbedModel.TextEmbeddingAda002,
  temperature: 0.7,
  topP: 1,
  stream: true,
  //   reasoningEffort: 'medium',
});

export const axAIOpenAIResponsesBestConfig = (): AxAIOpenAIResponsesConfig<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel
> => ({
  ...axAIOpenAIResponsesDefaultConfig(),
  model: AxAIOpenAIResponsesModel.GPT4O,
  temperature: 0.5,
});

export const axAIOpenAIResponsesCreativeConfig = (): AxAIOpenAIResponsesConfig<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel
> => ({
  ...axAIOpenAIResponsesDefaultConfig(),
  model: AxAIOpenAIResponsesModel.GPT4O,
  temperature: 0.9,
});

// Arguments for AxAIOpenAIResponsesBase constructor
interface AxAIOpenAIResponsesBaseArgs<
  TModel,
  TEmbedModel,
  TModelKey,
  TResponsesReq extends AxAIOpenAIResponsesRequest<TModel>,
> {
  apiKey: string;
  config: AxAIOpenAIResponsesConfig<TModel, TEmbedModel>;
  options?: {
    streamingUsage?: boolean;
  } & AxAIServiceOptions;
  apiURL?: string;
  modelInfo?: ReadonlyArray<AxModelInfo>;
  models?: AxAIInputModelList<TModel, TEmbedModel, TModelKey>;
  responsesReqUpdater?: (
    req: Readonly<TResponsesReq>
  ) => Readonly<TResponsesReq>;
  supportFor?: AxAIFeatures | ((model: TModel) => AxAIFeatures);
}

/**
 * Base class for OpenAI AI services using the /v1/responses API endpoint
 */
export class AxAIOpenAIResponsesBase<
  TModel,
  TEmbedModel,
  TModelKey,
  TResponsesReq extends AxAIOpenAIResponsesRequest<TModel>,
> extends AxBaseAI<
  TModel,
  TEmbedModel,
  AxAIOpenAIResponsesRequest<TModel>,
  AxAIOpenAIEmbedRequest<TEmbedModel>,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesResponseDelta,
  AxAIOpenAIEmbedResponse,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    apiURL,
    modelInfo = [],
    models,
    responsesReqUpdater,
    supportFor = {
      functions: true,
      streaming: true,
      media: {
        images: {
          supported: false,
          formats: [],
        },
        audio: {
          supported: false,
          formats: [],
        },
        files: {
          supported: false,
          formats: [],
          uploadMethod: 'none' as const,
        },
        urls: {
          supported: false,
          webSearch: false,
          contextFetching: false,
        },
      },
      caching: {
        supported: false,
        types: [],
      },
      thinking: false,
      multiTurn: true,
    },
  }: Readonly<
    AxAIOpenAIResponsesBaseArgs<TModel, TEmbedModel, TModelKey, TResponsesReq>
  >) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set');
    }

    const aiImpl = new AxAIOpenAIResponsesImpl<
      TModel,
      TEmbedModel,
      TResponsesReq
    >(config, options?.streamingUsage ?? true, responsesReqUpdater);

    // Normalize per-model presets: allow provider-specific config on each model list item
    const normalizedModels = (
      models as AxAIInputModelList<TModel, TEmbedModel, TModelKey> | undefined
    )?.map((item) => {
      const anyItem = item as any;
      const cfg = anyItem?.config as
        | Partial<
            AxAIOpenAIResponsesConfig<AxAIOpenAIResponsesModel, TEmbedModel>
          >
        | undefined;
      if (!cfg) return item;

      const modelConfig: Partial<AxModelConfig> = {};
      if ((cfg as any).maxTokens !== undefined)
        modelConfig.maxTokens = (cfg as any).maxTokens;
      if ((cfg as any).temperature !== undefined)
        modelConfig.temperature = (cfg as any).temperature;
      if ((cfg as any).topP !== undefined) modelConfig.topP = (cfg as any).topP;
      if ((cfg as any).presencePenalty !== undefined)
        modelConfig.presencePenalty = (cfg as any).presencePenalty as number;
      if ((cfg as any).frequencyPenalty !== undefined)
        modelConfig.frequencyPenalty = (cfg as any).frequencyPenalty as number;
      const stopSeq = (cfg as any).stopSequences ?? (cfg as any).stop;
      if (stopSeq !== undefined)
        modelConfig.stopSequences = stopSeq as string[];
      if ((cfg as any).n !== undefined)
        modelConfig.n = (cfg as any).n as number;
      if ((cfg as any).stream !== undefined)
        modelConfig.stream = (cfg as any).stream as boolean;

      const out: any = { ...anyItem };
      if (Object.keys(modelConfig).length > 0) {
        out.modelConfig = { ...(anyItem.modelConfig ?? {}), ...modelConfig };
      }

      // Map optional numeric thinking budget to closest Ax level for convenience
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
      models: normalizedModels,
    });
  }
}

/**
 * Ready-to-use implementation of the OpenAI Responses API client
 * This class uses OpenAI's /v1/responses API endpoint which supports text, image, and audio inputs
 */

export interface AxAIOpenAIResponsesArgs<
  TName = 'openai-responses',
  TModel = AxAIOpenAIResponsesModel,
  TEmbedModel = AxAIOpenAIEmbedModel,
  TModelKey = string,
  TChatReq extends
    AxAIOpenAIResponsesRequest<TModel> = AxAIOpenAIResponsesRequest<TModel>,
> extends Omit<
    AxAIOpenAIResponsesBaseArgs<TModel, TEmbedModel, TModelKey, TChatReq>,
    'config' | 'supportFor' | 'modelInfo'
  > {
  name: TName;
  modelInfo?: AxModelInfo[];
  config?: Partial<
    AxAIOpenAIResponsesBaseArgs<
      TModel,
      TEmbedModel,
      TModelKey,
      TChatReq
    >['config']
  >;
}

export class AxAIOpenAIResponses<
  TModelKey = string,
> extends AxAIOpenAIResponsesBase<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel,
  TModelKey,
  AxAIOpenAIResponsesRequest<AxAIOpenAIResponsesModel>
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<
    Omit<
      AxAIOpenAIResponsesArgs<
        'openai-responses',
        AxAIOpenAIResponsesModel,
        AxAIOpenAIEmbedModel,
        TModelKey
      >,
      'name'
    >
  >) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set');
    }

    // Use the original OpenAI model info since it contains both chat and embed models
    modelInfo = [...axModelInfoOpenAIResponses, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIOpenAIResponsesModel) => {
      const mi = getModelInfo<
        AxAIOpenAIResponsesModel,
        AxAIOpenAIEmbedModel,
        TModelKey
      >({
        model,
        modelInfo,
        models,
      });
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        media: {
          images: {
            supported: false,
            formats: [],
          },
          audio: {
            supported: false,
            formats: [],
          },
          files: {
            supported: false,
            formats: [],
            uploadMethod: 'none' as const,
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: false,
        multiTurn: true,
      };
    };

    super({
      apiKey,
      config: {
        ...axAIOpenAIResponsesDefaultConfig(),
        ...config,
      },
      options,
      modelInfo,
      models,
      supportFor,
    });
  }
}
