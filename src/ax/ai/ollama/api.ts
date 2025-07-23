import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

export type AxAIOllamaAIConfig = AxAIOpenAIConfig<string, string>;

export const axAIOllamaDefaultConfig = (): AxAIOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm',
  });

export const axAIOllamaDefaultCreativeConfig = (): AxAIOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultCreativeConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm',
  });

export type AxAIOllamaArgs<TModelKey> = AxAIOpenAIArgs<
  'ollama',
  string,
  string,
  TModelKey
> & {
  model?: string;
  embedModel?: string;
  url?: string;
};

/**
 * OllamaAI: AI Service
 */
export class AxAIOllama<TModelKey> extends AxAIOpenAIBase<
  string,
  string,
  TModelKey
> {
  constructor({
    apiKey = 'not-set',
    url = 'http://localhost:11434/v1',
    config,
    options,
    models,
  }: Readonly<Omit<AxAIOllamaArgs<TModelKey>, 'name'>>) {
    const Config = {
      ...axAIOllamaDefaultConfig(),
      ...config,
    };
    super({
      apiKey,
      options,
      config: Config,
      apiURL: url,
      models,
      modelInfo: [],
      supportFor: {
        functions: true,
        streaming: true,
        hasThinkingBudget: false,
        hasShowThoughts: false,
      },
    });

    super.setName('Ollama');
  }
}
