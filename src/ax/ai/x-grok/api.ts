import { getModelInfo } from '@ax-llm/ax/dsp/modelinfo.js';
import { axBaseAIDefaultConfig } from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js';
import type { AxAIServiceOptions, AxModelInfo } from '../types.js';
import { axModelInfoGrok } from './info.js';
import { type AxAIGrokEmbedModels, AxAIGrokModel } from './types.js';

export const axAIGrokDefaultConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    model: AxAIGrokModel.Grok3Mini,
    ...axBaseAIDefaultConfig(),
  });

export const axAIGrokBestConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    ...axAIGrokDefaultConfig(),
    model: AxAIGrokModel.Grok3,
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

export type AxAIGrokArgs<TModelKey = string> = AxAIOpenAIArgs<
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

export class AxAIGrok<TModelKey = string> extends AxAIOpenAIBase<
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
      const mi = getModelInfo<AxAIGrokModel, AxAIGrokEmbedModels, TModelKey>({
        model,
        modelInfo,
        models,
      });
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.hasThinkingBudget ?? false,
        hasShowThoughts: mi?.hasShowThoughts ?? false,
      };
    };

    // Chat request updater to add Grok's search parameters
    const chatReqUpdater = (req: AxAIGrokChatRequest): AxAIGrokChatRequest => {
      if (options?.searchParameters) {
        const searchParams = options.searchParameters;
        return {
          ...req,
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
      return req;
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
    });

    super.setName('Grok');
  }
}
