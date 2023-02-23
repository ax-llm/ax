import axios, { AxiosResponse } from 'axios';
import { AIService, GenerateResponse, PromptMetadata } from '../text';

const enum OpenAIAPI {
  Generate = 'completions',
}

/**
 * OpenAI: Models for text generation
 * @export
 */
export const enum OpenAIGenerateModels {
  GPT3TextDavinci003 = 'text-davinci-003',
  GPT3TextDavinci002 = 'text-davinci-002',
  GPT3TextCurie001 = 'text-curie-001',
  GPT3TextBabbage001 = 'text-babbage-001',
  GPT3TextAda001 = 'text-ada-001',
  GPT3TextDavinci001 = 'text-davinci-001',
  GPT3DavinciInstructBeta = 'davinci-instruct-beta',
  GPT3Davinci = 'davinci',
  GPT3CurieInstructBeta = 'curie-instruct-beta',
  GPT3Curie = 'curie',
  GPT3Ada = 'ada',
  GPT3Babbage = 'babbage',
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
 * OpenAI: Model options for text generation
 * @export
 */
export type OpenAIGenerateOptions = {
  model: OpenAIGenerateModels | OpenAIGenerateCodeModels | string;
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

  generate(prompt: string, md?: PromptMetadata): Promise<GenerateResponse> {
    const text = prompt.trim();
    const stopSeq = md?.stopSequences || [];
    const opts = this.generateOptions;

    const res = this.apiCall(
      OpenAIAPI.Generate,
      generateData(text, stopSeq, opts)
    );

    return res.then(({ data }) => ({
      id: data.id.toString(),
      query: prompt,
      value: data.choices[0].text.trim(),
      values:
        data.choices.length > 1
          ? data.choices.map((v) => ({ id: v.index.toString(), text: v.text }))
          : [],
    }));
  }

  /** @ignore */
  private apiCall(
    api: OpenAIAPI,
    data: OpenAIGenerateRequest
  ): Promise<AxiosResponse<OpenAIGenerateResponse, any>> {
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
