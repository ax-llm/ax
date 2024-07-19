import type { API } from '../../util/apicall.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import type {
  AxAIServiceOptions,
  AxChatResponse,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig
} from '../types.js';

import { axModelInfoOllama } from './info.js';
import {
  type AxAIOllamaChatError,
  type AxAIOllamaChatRequest,
  type AxAIOllamaChatResponse,
  type AxAIOllamaChatResponseDelta,
  type AxAIOllamaConfig,
  AxAIOllamaEmbedModel,
  type AxAIOllamaEmbedRequest,
  type AxAIOllamaEmbedResponse,
  AxAIOllamaModel
} from './types.js';

// cspell:ignore Codellama
// cspell:ignore kstream

export const axAIOllamaDefaultConfig = (): AxAIOllamaConfig =>
  structuredClone({
    model: AxAIOllamaModel.Codellama,
    embedModel: AxAIOllamaEmbedModel.Codellama,
    ...axBaseAIDefaultConfig()
  });

export const axAIOllamaDefaultCreativeConfig = (): AxAIOllamaConfig =>
  structuredClone({
    model: AxAIOllamaModel.Codellama,
    embedModel: AxAIOllamaEmbedModel.Codellama,
    ...axBaseAIDefaultCreativeConfig()
  });

export interface AxAIOllamaArgs {
  name: 'ollama';
  url?: string;
  config?: Readonly<Partial<AxAIOllamaConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  modelMap?: Record<string, AxAIOllamaModel | AxAIOllamaEmbedModel | string>;
}

export class AxAIOllama extends AxBaseAI<
  AxAIOllamaChatRequest,
  AxAIOllamaEmbedRequest,
  AxAIOllamaChatResponse | AxAIOllamaChatError,
  AxAIOllamaChatResponseDelta,
  AxAIOllamaEmbedResponse
> {
  private config: AxAIOllamaConfig;

  constructor({
    url,
    config,
    options,
    modelMap
  }: Readonly<Omit<AxAIOllamaArgs, 'name'>>) {
    const _config = {
      ...axAIOllamaDefaultConfig(),
      ...config
    };
    super({
      name: 'Ollama',
      apiURL: new URL('/api', url || 'http://localhost:11434').href,
      headers: {},
      modelInfo: axModelInfoOllama,
      models: {
        model: _config.model,
        embedModel: _config.embedModel
      },
      options,
      supportFor: { functions: false, streaming: true },
      modelMap
    });

    this.config = _config;
  }

  override getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream ?? false,
      kstream: config.stream
    } as AxModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AxInternalChatRequest>
  ): [API, AxAIOllamaChatRequest] => {
    const model = req.model;

    const apiConfig: API = {
      name: '/chat'
    };

    const messages = req.chatPrompt.map((msg) => {
      if (msg.role === 'function') {
        return {
          role: msg.role,
          content: msg.result,
          name: msg.functionId
        };
      }
      return {
        role: msg.role,
        content:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content)
      };
    });

    const reqValue: AxAIOllamaChatRequest = {
      model,
      messages,
      stream: req.modelConfig?.stream ?? this.config.stream ?? false,
      options: {
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        top_p: req.modelConfig?.topP ?? this.config.topP,
        top_k: req.modelConfig?.topK ?? this.config.topK,
        num_predict: req.modelConfig?.maxTokens ?? this.config.maxTokens
      }
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxAIOllamaChatResponse | AxAIOllamaChatError>
  ): AxChatResponse => {
    if ('type' in resp && resp.type === 'error') {
      return {
        results: [
          {
            content: `Error: ${resp.error.message}`,
            finishReason: 'error'
          }
        ],
        modelUsage: undefined
      };
    }
    return {
      results: [
        {
          content: resp.message?.content || '',
          finishReason: resp.done_reason || 'stop'
        }
      ],
      modelUsage: resp.total_duration
        ? {
            totalTokens: (resp.prompt_eval_count ?? 0) + (resp.eval_count ?? 0),
            promptTokens: resp.prompt_eval_count ?? 0,
            completionTokens: resp.eval_count ?? 0
          }
        : undefined
    };
  };

  override generateChatStreamResp = (
    resp: Readonly<AxAIOllamaChatResponseDelta>,
    state: { fullContent: string }
  ): AxChatResponse => {
    const newContent =
      'message' in resp && resp.message?.content
        ? state.fullContent + resp.message.content
        : state.fullContent;

    if ('done' in resp && resp.done) {
      return {
        results: [
          {
            content: newContent,
            finishReason:
              'done_reason' in resp
                ? (resp.done_reason as AxChatResponse['results'][0]['finishReason'])
                : 'stop'
          }
        ],
        modelUsage:
          'total_duration' in resp && resp.total_duration
            ? {
                totalTokens:
                  (('prompt_eval_count' in resp ? resp.prompt_eval_count : 0) ??
                    0) + (('eval_count' in resp ? resp.eval_count : 0) ?? 0),
                promptTokens:
                  ('prompt_eval_count' in resp ? resp.prompt_eval_count : 0) ??
                  0,
                completionTokens:
                  ('eval_count' in resp ? resp.eval_count : 0) ?? 0
              }
            : undefined
      };
    }

    return {
      results: [
        {
          content:
            'message' in resp && resp.message?.content
              ? resp.message.content
              : ''
        }
      ]
    };
  };

  override generateEmbedReq = (
    req: Readonly<AxInternalEmbedRequest>
  ): [API, AxAIOllamaEmbedRequest] => {
    const reqBody: AxAIOllamaEmbedRequest = {
      model,
      prompt: Array.isArray(req.texts) ? req.texts.join(' ') : req.texts || ''
    };

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig: API = {
      name: '/embeddings'
    };

    const reqBody: AxAIOllamaEmbedRequest = {
      model,
      prompt: Array.isArray(req.texts) ? req.texts.join(' ') : req.texts
    };

    return [apiConfig, reqBody];
  };

  override generateEmbedResp = (
    resp: Readonly<AxAIOllamaEmbedResponse>
  ): AxEmbedResponse => {
    return {
      embeddings: [resp.embedding],
      modelUsage: {
        totalTokens: resp.token_count,
        promptTokens: resp.token_count,
        completionTokens: 0
      }
    };
  };
}
