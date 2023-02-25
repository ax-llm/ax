import axios, { AxiosResponse } from 'axios';
import {
  AIService,
  GenerateResponse,
  EmbedResponse,
  PromptMetadata,
} from '../text';

const enum OpenAIAPI {
  Generate = 'completions',
  Embed = 'embeddings',
}

/**
 * OpenAI: Models for text generation
 * @export
 */
export const enum OpenAIGenerateModels {
  GPT3TextDavinci003 = 'text-davinci-003',
  GPT3TextCurie001 = 'text-curie-001',
  GPT3TextBabbage001 = 'text-babbage-001',
  GPT3TextAda001 = 'text-ada-001',
  GPT3TextDavinci001 = 'text-davinci-001',
}

/**
 * OpenAI: Models for code generation
 * @export
 */
export const enum OpenAIGenerateCodeModels {
  CodexCodeDavinci002 = 'code-davinci-002',
  CodexCodeCushman001 = 'code-cushman-001',
  CodexCodeDavinci001 = 'code-davinci-001',
}

/**
 * OpenAI: Models for use in embeddings
 * @export
 */
export const enum OpenAIEmbedModels {
  GPT3TextEmbeddingAda002 = 'text-embedding-ada-002',
  GPT3TextSimilarityDavinci001 = 'text-similarity-davinci-001',
}

/**
 * OpenAI: Model options for text generation
 * @export
 */
export type OpenAIGenerateOptions = {
  model: OpenAIGenerateModels | OpenAIGenerateCodeModels | string;
  embedModel: OpenAIEmbedModels | string;
  suffix: string | null;
  maxTokens: number;
  temperature: number;
  topP: number;
  n: number;
  stream: boolean;
  logprobs?: number;
  echo: boolean;
  presencePenalty: number;
  frequencyPenalty: number;
  bestOf: number;
  logitBias?: Map<string, number>;
  user?: string;
};

/**
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultGenerateOptions = (): OpenAIGenerateOptions => ({
  model: OpenAIGenerateModels.GPT3TextDavinci003,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  suffix: null,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
  n: 1,
  stream: false,
  echo: false,
  presencePenalty: 0,
  frequencyPenalty: 0,
  bestOf: 1,
});

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeGenerateOptions = (): OpenAIGenerateOptions => ({
  ...OpenAIDefaultGenerateOptions(),
  temperature: 0.9,
});

type OpenAIGenerateRequest = {
  model: string;
  prompt: string;
  suffix: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  n: number;
  stream: boolean;
  logprobs: number;
  echo: boolean;
  stop: string[];
  presence_penalty: number;
  frequency_penalty: number;
  best_of: number;
  logit_bias?: Map<string, number>;
  user?: string;
};

type OpenAILogprob = {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Map<string, number>;
  text_offset: number[];
};

type OpenAICompletion = {
  text: string;
  index: number;
  finish_reason: string;
  log_probs: OpenAILogprob;
};

type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type OpenAIGenerateResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAICompletion[];
  usage: OpenAIUsage;
};

type OpenAIEmbedRequest = {
  input: string[];
  model: string;
  user?: string;
};

type OpenAIEmbedResponse = {
  model: string;
  data: {
    embeddings: number[];
    index: number;
  };
};

const generateData = (
  prompt: string,
  stopSequences: string[],
  opt: Readonly<OpenAIGenerateOptions>
): OpenAIGenerateRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'OpenAI supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    model: opt.model,
    prompt: prompt,
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

/**
 * OpenAI: Various options that can be set on the AI Service
 * @export
 */
export type OpenAIOptions = {
  generateOptions?: OpenAIGenerateOptions;
};

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI implements AIService {
  private apiKey: string;
  private orgID?: string;

  private generateOptions: OpenAIGenerateOptions =
    OpenAIDefaultGenerateOptions();

  constructor(apiKey: string, options?: Readonly<OpenAIOptions>) {
    if (apiKey === '') {
      throw new Error('OpenAPI API key not set');
    }
    this.apiKey = apiKey;

    if (options?.generateOptions) {
      this.generateOptions = options.generateOptions;
    }
  }

  name(): string {
    return 'OpenAI';
  }

  generate(
    prompt: string,
    md?: PromptMetadata,
    sessionID?: string
  ): Promise<GenerateResponse> {
    const text = prompt.trim();
    const stopSeq = md?.stopSequences || [];
    const opts = this.generateOptions;

    const res = this.apiCall<OpenAIGenerateRequest, OpenAIGenerateResponse>(
      OpenAIAPI.Generate,
      generateData(text, stopSeq, opts)
    );

    return res.then(({ data: { id, choices: c } }) => ({
      id: id.toString(),
      sessionID: sessionID,
      query: prompt,
      values: c.map((v) => ({ id: v.index.toString(), text: v.text })),
    }));
  }

  embed(texts: string[], sessionID?: string): Promise<EmbedResponse> {
    if (texts.length > 96) {
      throw new Error('OpenAI limits embeddings input to 96 strings');
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw new Error('OpenAI limits embeddings input to 512 characters');
    }

    const { embedModel } = this.generateOptions;
    const req = { input: texts, model: embedModel };
    const res = this.apiCall<OpenAIEmbedRequest, OpenAIEmbedResponse>(
      OpenAIAPI.Embed,
      req
    );

    return res.then(({ data }) => ({
      id: '',
      sessionID,
      texts,
      model: data.model,
      embeddings: data.data.embeddings,
    }));
  }

  /** @ignore */
  private apiCall<T1, T2>(
    api: OpenAIAPI,
    data: T1
  ): Promise<AxiosResponse<T2, any>> {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.orgID) {
      headers['OpenAI-Organization'] = this.orgID;
    }

    const options = {
      headers,
    };

    return axios.post(`https://api.openai.com/v1/${api}`, data, options);
  }
}
