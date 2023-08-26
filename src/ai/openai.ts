import {
  AIPromptConfig,
  AIServiceOptions,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
  TranscriptResponse,
} from '../text/types.js';

import { BaseAI } from './base.js';
import { API, apiCall, apiCallWithUpload } from './util.js';

/**
 * OpenAI: API call details
 * @export
 */
export type OpenAIAPI = API & {
  headers: { 'OpenAI-Organization'?: string };
};

const apiURL = 'https://api.openai.com/v1/';

/**
 * OpenAI: API types
 * @export
 */

const enum apiType {
  Generate = 'completions',
  ChatGenerate = 'chat/completions',
  Embed = 'embeddings',
  Transcribe = 'audio/transcriptions',
}

/**
 * OpenAI: Models for text generation
 * @export
 */
export enum OpenAIGenerateModel {
  GPT4 = 'gpt-4-0613',
  GPT432K = 'gpt-4-32k',
  GPT35Turbo = 'gpt-3.5-turbo-0613',
  GPT35Turbo16K = 'gpt-3.5-turbo-16k',
  GPT35TextDavinci003 = 'text-davinci-003',
  GPT35TextDavinci002 = 'text-davinci-002',
  GPT35CodeDavinci002 = 'code-davinci-002',
  GPT3TextCurie001 = 'text-curie-001',
  GPT3TextBabbage001 = 'text-babbage-001',
  GPT3TextAda001 = 'text-ada-001',
}

/**
 * OpenAI: Models for use in embeddings
 * @export
 */
export enum OpenAIEmbedModels {
  GPT3TextEmbeddingAda002 = 'text-embedding-ada-002',
}

/**
 * OpenAI: Models for for audio transcription
 * @export
 */
export enum OpenAIAudioModel {
  Whisper1 = 'whisper-1',
}

/**
 * OpenAI: Model information
 * @export
 */
export const openAIModelInfo: TextModelInfo[] = [
  {
    name: OpenAIGenerateModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1K: 0.03,
    completionTokenCostPer1K: 0.06,
    maxTokens: 8192,
  },
  {
    name: OpenAIGenerateModel.GPT432K,
    currency: 'usd',
    promptTokenCostPer1K: 0.06,
    completionTokenCostPer1K: 0.12,
    maxTokens: 32768,
  },
  {
    name: OpenAIGenerateModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1K: 0.002,
    completionTokenCostPer1K: 0.002,
    maxTokens: 4096,
  },
  {
    name: OpenAIGenerateModel.GPT35Turbo16K,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.004,
    maxTokens: 16384,
  },
  {
    name: OpenAIGenerateModel.GPT35TextDavinci003,
    currency: 'usd',
    promptTokenCostPer1K: 0.02,
    completionTokenCostPer1K: 0.02,
    maxTokens: 4097,
  },
  {
    name: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 8191,
  },
];

/**
 * OpenAI: Model options for text generation
 * @export
 */
export type OpenAIOptions = Omit<GenerateTextModelConfig, 'topK'> & {
  model: OpenAIGenerateModel;
  embedModel: OpenAIEmbedModels;
  audioModel: OpenAIAudioModel;
  user?: string;
};

/**
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultOptions = (): OpenAIOptions => ({
  model: OpenAIGenerateModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  audioModel: OpenAIAudioModel.Whisper1,
  suffix: null,
  maxTokens: 2500,
  temperature: 0.1,
  topP: 0.9,
  frequencyPenalty: 0.5,
  logitBias: new Map([
    ['90', 70],
    ['1298', 70],
  ]),
});

/**
 * OpenAI: Default model options to use the more advanced model
 * @export
 */
export const OpenAIBestModelOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT4,
});

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT35Turbo,
  temperature: 0.9,
  logitBias: undefined,
});

/**
 * OpenAI: Default model options for more fast text generation
 * @export
 */
export const OpenAIFastOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT35Turbo,
  temperature: 0.45,
});

type OpenAIGenerateRequest = {
  model: string;
  prompt: string;
  suffix: string | null;
  max_tokens: number;
  temperature: number;
  top_p: number;
  n?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  stop?: readonly string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  logit_bias?: Map<string, number>;
  user?: string;
};

type OpenAILogprob = {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Map<string, number>;
  text_offset: number[];
};

type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type OpenAIGenerateTextResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    text: string;
    index: number;
    finish_reason: string;
    log_probs: OpenAILogprob;
  }[];
  usage: OpenAIUsage;
};

type OpenAIChatGenerateRequest = {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  n?: number;
  stream?: boolean;
  stop?: readonly string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Map<string, number>;
  user?: string;
};

type OpenAIChatGenerateResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: OpenAIUsage;
};

type OpenAIEmbedRequest = {
  input: readonly string[];
  model: string;
  user?: string;
};

type OpenAIEmbedResponse = {
  model: string;
  data: {
    embedding: number[];
    index: number;
  }[];
  usage: OpenAIUsage;
};

type OpenAIAudioRequest = {
  model: string;
  prompt?: string;
  response_format: 'verbose_json';
  temperature?: number;
  language?: string;
};

