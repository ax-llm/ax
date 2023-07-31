import {
  AIPromptConfig,
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
    id: OpenAIGenerateModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1K: 0.03,
    completionTokenCostPer1K: 0.06,
    maxTokens: 8192,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT432K,
    currency: 'usd',
    promptTokenCostPer1K: 0.06,
    completionTokenCostPer1K: 0.12,
    maxTokens: 32768,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1K: 0.002,
    completionTokenCostPer1K: 0.002,
    maxTokens: 4096,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT35Turbo16K,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.004,
    maxTokens: 16384,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT35TextDavinci003,
    currency: 'usd',
    promptTokenCostPer1K: 0.02,
    completionTokenCostPer1K: 0.02,
    maxTokens: 4097,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT35TextDavinci002,
    currency: 'usd',
    promptTokenCostPer1K: 0.02,
    completionTokenCostPer1K: 0.02,
    maxTokens: 4097,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT35CodeDavinci002,
    currency: 'usd',
    promptTokenCostPer1K: 0.1,
    completionTokenCostPer1K: 0.1,
    maxTokens: 8001,
    oneTPM: 1,
  },
  {
    id: OpenAIGenerateModel.GPT3TextCurie001,
    currency: 'usd',
    promptTokenCostPer1K: 0.002,
    completionTokenCostPer1K: 0.002,
    maxTokens: 2049,
    oneTPM: 25,
  },
  {
    id: OpenAIGenerateModel.GPT3TextBabbage001,
    currency: 'usd',
    promptTokenCostPer1K: 0.0005,
    completionTokenCostPer1K: 0.0005,
    maxTokens: 2049,
    oneTPM: 100,
  },
  {
    id: OpenAIGenerateModel.GPT3TextAda001,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 2049,
    oneTPM: 200,
  },
  {
    id: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 8191,
    oneTPM: 200,
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
    suffix: opt.suffix,
    max_tokens: opt.maxTokens,
    temperature: opt.temperature,
    top_p: opt.topP,
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
    top_p: opt.topP,
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
  private orgID?: string;
  private options: OpenAIOptions;

  constructor(
    apiKey: string,
    options: Readonly<OpenAIOptions> = OpenAIDefaultOptions()
  ) {
    super('OpenAI', openAIModelInfo, {
      model: options.model,
      embedModel: options.embedModel,
    });

    if (apiKey === '') {
      throw new Error('OpenAPI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): GenerateTextModelConfig {
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

  async generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse> {
    return [
      OpenAIGenerateModel.GPT35Turbo,
      OpenAIGenerateModel.GPT35Turbo16K,
      OpenAIGenerateModel.GPT4,
    ].includes(this.options.model as OpenAIGenerateModel)
      ? await this.generateChat(prompt, md, sessionID)
      : await this.generateDefault(prompt, md, sessionID);
  }

  private async generateDefault(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
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
      remoteID: id.toString(),
      sessionID,
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

  private async generateChat(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
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
      remoteID: id.toString(),
      sessionID,
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

  async embed(
    textToEmbed: readonly string[] | string,
    sessionID?: string
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    if (texts.length > 96) {
      throw { message: 'OpenAI limits embeddings input to 96 strings' };
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw { message: 'OpenAI limits embeddings input to 512 characters' };
    }

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = await apiCall<
      OpenAIAPI,
      OpenAIEmbedRequest,
      OpenAIEmbedResponse
    >(this.createAPI(apiType.Embed), embedReq);

    const { data, usage: u } = res;
    return {
      sessionID,
      texts,
      embedding: data.at(0)?.embedding || [],
      modelUsage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    };
  }

  async transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionID?: string
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
      sessionID,
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
        ...(this.orgID ? { 'OpenAI-Organization': this.orgID } : null),
      },
    };
  }
}
