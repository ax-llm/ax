import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  EmbedResponse,
} from '../text/types.js';

import { modelInfo, OpenAIEmbedModels, OpenAIGenerateModel } from './openai.js';
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
export type AzureOpenAIOptions = {
  model: OpenAIGenerateModel;
  embedModel: OpenAIEmbedModels;
  suffix: string | null;
  maxTokens: number;
  temperature: number;
  topP: number;
  n?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  presencePenalty?: number;
  frequencyPenalty?: number;
  bestOf?: number;
  logitBias?: Map<string, number>;
  user?: string;
};

/**
 * AzureOpenAI: Default Model options for text generation
 * @export
 */
export const AzureOpenAIDefaultOptions = (): AzureOpenAIOptions => ({
  model: OpenAIGenerateModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  suffix: null,
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

/**
 * AzureOpenAI: AI Service
 * @export
 */
export class AzureOpenAI implements AIService {
  private apiKey: string;
  private apiURL: string;
  private options: AzureOpenAIOptions;

  constructor(
    apiKey: string,
    host: string,
    deploymentName: string,
    options: Readonly<AzureOpenAIOptions> = AzureOpenAIDefaultOptions()
  ) {
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

  name(): string {
    return 'AzureOpenAI';
  }

  async generate(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    prompt = prompt.trim();
    if (
      [OpenAIGenerateModel.GPT35Turbo, OpenAIGenerateModel.GPT4].includes(
        this.options.model as OpenAIGenerateModel
      )
    ) {
      return await this.generateChat(prompt, md, sessionID);
    }
    return await this.generateDefault(prompt, md, sessionID);
  }

  private async generateDefault(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const model = modelInfo.find((v) => v.id === this.options.model);
    if (!model) {
      throw new Error(
        `AzureOpenAI model information not found: ${this.options.model}`
      );
    }

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
      id: id.toString(),
      sessionID,
      query: prompt,
      values: c.map((v) => ({ id: v.index.toString(), text: v.text })),
      usage: [
        {
          model,
          stats: {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          },
        },
      ],
      value() {
        return (this as { values: { text: string }[] }).values[0].text;
      },
    };
  }

  private async generateChat(
    prompt: string,
    md: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const model = modelInfo.find((v) => v.id === this.options.model);
    if (!model) {
      throw new Error(
        `AzureOpenAI model information not found: ${this.options.model}`
      );
    }

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
      id: id.toString(),
      sessionID,
      query: prompt,
      values: c.map((v) => ({
        id: v.index.toString(),
        text: v.message.content,
      })),
      usage: [
        {
          model,
          stats: {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          },
        },
      ],
      value() {
        return (this as { values: { text: string }[] }).values[0].text;
      },
    };
  }

  async embed(
    textToEmbed: Readonly<string[] | string>,
    sessionID?: string
  ): Promise<EmbedResponse> {
    const texts: readonly string[] =
      typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    if (texts.length > 96) {
      throw new Error('AzureOpenAI limits embeddings input to 96 strings');
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw new Error('AzureOpenAI limits embeddings input to 512 characters');
    }

    const model = modelInfo.find((v) => v.id === this.options.embedModel);
    if (!model) {
      throw new Error(
        `AzureOpenAI model information not found: ${this.options.embedModel}`
      );
    }

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = await apiCall<
      AzureOpenAIAPI,
      AzureOpenAIEmbedRequest,
      AzureOpenAIEmbedResponse
    >(this.createAPI(apiType.Embed), embedReq);

    const { data, usage: u } = res;
    return {
      id: '',
      sessionID,
      texts,
      embedding: data.embedding,
      usage: {
        model,
        stats: {
          promptTokens: u.prompt_tokens,
          completionTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        },
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
