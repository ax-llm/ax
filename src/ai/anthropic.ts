import { AIPromptConfig, AIServiceOptions } from '../text/types.js';
import { API, apiCall } from '../util/apicall.js';

import { BaseAI } from './base.js';
import { TextModelConfig, TextResponse, TextModelInfo } from './types.js';

type AnthropicAPI = API & {
  headers: { 'Anthropic-Version': string };
};

const apiURL = 'https://api.anthropic.com/';

/**
 * Anthropic: Models for text generation
 * @export
 */
export enum AnthropicModel {
  Claude2 = 'claude-2',
  ClaudeInstant = 'claude-instant',
}

const modelInfo: TextModelInfo[] = [
  {
    name: AnthropicModel.Claude2,
    currency: 'usd',
    promptTokenCostPer1K: 0.01102,
    completionTokenCostPer1K: 0.03268,
    maxTokens: 100000,
  },
  {
    name: AnthropicModel.ClaudeInstant,
    currency: 'usd',
    promptTokenCostPer1K: 0.00163,
    completionTokenCostPer1K: 0.00551,
    maxTokens: 100000,
  },
];

/**
 * Anthropic: Model options for text generation
 * @export
 */
export type AnthropicOptions = {
  model: AnthropicModel;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK?: number;
  stream?: boolean;
  stopSequences?: string[];
};

/**
 * Anthropic: Default Model options for text generation
 * @export
 */
export const AnthropicDefaultOptions = (): AnthropicOptions => ({
  model: AnthropicModel.Claude2,
  maxTokens: 1000,
  temperature: 0,
  topP: 1,
});

type AnthropicRequest = {
  stop_sequences: readonly string[];
  metadata?: {
    user_id?: string;
  };
  model: AnthropicModel | string;
  prompt: string;
  max_tokens_to_sample: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
};

type AnthropicAITextResponse = {
  id: string;
  prompt: string;
  generations: { id: string; text: string }[];
};

const generateReq = (
  prompt: string,
  opt: Readonly<AnthropicOptions>,
  stopSequences?: readonly string[]
): AnthropicRequest => ({
  stop_sequences: stopSequences || [],
  model: opt.model,
  prompt,
  max_tokens_to_sample: opt.maxTokens,
  temperature: opt.temperature,
  top_p: opt.topP,
  top_k: opt.topK,
  stream: opt.stream,
});

/**
 * Anthropic: AI Service
 * @export
 */
export class Anthropic extends BaseAI {
  private apiKey: string;
  private options: AnthropicOptions;

  constructor(
    apiKey: string,
    options: Readonly<AnthropicOptions> = AnthropicDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Anthropic',
      modelInfo,
      {
        model: options.model,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('Anthropic API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      stream: options.stream,
    } as TextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<
      AnthropicAPI,
      AnthropicRequest,
      AnthropicAITextResponse
    >(
      {
        key: this.apiKey,
        name: 'complete',
        url: apiURL,
        headers: { 'Anthropic-Version': '2023-06-01' },
      },
      generateReq(prompt, this.options, options?.stopSequences)
    );

    const { id, generations } = res;
    return {
      remoteId: id,
      results: generations,
    };
  }
}
