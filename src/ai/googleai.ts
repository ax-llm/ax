import {
  AIPromptConfig,
  AIServiceOptions,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from '../text/types.js';

import { API, apiCall } from '../util/apicall.js';
import { BaseAI } from './base.js';

/**
 * GoogleAI: API call details
 * @export
 */
export type GoogleAIAPI = API;

const apiURL = 'https://us-central1-aiplatform.googleapis.com/v1/projects/';

/**
 * GoogleAI: Models for text generation
 * @export
 */
export enum GoogleAIGenerateModel {
  PaLMTextBison = `text-bison`,
  PaLMChatBison = `chat-bison`,
}

/**
 * GoogleAI: Models for use in embeddings
 * @export
 */
export enum GoogleAIEmbedModels {
  PaLMTextEmbeddingGecko = 'textembedding-gecko',
}

/**
 * GoogleAI: Model information
 * @export
 */
const modelInfo: TextModelInfo[] = [
  {
    name: GoogleAIGenerateModel.PaLMTextBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 8192,
  },
  {
    name: GoogleAIGenerateModel.PaLMChatBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0005,
    completionTokenCostPer1K: 0.0005,
    maxTokens: 4096,
  },
  {
    name: GoogleAIEmbedModels.PaLMTextEmbeddingGecko,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 3072,
  },
];

/**
 * GoogleAI: Model options for text generation
 * @export
 */
export type GoogleAIOptions = {
  model: GoogleAIGenerateModel;
  embedModel: GoogleAIEmbedModels;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
};

/**
 * GoogleAI: Default Model options for text generation
 * @export
 */
export const GoogleAIDefaultOptions = (): GoogleAIOptions => ({
  model: GoogleAIGenerateModel.PaLMTextBison,
  embedModel: GoogleAIEmbedModels.PaLMTextEmbeddingGecko,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
  topK: 40,
});

/**
 * GoogleAI: Default model options for more creative text generation
 * @export
 */
export const GoogleAICreativeOptions = (): GoogleAIOptions => ({
  ...GoogleAIDefaultOptions(),
  model: GoogleAIGenerateModel.PaLMTextBison,
  temperature: 0.9,
});

/**
 * GoogleAI: Default model options for more fast text generation
 * @export
 */
export const GoogleAIFastOptions = (): GoogleAIOptions => ({
  ...GoogleAIDefaultOptions(),
  model: GoogleAIGenerateModel.PaLMTextBison,
  temperature: 0.45,
});

type GoogleAIGenerateRequest = {
  instances: [
    {
      prompt: string;
    }
  ];
  parameters: {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  };
};

type GoogleAIGenerateTextResponse = {
  predictions: {
    content: string;
    safetyAttributes: {
      blocked: false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scores: any[];
    };
  }[];
};

type GoogleAIChatGenerateRequest = {
  instances: [
    {
      context: string;
      examples: { input: { content: string }; output: { content: string } }[];
      messages: { author: string; content: string }[];
    }
  ];
  parameters: {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  };
};

type GoogleAIChatGenerateResponse = {
  predictions: {
    candidates: { content: string }[];
    citationMetadata: { citations: string[] }[];
    safetyAttributes: {
      blocked: false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scores: any[];
    };
  }[];
};

type GoogleAIEmbedRequest = {
  instances: { content: string }[];
};

type GoogleAIEmbedResponse = {
  model: string;
  predictions: {
    embeddings: { values: number[] };
  }[];
};

const generateReq = (
  prompt: string,
  opt: Readonly<GoogleAIOptions>,
  stopSequences: readonly string[]
): GoogleAIGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'GoogleAI supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    instances: [{ prompt }],
    parameters: {
      maxOutputTokens: opt.maxTokens,
      temperature: opt.temperature,
      topP: opt.topP,
      topK: opt.topK,
    },
  };
};

const generateChatReq = (
  prompt: string,
  opt: Readonly<GoogleAIOptions>,
  stopSequences: readonly string[]
): GoogleAIChatGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'GoogleAI supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    instances: [{ context: prompt, examples: [], messages: [] }],
    parameters: {
      maxOutputTokens: opt.maxTokens,
      temperature: opt.temperature,
      topP: opt.topP,
      topK: opt.topK,
    },
  };
};

/**
 * GoogleAI: AI Service
 * @export
 */
export class GoogleAI extends BaseAI {
  private apiKey: string;
  private apiURL: string;
  private options: GoogleAIOptions;

  constructor(
    apiKey: string,
    projectId: string,
    options: Readonly<GoogleAIOptions> = GoogleAIDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'GoogleAI',
      modelInfo,
      {
        model: options.model,
        embedModel: options.embedModel,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('GoogleAI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;

    this.apiURL = new URL(
      `${projectId}/locations/us-central1/publishers/google/models/${options.model}:predict`,
      apiURL
    ).href;
  }

  getModelConfig(): GenerateTextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
    } as GenerateTextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<GenerateTextResponse> {
    if (
      [GoogleAIGenerateModel.PaLMChatBison].includes(
        this.options.model as GoogleAIGenerateModel
      )
    ) {
      return await this._generateChat(prompt, options);
    }
    return await this._generateDefault(prompt, options);
  }

  private async _generateDefault(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      GoogleAIAPI,
      GoogleAIGenerateRequest,
      GoogleAIGenerateTextResponse
    >(
      this.createAPI(),
      generateReq(prompt, this.options, options?.stopSequences ?? [])
    );

    const { predictions } = res;
    const promptTokens = prompt.length;
    const completionTokens = predictions.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any, { content: v }: Readonly<{ content: any }>) => a + v.length,
      0
    );
    const totalTokens = promptTokens + completionTokens;

    return {
      results: predictions.map((p) => ({ id: '', text: p.content })),
      modelUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
    };
  }

  private async _generateChat(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      GoogleAIAPI,
      GoogleAIChatGenerateRequest,
      GoogleAIChatGenerateResponse
    >(
      this.createAPI(),
      generateChatReq(prompt, this.options, options?.stopSequences ?? [])
    );

    const { predictions } = res;
    const promptTokens = prompt.length;
    const completionTokens = predictions
      .map((p) => p.candidates.map((c) => c.content))
      .flat()
      .reduce((a, v) => a + v.length, 0);
    const totalTokens = promptTokens + completionTokens;

    return {
      results: predictions.map((p) => ({
        id: '',
        text: p.candidates[0].content,
      })),
      modelUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
    };
  }

  async _embed(
    textToEmbed: Readonly<string[] | string>
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const embedReq = { instances: [{ content: texts.at(0) ?? '' }] };
    const res = await apiCall<
      GoogleAIAPI,
      GoogleAIEmbedRequest,
      GoogleAIEmbedResponse
    >(this.createAPI(), embedReq);

    const { predictions } = res;
    const promptTokens = texts.at(0)?.length ?? 0;

    return {
      texts,
      embedding: predictions.at(0)?.embeddings.values ?? [],
      modelUsage: {
        promptTokens,
        completionTokens: 0,
        totalTokens: promptTokens,
      },
    };
  }

  private createAPI(): GoogleAIAPI {
    return {
      url: this.apiURL,
      key: this.apiKey,
    };
  }
}