type OpenAIAudioResponse = {
  duration: number;
  segments: {
    id: number;
    start: number;
    end: number;
    text: string;
  }[];
};

const generateReq = (
  prompt: string,
  opt: Readonly<OpenAIOptions>,
  stopSequences: readonly string[]
): OpenAIGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'OpenAI supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    model: opt.model,
    prompt,
    suffix: opt.suffix ?? null,
    max_tokens: opt.maxTokens,
    temperature: opt.temperature,
    top_p: opt.topP ?? 1,
    n: opt.n,
    stream: opt.stream,
    logprobs: opt.logprobs,
    echo: opt.echo,
    stop: stopSequences,
    presence_penalty: opt.presencePenalty,
    frequency_penalty: opt.frequencyPenalty,
    best_of: opt.bestOf,
    logit_bias: opt.logitBias,
    user: opt.user,
  };
};

const generateChatReq = (
  prompt: string,
  opt: Readonly<OpenAIOptions>,
  stopSequences: readonly string[]
): OpenAIChatGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'OpenAI supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    model: opt.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: opt.maxTokens,
    temperature: opt.temperature,
    top_p: opt.topP ?? 1,
    n: opt.n,
    stream: opt.stream,
    stop: stopSequences,
    presence_penalty: opt.presencePenalty,
    frequency_penalty: opt.frequencyPenalty,
    logit_bias: opt.logitBias,
    user: opt.user,
  };
};

const generateAudioReq = (
  opt: Readonly<OpenAIOptions>,
  prompt?: string,
  language?: string
): OpenAIAudioRequest => ({
  model: opt.audioModel,
  prompt,
  temperature: opt.temperature,
  language,
  response_format: 'verbose_json',
});

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI extends BaseAI {
  private apiKey: string;
  private orgId?: string;
  private options: OpenAIOptions;

  constructor(
    apiKey: string,
    options: Readonly<OpenAIOptions> = OpenAIDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'OpenAI',
      openAIModelInfo,
      { model: options.model, embedModel: options.embedModel },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('OpenAPI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  override getModelConfig(): GenerateTextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      n: options.n,
      stream: options.stream,
      logprobs: options.logprobs,
      echo: options.echo,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      bestOf: options.bestOf,
      logitBias: options.logitBias,
    } as GenerateTextModelConfig;
  }

  override async _generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    return [
      OpenAIGenerateModel.GPT35Turbo,
      OpenAIGenerateModel.GPT35Turbo16K,
      OpenAIGenerateModel.GPT4,
    ].includes(this.options.model as OpenAIGenerateModel)
      ? await this._generateChat(prompt, md, sessionId)
      : await this._generateDefault(prompt, md, sessionId);
  }

  private async _generateDefault(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      OpenAIAPI,
      OpenAIGenerateRequest,
      OpenAIGenerateTextResponse
    >(
      this.createAPI(apiType.Generate),
      generateReq(prompt, this.options, md.stopSequences)
    );

    const { id, choices: c, usage: u } = res;
    return {
      remoteId: id.toString(),
      sessionId,
      results: c.map((v) => ({
        id: v.index.toString(),
        text: v.text,
        finishReason: v.finish_reason,
      })),
      modelUsage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    };
  }

  private async _generateChat(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      OpenAIAPI,
      OpenAIChatGenerateRequest,
      OpenAIChatGenerateResponse
    >(
      this.createAPI(apiType.ChatGenerate),
      generateChatReq(prompt, this.options, md.stopSequences)
    );

    const { id, choices: c, usage: u } = res;
    return {
      remoteId: id.toString(),
      sessionId,
      results: c.map((v) => ({
        id: v.index.toString(),
        text: v.message.content,
        finishReason: v.finish_reason,
      })),
      modelUsage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    };
  }

  async _embed(
    textToEmbed: readonly string[] | string,
    sessionId?: string
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = await apiCall<
      OpenAIAPI,
      OpenAIEmbedRequest,
      OpenAIEmbedResponse
    >(this.createAPI(apiType.Embed), embedReq);

    const { data, usage: u } = res;
    return {
      sessionId,
      texts,
      embedding: data.at(0)?.embedding || [],
      modelUsage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    };
  }

  async _transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionId?: string
  ): Promise<TranscriptResponse> {
    const res = await apiCallWithUpload<
      OpenAIAPI,
      OpenAIAudioRequest,
      OpenAIAudioResponse
    >(
      this.createAPI(apiType.Transcribe),
      generateAudioReq(this.options, prompt, language),
      file
    );

    const { duration, segments } = res;
    return {
      sessionId,
      duration,
      segments: segments.map((v) => ({
        id: v.id,
        start: v.start,
        end: v.end,
        text: v.text,
      })),
    };
  }

  private createAPI(name: apiType): OpenAIAPI {
    return {
      url: apiURL,
      key: this.apiKey,
      name,
      headers: {
        ...(this.orgId ? { 'OpenAI-Organization': this.orgId } : null),
      },
    };
  }
}
