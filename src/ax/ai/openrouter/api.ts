import { axBaseAIDefaultConfig } from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';
import type { AxAIServiceOptions } from '../types.js';

type OpenRouterConfig = AxAIOpenAIConfig<string, unknown>;

export const axAIOpenRouterDefaultConfig = (): OpenRouterConfig =>
  structuredClone({
    model: 'openrouter/auto',
    ...axBaseAIDefaultConfig(),
  });

export type AxAIOpenRouterArgs<TModelKey> = AxAIOpenAIArgs<
  'openrouter',
  string,
  unknown,
  TModelKey
> & {
  referer?: string;
  title?: string;
  options?: Readonly<AxAIServiceOptions>;
};

export class AxAIOpenRouter<TModelKey> extends AxAIOpenAIBase<
  string,
  unknown,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
    referer,
    title,
  }: Readonly<Omit<AxAIOpenRouterArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenRouter API key not set');
    }

    const Config: OpenRouterConfig = {
      ...axAIOpenRouterDefaultConfig(),
      ...config,
    };

    const supportFor = {
      functions: true,
      streaming: true,
      hasThinkingBudget: false,
      hasShowThoughts: false,
      media: {
        images: { supported: false, formats: [] },
        audio: { supported: false, formats: [] },
        files: { supported: false, formats: [], uploadMethod: 'none' as const },
        urls: { supported: false, webSearch: false, contextFetching: false },
      },
      caching: { supported: false, types: [] },
      thinking: false,
      multiTurn: true,
    };

    const ModelInfo = modelInfo ?? [];

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://openrouter.ai/api/v1',
      modelInfo: ModelInfo,
      models,
      supportFor,
    });

    super.setName('OpenRouter');
    super.setHeaders(async () => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      };
      if (referer) headers['HTTP-Referer'] = referer;
      if (title) headers['X-Title'] = title;
      return headers;
    });
  }
}
