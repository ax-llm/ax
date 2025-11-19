import type { AxAIFeatures } from '../base.js';
import type { AxModelInfo } from '../types.js';
import {
  AxAIOpenAIBase,
  type AxAIOpenAIBaseArgs,
  axAIOpenAIDefaultConfig,
} from '../openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js';

export type AxAIOpenAICompatibleConfig = AxAIOpenAIConfig<string, string>;

export type AxAIOpenAICompatibleArgs<TModelKey = string> = {
  name: 'openai-compatible';
} & Omit<
  AxAIOpenAIBaseArgs<
    string,
    string,
    TModelKey,
    AxAIOpenAIChatRequest<string>
  >,
  'name' | 'config' | 'modelInfo' | 'supportFor'
> & {
  endpoint: string;
  config?: Partial<AxAIOpenAICompatibleConfig>;
  modelInfo?: AxModelInfo[];
  /** Optional static headers merged with Authorization */
  headers?: Record<string, string>;
  /** Display name used for metrics/logging */
  providerName?: string;
  /** Optional override for capability metadata */
  supportFor?: AxAIFeatures | ((model: string) => AxAIFeatures);
};

const defaultFeatures: AxAIFeatures = {
  functions: true,
  streaming: true,
  hasThinkingBudget: false,
  hasShowThoughts: false,
  media: {
    images: {
      supported: true,
      formats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      detailLevels: ['auto', 'high', 'low'],
    },
    audio: {
      supported: true,
      formats: ['wav', 'mp3', 'ogg'],
    },
    files: {
      supported: true,
      formats: ['text/plain', 'application/pdf', 'image/jpeg', 'image/png'],
      uploadMethod: 'upload',
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

export class AxAIOpenAICompatible<
  TModelKey = string,
> extends AxAIOpenAIBase<string, string, TModelKey> {
  constructor({
    apiKey,
    endpoint,
    config,
    options,
    models,
    modelInfo,
    headers,
    providerName,
    supportFor,
    chatReqUpdater,
  }: Readonly<AxAIOpenAICompatibleArgs<TModelKey>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI-compatible API key not set');
    }

    if (!endpoint || endpoint === '') {
      throw new Error('OpenAI-compatible endpoint not set');
    }

    const mergedConfig: AxAIOpenAICompatibleConfig = {
      ...axAIOpenAIDefaultConfig(),
      ...config,
    };

    super({
      apiKey,
      apiURL: endpoint,
      config: mergedConfig,
      options,
      models,
      modelInfo: modelInfo ?? [],
      supportFor: supportFor ?? defaultFeatures,
      chatReqUpdater,
    });

    super.setName(providerName ?? 'OpenAI-Compatible');
    super.setHeaders(async () => ({
      Authorization: `Bearer ${apiKey}`,
      ...(headers ?? {}),
    }));
  }
}
