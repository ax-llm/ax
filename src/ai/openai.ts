import {
  AIService,
  AIGenerateTextResponse,
  EmbedResponse,
  AudioResponse,
  PromptConfig,
} from '../text/index.js';

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
  GPT4 = 'gpt-4',
  GPT432K = 'gpt-4-32k',
  GPT3Turbo = 'gpt-3.5-turbo',
  GPT3TextDavinci003 = 'text-davinci-003',
}

/**
 * OpenAI: Models for code generation
 * @export
 */
export enum OpenAIGenerateCodeModel {
  CodexCodeDavinci002 = 'code-davinci-002',
  CodexCodeCushman001 = 'code-cushman-001',
  CodexCodeDavinci001 = 'code-davinci-001',
}

/**
 * OpenAI: Models for use in embeddings
 * @export
 */
export enum OpenAIEmbedModels {
  GPT3TextEmbeddingAda002 = 'text-embedding-ada-002',
  GPT3TextSimilarityDavinci001 = 'text-similarity-davinci-001',
}

/**
 * OpenAI: Models for for audio transcription
 * @export
 */
export enum OpenAIAudioModel {
  Whisper1 = 'whisper-1',
}

/**
 * OpenAI: Model options for text generation
 * @export
 */
export type OpenAIOptions = {
  model: OpenAIGenerateModel;
  embedModel: OpenAIEmbedModels;
  audioModel: OpenAIAudioModel;
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
export const OpenAIDefaultOptions = (): OpenAIOptions => ({
  model: OpenAIGenerateModel.GPT3Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  audioModel: OpenAIAudioModel.Whisper1,
  suffix: null,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
});

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT3Turbo,
  temperature: 0.9,
});

/**
 * OpenAI: Default model options for more fast text generation
 * @export
 */
export const OpenAIFastOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIGenerateModel.GPT3Turbo,
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
  stop?: string[];
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
  stop?: string[];
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
  stopSequences: string[]
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

const generateChatReq = (
  prompt: string,
  opt: Readonly<OpenAIOptions>,
  stopSequences: string[]
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
): OpenAIAudioRequest => {
  return {
    model: opt.audioModel,
    prompt: prompt,
    temperature: opt.temperature,
    language: language,
    response_format: 'verbose_json',
  };
};

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI implements AIService {
  private apiKey: string;
  private orgID?: string;
  private options: OpenAIOptions;

  constructor(
    apiKey: string,
    options: Readonly<OpenAIOptions> = OpenAIDefaultOptions()
  ) {
    if (apiKey === '') {
      throw new Error('OpenAPI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  name(): string {
    return 'OpenAI';
  }

  generate(
    prompt: string,
    md: PromptConfig,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    prompt = prompt.trim();
    if (
      [OpenAIGenerateModel.GPT3Turbo, OpenAIGenerateModel.GPT4].includes(
        this.options.model as OpenAIGenerateModel
      )
    ) {
      return this.generateChat(prompt, md, sessionID);
    } else {
      return this.generateDefault(prompt, md, sessionID);
    }
  }

  private generateDefault(
    prompt: string,
    md: PromptConfig,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const res = apiCall<
      OpenAIAPI,
      OpenAIGenerateRequest,
      OpenAIGenerateTextResponse
    >(
      this.createAPI(apiType.Generate),
      generateReq(prompt, this.options, md.stopSequences)
    );

    return res.then(({ id, choices: c, usage: u }) => ({
      id: id.toString(),
      sessionID: sessionID,
      query: prompt,
      values: c.map((v) => ({ id: v.index.toString(), text: v.text })),
      usage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
      value() {
        return (this as any).values[0].text;
      },
    }));
  }

  private generateChat(
    prompt: string,
    md: PromptConfig,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const res = apiCall<
      OpenAIAPI,
      OpenAIChatGenerateRequest,
      OpenAIChatGenerateResponse
    >(
      this.createAPI(apiType.ChatGenerate),
      generateChatReq(prompt, this.options, md.stopSequences)
    );

    return res.then(({ id, choices: c, usage: u }) => ({
      id: id.toString(),
      sessionID: sessionID,
      query: prompt,
      values: c.map((v) => ({
        id: v.index.toString(),
        text: v.message.content,
      })),
      usage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
      value() {
        return (this as any).values[0].text;
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

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = apiCall<OpenAIAPI, OpenAIEmbedRequest, OpenAIEmbedResponse>(
      this.createAPI(apiType.Embed),
      embedReq
    );

    return res.then(({ model, data, usage: u }) => ({
      id: '',
      sessionID,
      texts,
      model,
      embeddings: data.embeddings,
      usage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    }));
  }

  transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionID?: string
  ): Promise<AudioResponse> {
    const res = apiCallWithUpload<
      OpenAIAPI,
      OpenAIAudioRequest,
      OpenAIAudioResponse
    >(
      this.createAPI(apiType.Transcribe),
      generateAudioReq(this.options, prompt, language),
      file
    );

    return res.then((data) => ({
      duration: data.duration,
      segments: data.segments.map((v) => ({
        id: v.id,
        start: v.start,
        end: v.end,
        text: v.text,
      })),
      sessionID,
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
