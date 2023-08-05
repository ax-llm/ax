import {
  AIPromptConfig,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
} from '../text/types.js';

import { BaseAI } from './base.js';
import {
  OpenAIEmbedModels,
  OpenAIGenerateModel,
  openAIModelInfo,
} from './openai.js';
import { API, apiCall } from './util.js';

/**
 * AzureOpenAI: API types
 * @export
 */

const enum apiType {
  Generate = 'completions',
  ChatGenerate = 'chat/completions',
  Embed = 'embeddings',
}

/**
 * AzureOpenAI: API call details
 * @export
 */
export type AzureOpenAIAPI = API & {
  headers: { 'api-key'?: string };
};

/**
 * AzureOpenAI: Model options for text generation
 * @export
 */
export type AzureOpenAIOptions = Omit<GenerateTextModelConfig, 'topK'> & {
  model: OpenAIGenerateModel;
  embedModel: OpenAIEmbedModels;
  user?: string;
};

/**
 * AzureOpenAI: Default Model options for text generation
 * @export
 */
export const AzureOpenAIDefaultOptions = (): AzureOpenAIOptions => ({
  model: OpenAIGenerateModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
});

/**
 * AzureOpenAI: Default model options for more creative text generation
 * @export
 */
export const AzureOpenAICreativeOptions = (): AzureOpenAIOptions => ({
  ...AzureOpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT35Turbo,
  temperature: 0.9,
});

/**
 * AzureOpenAI: Default model options for more fast text generation
 * @export
 */
export const AzureOpenAIFastOptions = (): AzureOpenAIOptions => ({
  ...AzureOpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT35Turbo,
  temperature: 0.45,
});

type AzureOpenAIGenerateRequest = {
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

type AzureOpenAILogprob = {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Map<string, number>;
  text_offset: number[];
};

type AzureOpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type AzureOpenAIGenerateTextResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    text: string;
    index: number;
    finish_reason: string;
    log_probs: AzureOpenAILogprob;
  }[];
  usage: AzureOpenAIUsage;
};

type AzureOpenAIChatGenerateRequest = {
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

type AzureOpenAIChatGenerateResponse = {
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
  usage: AzureOpenAIUsage;
};

type AzureOpenAIEmbedRequest = {
  input: readonly string[];
  model: string;
  user?: string;
};

type AzureOpenAIEmbedResponse = {
  model: string;
  data: {
    embedding: number[];
    index: number;
  };
  usage: AzureOpenAIUsage;
};

const generateReq = (
  prompt: string,
  opt: Readonly<AzureOpenAIOptions>,
  stopSequences: readonly string[]
): AzureOpenAIGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'AzureOpenAI supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    model: opt.model.replace('.', ''),
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
  opt: Readonly<AzureOpenAIOptions>,
  stopSequences: readonly string[]
): AzureOpenAIChatGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'AzureOpenAI supports prompts with max 4 items in stopSequences'
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

/**
 * AzureOpenAI: AI Service
 * @export
 */
export class AzureOpenAI extends BaseAI {
  private apiKey: string;
  private apiURL: string;
  private options: AzureOpenAIOptions;

  constructor(
    apiKey: string,
    host: string,
    deploymentName: string,
    options: Readonly<AzureOpenAIOptions> = AzureOpenAIDefaultOptions()
  ) {
    super('Azure OpenAI', openAIModelInfo, {
      model: options.model,
      embedModel: options.embedModel,
    });

    if (apiKey === '') {
      throw new Error('Azure OpenAPI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;

    if (!host.includes('://')) {
      host = `https://${host}.openai.azure.com/`;
    }
    this.apiURL = new URL(`/openai/deployments/${deploymentName}`, host).href;
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
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    if (
      [OpenAIGenerateModel.GPT35Turbo, OpenAIGenerateModel.GPT4].includes(
        this.options.model as OpenAIGenerateModel
      )
    ) {
      return await this.generateChat(prompt, md, sessionId);
    }
    return await this.generateDefault(prompt, md, sessionId);
  }

  private async generateDefault(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      AzureOpenAIAPI,
      AzureOpenAIGenerateRequest,
      AzureOpenAIGenerateTextResponse
    >(
      this.createAPI(apiType.Generate),
      generateReq(prompt, this.options, md.stopSequences)
    );

    const { id, choices: c, usage: u } = res;
    return {
      sessionId,
      remoteId: id.toString(),
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
    sessionId?: string
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      AzureOpenAIAPI,
      AzureOpenAIChatGenerateRequest,
      AzureOpenAIChatGenerateResponse
    >(
      this.createAPI(apiType.ChatGenerate),
      generateChatReq(prompt, this.options, md.stopSequences)
    );

    const { id, choices: c, usage: u } = res;
    return {
      sessionId,
      remoteId: id.toString(),
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
    textToEmbed: Readonly<string[] | string>,
    sessionId?: string
  ): Promise<EmbedResponse> {
    const texts: readonly string[] =
      typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = await apiCall<
      AzureOpenAIAPI,
      AzureOpenAIEmbedRequest,
      AzureOpenAIEmbedResponse
    >(this.createAPI(apiType.Embed), embedReq);

    const { data, usage: u } = res;
    return {
      sessionId,
      texts,
      embedding: data.embedding,
      modelUsage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    };
  }

  private createAPI(name: apiType): AzureOpenAIAPI {
    return {
      url: this.apiURL,
      name,
      headers: {
        'api-key': this.apiKey,
      },
    };
  }
}
