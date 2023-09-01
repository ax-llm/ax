import { AIPromptConfig, AIServiceOptions } from '../text/types.js';

import { BaseAI } from './base.js';
import {
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from './types.js';

const modelInfo: TextModelInfo[] = [
  {
    name: 'betty-fake-completion-model',
    currency: 'usd',
    promptTokenCostPer1K: 0.03,
    completionTokenCostPer1K: 0.06,
    maxTokens: 1024,
  },
  {
    name: 'betty-fake-embed-model',
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.006,
    maxTokens: 8192,
  },
];
/**
 * Betty: Fake AI Service for writing tests
 * @export
 */
export class Betty extends BaseAI {
  // private answers: string[];
  private data: string[];
  // private sdata: Map<string, string[]> = new Map();
  private index = 0;

  constructor(
    answers: readonly string[],
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Betty',
      modelInfo,
      {
        model: 'betty-fake-completion-model',
        embedModel: 'betty-fake-embed-model',
      },
      otherOptions
    );
    // this.answers = [...answers];
    this.data = [...answers];
  }

  getModelConfig(): Readonly<GenerateTextModelConfig> {
    return {
      maxTokens: 1024,
      temperature: 0.7,
      topP: 1,
      stream: false,
      logprobs: 0,
      echo: false,
      presencePenalty: 0,
      frequencyPenalty: 0,
      bestOf: 1,
      suffix: null,
    };
  }

  _generate(
    prompt: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AIPromptConfig>
  ): Promise<GenerateTextResponse> {
    const answers = this.data;
    const text = answers?.shift() || '';
    this.index++;

    const res = {
      remoteId: this.index.toString(),
      modelUsage: {
        promptTokens: prompt.length,
        totalTokens: prompt.length + (text?.length || 0),
        completionTokens: text?.length || 0,
      },
      results: [{ id: '0', text }],
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new Promise((resolve, _reject) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }

  _embed(textToEmbed: readonly string[] | string): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;
    const embedding = [1, 2, 3, 4];
    const res = {
      id: '',
      texts,
      modelUsage: {
        promptTokens: texts.length,
        totalTokens: texts.length + embedding.length,
        completionTokens: embedding.length,
      },
      embedding,
    };
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(res);
      }, 300);
    });
  }
}
