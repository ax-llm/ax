import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextCompletionRequest
} from '../../tracing/types.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type {
  TextModelConfig,
  TextResponse,
  TextResponseResult
} from '../types.js';

import { modelInfoAnthropic } from './info.js';
import {
  AnthropicChatError,
  type AnthropicChatRequest,
  type AnthropicChatResponse,
  type AnthropicChatResponseDelta,
  type AnthropicCompletionRequest,
  type AnthropicCompletionResponse,
  type AnthropicConfig,
  AnthropicModel,
  type ContentBlockDeltaEvent,
  type ContentBlockStartEvent,
  type MessageDeltaEvent,
  type MessageStartEvent
} from './types.js';

/**
 * Anthropic: Default Model options for text generation
 * @export
 */
export const AnthropicDefaultConfig = (): AnthropicConfig => ({
  model: AnthropicModel.Claude3Haiku,
  maxTokens: 500,
  temperature: 0,
  topP: 1,
  stopSequences: ['---']
});

export interface AnthropicArgs {
  apiKey: string;
  config?: Readonly<AnthropicConfig>;
  options?: Readonly<AIServiceOptions>;
}

export class Anthropic extends BaseAI<
  AnthropicCompletionRequest,
  AnthropicChatRequest,
  unknown,
  AnthropicCompletionResponse,
  unknown,
  AnthropicChatResponse,
  AnthropicChatResponseDelta,
  unknown
> {
  private config: AnthropicConfig;

  constructor({
    apiKey,
    config = AnthropicDefaultConfig(),
    options
  }: Readonly<AnthropicArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Anthropic API key not set');
    }
    super({
      name: 'Together',
      apiURL: 'https://api.anthropic.com/v1',
      headers: {
        'Anthropic-Version': '2023-06-01',
        'x-api-key': apiKey
      },
      modelInfo: modelInfoAnthropic,
      models: { model: config.model as string },
      options,
      supportFor: { functions: false }
    });

    this.config = config;
  }

  getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,

    config: Readonly<AIPromptConfig>
  ): [API, AnthropicCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const prompt = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: '/complete'
    };

    const reqValue: AnthropicCompletionRequest = {
      model,
      prompt,
      max_tokens_to_sample: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      stop_sequences: this.config.stopSequences ?? config.stopSequences ?? [],
      stream: this.config.stream
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<AnthropicCompletionResponse>
  ): TextResponse => {
    return {
      results: [
        {
          content: resp.completion
        }
      ]
    };
  };

  generateChatReq = (
    req: Readonly<AITextChatRequest>
  ): [API, AnthropicChatRequest] => {
    const apiConfig = {
      name: '/messages'
    };

    const messages =
      req.chatPrompt?.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content ?? ''
      })) ?? [];

    const reqValue: AnthropicChatRequest = {
      model: req.modelInfo?.name ?? this.config.model,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      stop_sequences: this.config.stopSequences,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      ...(req.identity?.user
        ? {
            metadata: {
              user_id: req.identity?.user
            }
          }
        : {}),
      messages
    };

    return [apiConfig, reqValue];
  };

  generateChatResp = (
    response: Readonly<AnthropicChatResponse | AnthropicChatError>
  ): TextResponse => {
    const err = response as AnthropicChatError;
    if (err.type === 'error') {
      throw new Error(`Anthropic Chat API Error: ${err.error.message}`);
    }

    const resp = response as AnthropicChatResponse;
    const results = resp.content.map((msg) => ({
      content: msg.type === 'text' ? msg.text : '',
      role: resp.role,
      id: resp.id,
      finishReason: resp.stop_reason
    }));

    const modelUsage = {
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      totalTokens: resp.usage.input_tokens + resp.usage.output_tokens
    };

    return {
      results,
      modelUsage
    };
  };

  generateChatStreamResp = (
    resp: Readonly<AnthropicChatResponseDelta>
  ): TextResponse => {
    let results: TextResponseResult[] = [];
    let modelUsage;

    if ('message' in resp) {
      const { message } = resp as unknown as MessageStartEvent;
      results = [
        {
          content: '',
          role: message.role,
          id: message.id
        }
      ];
      modelUsage = {
        promptTokens: resp.usage?.input_tokens ?? 0,
        completionTokens: resp.usage?.output_tokens ?? 0,
        totalTokens:
          (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0)
      };
    }

    if ('content_block' in resp) {
      const { content_block: cb } = resp as unknown as ContentBlockStartEvent;
      results = [{ content: cb.text }];
    }

    if (
      'delta' in resp &&
      'text' in (resp as unknown as ContentBlockDeltaEvent).delta
    ) {
      const { delta: cb } = resp as unknown as ContentBlockDeltaEvent;
      results = [{ content: cb.text }];
    }

    if (
      'delta' in resp &&
      'stop_reason' in (resp as unknown as MessageDeltaEvent).delta
    ) {
      const { delta } = resp as unknown as MessageDeltaEvent;
      results = [{ content: '', finishReason: delta.stop_reason ?? '' }];
      modelUsage = {
        promptTokens: resp.usage?.input_tokens ?? 0,
        completionTokens: resp.usage?.output_tokens ?? 0,
        totalTokens:
          (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0)
      };
    }

    return {
      results,
      modelUsage
    };
  };
}
