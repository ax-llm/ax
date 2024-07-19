// api.ts

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
  AxAIOllamaChatError,
  AxAIOllamaChatRequest,
  AxAIOllamaChatResponse,
  AxAIOllamaChatResponseDelta,
  AxAIOllamaConfig,
  AxAIOllamaEmbedModel,
  AxAIOllamaEmbedRequest,
  AxAIOllamaEmbedResponse,
  AxAIOllamaModel
} from './types.js';

export const axAIOllamaDefaultConfig = (): AxAIOllamaConfig => ({
  model: AxAIOllamaModel.Codellama,
  embedModel: AxAIOllamaEmbedModel.Codellama,
  ...axBaseAIDefaultConfig()
});

export const axAIOllamaDefaultCreativeConfig = (): AxAIOllamaConfig => ({
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
    };
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
    state: Readonly<{ fullContent: string; partialChunk: string }>
  ): AxChatResponse => {
    let processedResp = resp;

    // Handle potential malformed JSON
    if (typeof resp === 'string') {
      try {
        processedResp = JSON.parse(
          state.partialChunk + resp
        ) as AxAIOllamaChatResponseDelta;
        state.partialChunk = '';
      } catch (e) {
        // If parsing fails, it might be an incomplete chunk
        state.partialChunk += resp;
        return { results: [] }; // Return empty result for incomplete chunks
      }
    }

    // Process different event types
    switch (processedResp.type) {
      case 'message_start':
        // Handle message start
        break;
      case 'content_block_start':
        // Handle content block start
        break;
      case 'content_block_delta':
        // Handle content block delta
        state.fullContent += processedResp.delta.text;
        break;
      case 'message_delta':
        // Handle message delta
        if (processedResp.delta.done) {
          return {
            results: [
              {
                content: state.fullContent,
                finishReason: processedResp.delta.done_reason || 'stop'
              }
            ],
            modelUsage: processedResp.delta.total_duration
              ? {
                  totalTokens:
                    (processedResp.delta.prompt_eval_count ?? 0) +
                    (processedResp.delta.eval_count ?? 0),
                  promptTokens: processedResp.delta.prompt_eval_count ?? 0,
                  completionTokens: processedResp.delta.eval_count ?? 0
                }
              : undefined
          };
        }
        break;
    }

    return {
      results: [
        {
          content: state.fullContent
        }
      ]
    };
  };

  override generateEmbedReq = (
    req: Readonly<AxInternalEmbedRequest>
  ): [API, AxAIOllamaEmbedRequest] => {
    const embedModel = req.embedModel;

    if (!embedModel) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig: API = {
      name: '/embeddings'
    };

    const reqBody: AxAIOllamaEmbedRequest = {
      model: embedModel,
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
