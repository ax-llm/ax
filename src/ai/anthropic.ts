import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  EmbedResponse,
  TextModelInfo,
} from '../text/types.js';

import { API, apiCall } from './util.js';

type AnthropicAPI = API & {
  headers: { 'Anthropic-Version': string };
};

const apiURL = 'https://api.anthropic.com/';

/**
 * Anthropic: Models for text generation
 * @export
 */
export enum AnthropicGenerateModel {
  Claude2 = 'claude-2',
  ClaudeInstant = 'claude-instant',
}

const modelInfo: TextModelInfo[] = [
  {
    id: AnthropicGenerateModel.Claude2,
    currency: 'usd',
    promptTokenCostPer1K: 0.01102,
    completionTokenCostPer1K: 0.03268,
    maxTokens: 100000,
    oneTPM: 1,
  },
  {
    id: AnthropicGenerateModel.ClaudeInstant,
    currency: 'usd',
    promptTokenCostPer1K: 0.00163,
    completionTokenCostPer1K: 0.00551,
    maxTokens: 100000,
    oneTPM: 1,
  },
];

/**
 * Anthropic: Model options for text generation
 * @export
 */
export type AnthropicOptions = {
  model: AnthropicGenerateModel;
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
  model: AnthropicGenerateModel.Claude2,
  maxTokens: 1000,
  temperature: 0,
  topP: 1,
});

type AnthropicGenerateRequest = {
  stop_sequences: readonly string[];
  metadata?: {
    user_id?: string;
  };
  model: AnthropicGenerateModel | string;
  prompt: string;
  max_tokens_to_sample: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
};

type AnthropicAIGenerateTextResponse = {
  id: string;
  prompt: string;
  generations: { id: string; text: string }[];
};

const generateReq = (
  prompt: string,
  opt: Readonly<AnthropicOptions>,
  stopSequences?: readonly string[]
): AnthropicGenerateRequest => ({
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
export class Anthropic implements AIService {
  private apiKey: string;
  private options: AnthropicOptions;

  constructor(
    apiKey: string,
    options: Readonly<AnthropicOptions> = AnthropicDefaultOptions()
  ) {
    if (apiKey === '') {
      throw new Error('Anthropic API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }
  embed(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _text2Embed: readonly string[] | string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionID?: string | undefined
  ): Promise<EmbedResponse> {
    throw new Error('Method not implemented.');
  }

  name(): string {
    return 'Anthropic';
  }

  generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const model = modelInfo.find((v) => v.id === this.options.model);
    if (!model) {
      throw new Error(
        `Together model information not found: ${this.options.model}`
      );
    }

    prompt = prompt.trim();
    const res = apiCall<
      AnthropicAPI,
      AnthropicGenerateRequest,
      AnthropicAIGenerateTextResponse
    >(
      {
        key: this.apiKey,
        name: 'complete',
        url: apiURL,
        headers: { 'Anthropic-Version': '2023-06-01' },
      },
      generateReq(prompt, this.options, md?.stopSequences)
    );

    return res.then(({ id, generations: gens }) => ({
      id,
      sessionID,
      query: prompt,
      values: gens,
      usage: [{ model }],
      value() {
        return (this as { values: { text: string }[] }).values[0].text;
      },
    }));
  }
  // Add more methods as needed...
}
