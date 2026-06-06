import type { AxAIFeatures } from '../base.js';
import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';
import type { AxAIServiceOptions, AxModelInfo } from '../types.js';

import { axModelInfoLiteLLM } from './info.js';
import type { AxAILiteLLMModel } from './types.js';

type LiteLLMConfig = AxAIOpenAIConfig<AxAILiteLLMModel, AxAILiteLLMModel>;

export const axAILiteLLMDefaultConfig = (): LiteLLMConfig =>
  structuredClone({
    model: 'gpt-4o-mini' as AxAILiteLLMModel,
    ...axBaseAIDefaultConfig(),
  });

export const axAILiteLLMCreativeConfig = (): LiteLLMConfig =>
  structuredClone({
    model: 'gpt-4o-mini' as AxAILiteLLMModel,
    ...axBaseAIDefaultCreativeConfig(),
  });

const axAILiteLLMSupportFor = (_model: AxAILiteLLMModel): AxAIFeatures => ({
  functions: true,
  streaming: true,
  hasThinkingBudget: false,
  hasShowThoughts: false,
  media: {
    images: {
      supported: true,
      formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
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
});

/**
 * Arguments type for initializing LiteLLM AI instances.
 * Requires `apiURL` pointing to a running LiteLLM proxy.
 */
export type AxAILiteLLMArgs<TModelKey> = AxAIOpenAIArgs<
  'litellm',
  AxAILiteLLMModel,
  AxAILiteLLMModel,
  TModelKey
>;

/**
 * LiteLLM AI gateway provider.
 *
 * Connects to a self-hosted LiteLLM proxy that provides a unified
 * OpenAI-compatible API across 100+ LLM providers (Anthropic, Gemini,
 * Bedrock, Azure, Ollama, etc.).
 *
 * @example
 * ```typescript
 * const ai = new AxAILiteLLM({
 *   apiKey: process.env.LITELLM_API_KEY,
 *   apiURL: 'http://localhost:4000/v1',
 *   config: { model: 'anthropic/claude-sonnet-4-20250514' },
 * });
 * ```
 */
export class AxAILiteLLM<TModelKey = string> extends AxAIOpenAIBase<
  AxAILiteLLMModel,
  AxAILiteLLMModel,
  TModelKey
> {
  constructor({
    apiKey,
    apiURL,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAILiteLLMArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('LiteLLM API key not set');
    }
    if (!apiURL || apiURL === '') {
      throw new Error(
        'LiteLLM API URL not set (set apiURL to your LiteLLM proxy, e.g. http://localhost:4000/v1)'
      );
    }

    const _config: LiteLLMConfig = {
      ...axAILiteLLMDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoLiteLLM, ...(modelInfo ?? [])];

    super({
      apiKey,
      apiURL,
      config: _config,
      options,
      modelInfo,
      supportFor: axAILiteLLMSupportFor,
      models,
    });

    super.setName('LiteLLM');
  }

  async fetchModelList(
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxModelInfo[]> {
    const url = `${this.openAICompatibleApiURL}/models`;
    const fetchFn = options?.fetch ?? globalThis.fetch;
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${this.openAICompatibleApiKey}` },
    });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as {
      data?: { id: string }[];
    };
    return (json.data ?? []).map((m) => ({ name: m.id }));
  }
}
