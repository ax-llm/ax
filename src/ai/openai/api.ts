import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import {
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import {
  EmbedResponse,
  TextModelConfig,
  TextResponse,
  TextResponseResult
} from '../types.js';

import { modelInfoOpenAI } from './info.js';
import {
  OpenAIAudioModel,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatResponseDelta,
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAICompletionResponseDelta,
  OpenAIConfig,
  OpenAIEmbedModels,
  OpenAIEmbedRequest,
  OpenAIEmbedResponse,
  OpenAIModel
} from './types.js';

/**
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultConfig = (): OpenAIConfig => ({
  model: OpenAIModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  audioModel: OpenAIAudioModel.Whisper1,
  stream: false,
  suffix: null,
  maxTokens: 500,
  temperature: 0.1,
  topP: 0.9,
  frequencyPenalty: 0.5
});

/**
 * OpenAI: Default model options to use the more advanced model
 * @export
 */
export const OpenAIBestConfig = (): OpenAIConfig => ({
  ...OpenAIDefaultConfig(),
  model: OpenAIModel.GPT4Turbo
});

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeConfig = (): OpenAIConfig => ({
  ...OpenAIDefaultConfig(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.9
});

/**
 * OpenAI: Default model options for more fast text generation
 * @export
 */
export const OpenAIFastConfig = (): OpenAIConfig => ({
  ...OpenAIDefaultConfig(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.45
});

export interface OpenAIArgs {
  apiKey: string;
  apiURL?: string;
  config?: Readonly<OpenAIConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI extends BaseAI<
  OpenAICompletionRequest,
  OpenAIChatRequest,
  OpenAIEmbedRequest,
  OpenAICompletionResponse,
  OpenAICompletionResponseDelta,
  OpenAIChatResponse,
  OpenAIChatResponseDelta,
  OpenAIEmbedResponse
> {
  private config: OpenAIConfig;

  constructor({
    apiKey,
    config = OpenAIDefaultConfig(),
    options,
    apiURL
  }: Readonly<OpenAIArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set');
    }
    super(
      'OpenAI',
      apiURL ? apiURL : 'https://api.openai.com/v1',
      { Authorization: `Bearer ${apiKey}` },
      modelInfoOpenAI,
      { model: config.model, embedModel: config.embedModel },
      options
    );
    this.config = config;
  }

  getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      n: config.n,
      stream: config.stream,
      logprobs: config.logprobs,
      echo: config.echo,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      bestOf: config.bestOf,
      logitBias: config.logitBias
    };
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, OpenAICompletionRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    const prompt = `${req.systemPrompt || ''} ${req.prompt || ''}`.trim();

    const apiConfig = {
      name: '/completions',
      headers: {
        ...(req.identity?.organization
          ? { 'OpenAI-Organization': req.identity?.organization }
          : null)
      }
    };

    const reqValue = {
      model,
      prompt,
      function_call: req.functionCall as
        | 'none'
        | 'auto'
        | { name: string }
        | undefined,
      functions: req.functions,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP ?? 1,
      suffix: req.modelConfig?.suffix ?? this.config.suffix ?? null,
      n: req.modelConfig?.n ?? this.config.n,
      stream: req.modelConfig?.stream ?? this.config.stream,
      logprobs: req.modelConfig?.logprobs ?? this.config.logprobs,
      echo: req.modelConfig?.echo ?? this.config.echo,
      stop: this.config.stop ?? config.stopSequences,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      best_of: req.modelConfig?.bestOf ?? this.config.bestOf,
      logit_bias: req.modelConfig?.logitBias ?? this.config.logitBias,
      user: req.identity?.user ?? this.config.user,
      organization: req.identity?.organization
    };

    return [apiConfig, reqValue];
  };

  generateChatReq = (
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, OpenAIChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: '/chat/completions?api-version=2023-03-15-preview',
      headers: {
        ...(req.identity?.organization
          ? { 'OpenAI-Organization': req.identity?.organization }
          : null)
      }
    };

    let functionCall = req.functionCall as
      | 'none'
      | 'auto'
      | { name: string }
      | undefined;

    if (
      !functionCall &&
      typeof functionCall === 'string' &&
      (functionCall as string).length === 0 &&
      req.functions &&
      req.functions.length > 0
    ) {
      functionCall = 'auto';
    }

    const reqValue = {
      model,
      response_format: this.config.responseFormat
        ? { type: this.config.responseFormat }
        : undefined,
      messages: req.chatPrompt.map(
        ({ role, text: content, name, functionCall: fc }) => ({
          role,
          content,
          name,
          function_call: fc
            ? { name: fc.name, arguments: fc.args ?? '' }
            : undefined
        })
      ),
      function_call: functionCall,
      functions: req.functions,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP ?? 1,
      n: req.modelConfig?.n ?? this.config.n,
      stream: req.modelConfig?.stream ?? this.config.stream,
      logprobs: req.modelConfig?.logprobs ?? this.config.logprobs,
      echo: req.modelConfig?.echo ?? this.config.echo,
      stop: config.stopSequences,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      best_of: req.modelConfig?.bestOf ?? this.config.bestOf,
      logit_bias: req.modelConfig?.logitBias ?? this.config.logitBias,
      user: req.identity?.user ?? this.config.user,
      organization: req.identity?.organization
    };

    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, OpenAIEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: '/embeddings',
      headers: {
        ...(req.identity?.organization
          ? { 'OpenAI-Organization': req.identity?.organization }
          : null)
      }
    };

    const reqValue = {
      model: model,
      input: req.texts
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<OpenAICompletionResponse>
  ): TextResponse => {
    const { id, usage, choices, error } = resp;

    if (error) {
      throw error;
    }

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    const results = choices.map((choice) => ({
      text: choice.text,
      finishReason: choice.finish_reason
    }));

    return {
      modelUsage,
      results,
      remoteId: id
    };
  };

  generateCompletionStreamResp = (
    resp: Readonly<OpenAICompletionResponseDelta>
  ): TextResponse => {
    const { id, usage, choices } = resp;

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    return {
      results: choices.map(
        ({ delta: { text = '' }, finish_reason: finishReason }) => ({
          text,
          finishReason,
          id
        })
      ),
      modelUsage
    };
  };

  generateChatResp = (resp: Readonly<OpenAIChatResponse>): TextResponse => {
    const { id, usage, choices, error } = resp;

    if (error) {
      throw error;
    }

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    const results = choices.map((choice) => {
      const value: TextResponseResult = {
        id: `${choice.index}`,
        text: choice.message.content,
        role: choice.message.role,
        finishReason: choice.finish_reason
      };

      if (choice.message.function_call) {
        value.functionCall = {
          name: choice.message.function_call.name,
          args: choice.message.function_call.arguments
        };
      }

      return value;
    });

    return {
      modelUsage,
      results,
      remoteId: id
    };
  };

  generateChatStreamResp = (
    resp: Readonly<OpenAIChatResponseDelta>
  ): TextResponse => {
    const { id, usage, choices } = resp;

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    return {
      results: choices.map(
        ({
          delta: { content, role, function_call: fc },
          finish_reason: finishReason
        }) => ({
          text: content ?? '',
          role: role,
          functionCall: fc
            ? { name: fc.name, args: fc.arguments ?? '' }
            : undefined,
          finishReason,
          id
        })
      ),
      modelUsage
    };
  };

  generateEmbedResp = (resp: Readonly<OpenAIEmbedResponse>): EmbedResponse => {
    const { data, usage } = resp;

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    return {
      embeddings: data.map((v) => v.embedding),
      modelUsage
    };
  };

  // async _transcribe(
  //   file: string,
  //   prompt?: string,
  //   options?: Readonly<AITranscribeConfig>
  // ): Promise<TranscriptResponse> {
  //   const res = await this.apiCallWithUpload<
  //     OpenAIAudioRequest,
  //     OpenAIAudioResponse,
  //     OpenAIApiConfig
  //   >(
  //     this.createAPI(OpenAIApi.Transcribe),
  //     generateAudioReq(this.options, prompt, options?.language),
  //     file
  //   );

  //   const { duration, segments } = res;
  //   return {
  //     duration,
  //     segments: segments.map((v) => ({
  //       id: v.id,
  //       start: v.start,
  //       end: v.end,
  //       text: v.text,
  //     })),
  //   };
  // }
}

// export const generateAudioReq = (
//   opt: Readonly<OpenAIConfig>,
//   prompt?: string,
//   language?: string
// ): OpenAIAudioRequest => {
//   if (!opt.audioModel) {
//     throw new Error('OpenAI audio model not set');
//   }

//   return {
//     model: opt.audioModel,
//     prompt,
//     temperature: opt.temperature,
//     language,
//     response_format: 'verbose_json',
//   };
// };
