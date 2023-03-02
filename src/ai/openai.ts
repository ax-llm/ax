import {
  AIService,
  AIGenerateResponse,
  EmbedResponse,
  PromptMetadata,
} from '../text';

import { API, apiCall } from './util';

type OpenAIAPI = API & {
  headers: { 'OpenAI-Organization'?: string };
};

const apiURL = 'https://api.openai.com/v1/';

const enum apiType {
  Generate = 'completions',
  Embed = 'embeddings',
}

/**
 * OpenAI: Models for text generation
 * @export
 */
export const enum OpenAIGenerateModel {
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
export const enum OpenAIGenerateCodeModel {
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
export type OpenAITextOptions = {
  model: OpenAIGenerateModel | OpenAIGenerateCodeModel | string;
  embedModel: OpenAIEmbedModels | string;
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
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultTextOptions = (): OpenAITextOptions => ({
  model: OpenAIGenerateModel.GPT3TextDavinci003,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  suffix: null,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
});

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeTextOptions = (): OpenAITextOptions => ({
  ...OpenAIDefaultTextOptions(),
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

const generateReq = (
  prompt: string,
  stopSequences: string[] = [],
  opt: Readonly<OpenAITextOptions>
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
  TextOptions?: OpenAITextOptions;
};

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI implements AIService {
  private apiKey: string;
  private orgID?: string;

  private TextOptions: OpenAITextOptions = OpenAIDefaultTextOptions();

  constructor(apiKey: string, options?: Readonly<OpenAIOptions>) {
    if (apiKey === '') {
      throw new Error('OpenAPI API key not set');
    }
    this.apiKey = apiKey;

    if (options?.TextOptions) {
      this.TextOptions = options.TextOptions;
    }
  }

  name(): string {
    return 'OpenAI';
  }

  generate(
    prompt: string,
    md?: PromptMetadata,
    sessionID?: string
  ): Promise<AIGenerateResponse> {
    prompt = prompt.trim();
    const res = apiCall<
      OpenAIAPI,
      OpenAIGenerateRequest,
      OpenAIGenerateResponse
    >(
      this.createAPI(apiType.Generate),
      generateReq(prompt, md?.stopSequences, this.TextOptions)
    );

    return res.then(({ id, choices: c }) => ({
      id: id.toString(),
      sessionID: sessionID,
      query: prompt,
      values: c.map((v) => ({ id: v.index.toString(), text: v.text })),
      value() {
        return this.values[0].text;
      },
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

    const embedReq = { input: texts, model: this.TextOptions.embedModel };
    const res = apiCall<OpenAIAPI, OpenAIEmbedRequest, OpenAIEmbedResponse>(
      this.createAPI(apiType.Embed),
      embedReq
    );

    return res.then((data) => ({
      id: '',
      sessionID,
      texts,
      model: data.model,
      embeddings: data.data.embeddings,
    }));
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
