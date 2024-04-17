import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoOpenAI } from './info.js';
import {
  OpenAIAudioModel,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
  type OpenAIChatResponseDelta,
  type OpenAICompletionRequest,
  type OpenAICompletionResponse,
  type OpenAICompletionResponseDelta,
  type OpenAIConfig,
  OpenAIEmbedModels,
  type OpenAIEmbedRequest,
  type OpenAIEmbedResponse,
  OpenAIModel
} from './types.js';

/**
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultConfig = (): OpenAIConfig => ({
  model: OpenAIModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.TextEmbeddingAda002,
  audioModel: OpenAIAudioModel.Whisper1,
  stream: false,
  suffix: null,
  maxTokens: 500,
  temperature: 0.0,
  topP: 0.0,
  frequencyPenalty: 0.5,
  stop: ['---']
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
  model: OpenAIModel.GPT35Turbo
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
    super({
      name: 'OpenAI',
      apiURL: apiURL ? apiURL : 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoOpenAI,
      models: { model: config.model, embedModel: config.embedModel },
      options,
      supportFor: { functions: true }
    });
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
      logitBias: config.logitBias,
      stop: config.stop
    };
  }

  generateChatReq = (
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, OpenAIChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: '/chat/completions',
      headers: {
        ...(req.identity?.organization
          ? { 'OpenAI-Organization': req.identity?.organization }
          : null)
      }
    };

    const tools = req.functions?.map((v) => ({
      type: 'function' as const,
      function: {
        name: v.name,
        description: v.description,
        parameters: v.parameters
      }
    }));

    const toolsChoice =
      !req.functionCall && req.functions && req.functions.length > 0
        ? 'auto'
        : req.functionCall;

    const messages = req.chatPrompt.map((v) => {
      switch (v.role) {
        case 'system':
          return { role: 'system' as const, content: v.content };
        case 'user':
          return { role: 'user' as const, content: v.content, name: v.name };
        case 'assistant':
          return {
            role: 'assistant' as const,
            content: v.content,
            name: v.name,
            tool_calls: v.functionCalls
          };
        case 'function':
          return {
            role: 'tool' as const,
            content: v.content,
            tool_call_id: v.functionId
          };
        default:
          throw new Error('Invalid role');
      }
    });

    const frequencyPenalty =
      req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty;

    const reqValue: OpenAIChatRequest = {
      model,
      messages,
      response_format: this.config.responseFormat
        ? { type: this.config.responseFormat }
        : undefined,
      tools,
      tool_choice: toolsChoice,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens ?? 500,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP ?? 1,
      n: req.modelConfig?.n ?? this.config.n,
      stream: req.modelConfig?.stream ?? this.config.stream,
      stop: config.stopSequences ?? req.modelConfig?.stop ?? this.config.stop,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      logit_bias: req.modelConfig?.logitBias ?? this.config.logitBias,
      user: req.identity?.user ?? this.config.user,
      organization: req.identity?.organization,
      ...(frequencyPenalty ? { frequency_penalty: frequencyPenalty } : {})
    };
    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, OpenAIEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

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
      content: choice.text,
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
        ({ delta: { content = '' }, finish_reason: finishReason }) => ({
          content,
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

    const results = choices.map((choice) => ({
      id: `${choice.index}`,
      content: choice.message.content,
      role: choice.message.role,
      finishReason: choice.finish_reason,
      functionCalls: choice.message.tool_calls
    }));

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
          delta: { content, role, tool_calls },
          finish_reason: finishReason
        }) => ({
          content,
          role: role,
          functionCalls: tool_calls,
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
