import type { AIServiceOptions } from '../../text/types.js';
import type { AITextChatRequest } from '../../types/index.js';
import type { API } from '../../util/apicall.js';
import { BaseAI, BaseAIDefaultConfig } from '../base.js';
import type {
  TextModelConfig,
  TextResponse,
  TextResponseResult
} from '../types.js';

import { modelInfoAnthropic } from './info.js';
import {
  type AnthropicChatError,
  type AnthropicChatRequest,
  type AnthropicChatResponse,
  type AnthropicChatResponseDelta,
  type AnthropicConfig,
  type AnthropicContentBlockDeltaEvent,
  type AnthropicContentBlockStartEvent,
  type AnthropicMessageDeltaEvent,
  type AnthropicMessageStartEvent,
  AnthropicModel
} from './types.js';

/**
 * Anthropic: Default Model options for text generation
 * @export
 */
export const AnthropicDefaultConfig = (): AnthropicConfig =>
  structuredClone({
    model: AnthropicModel.Claude3Haiku,
    ...BaseAIDefaultConfig()
  });

export interface AnthropicArgs {
  apiKey: string;
  config?: Readonly<AnthropicConfig>;
  options?: Readonly<AIServiceOptions>;
}

export class Anthropic extends BaseAI<
  AnthropicChatRequest,
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
      name: 'Anthropic',
      apiURL: 'https://api.anthropic.com/v1',
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
        'x-api-key': apiKey
      },
      modelInfo: modelInfoAnthropic,
      models: { model: config.model as string },
      options,
      supportFor: { functions: true, streaming: true }
    });

    this.config = config;
  }

  override getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream
    } as TextModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AITextChatRequest>
  ): [API, AnthropicChatRequest] => {
    const apiConfig = {
      name: '/messages'
    };

    const messages =
      req.chatPrompt?.map((msg) => {
        if (msg.role === 'function') {
          return {
            role: 'user' as 'user' | 'assistant' | 'system',
            content: msg.content,
            tool_use_id: msg.functionId
          };
        }
        return {
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content ?? ''
        };
      }) ?? [];

    const tools: AnthropicChatRequest['tools'] = req.functions?.map((v) => ({
      name: v.name,
      description: v.description,
      input_schema: v.parameters
    }));

    const reqValue: AnthropicChatRequest = {
      model: req.modelInfo?.name ?? this.config.model,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      ...(tools && tools.length > 0 ? { tools } : {}),
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

  override generateChatResp = (
    response: Readonly<AnthropicChatResponse | AnthropicChatError>
  ): TextResponse => {
    const err = response as AnthropicChatError;
    if (err.type === 'error') {
      throw new Error(`Anthropic Chat API Error: ${err.error.message}`);
    }

    const resp = response as AnthropicChatResponse;
    const results = resp.content.map((msg) => {
      let finishReason: TextResponse['results'][0]['finishReason'];

      if (msg.type === 'tool_use') {
        finishReason = 'function_call';
        return {
          id: msg.id,
          type: 'function',
          function: {
            name: msg.name,
            arguments: msg.input
          },
          content: '',
          finishReason
        };
      }
      finishReason = mapFinishReason(resp.stop_reason);
      return {
        content: msg.type === 'text' ? msg.text : '',
        role: resp.role,
        id: resp.id,
        finishReason
      };
    });

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

  override generateChatStreamResp = (
    resp: Readonly<AnthropicChatResponseDelta>
  ): TextResponse => {
    let results: TextResponseResult[] = [];
    let modelUsage;

    if ('message' in resp) {
      const { message } = resp as unknown as AnthropicMessageStartEvent;
      results = [
        {
          content: '',
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
      const { content_block: cb } =
        resp as unknown as AnthropicContentBlockStartEvent;
      results = [{ content: cb.text }];
    }

    if (
      'delta' in resp &&
      'text' in (resp as unknown as AnthropicContentBlockDeltaEvent).delta
    ) {
      const { delta: cb } = resp as unknown as AnthropicContentBlockDeltaEvent;
      results = [{ content: cb.text }];
    }

    if (
      'delta' in resp &&
      'stop_reason' in (resp as unknown as AnthropicMessageDeltaEvent).delta
    ) {
      const { delta } = resp as unknown as AnthropicMessageDeltaEvent;
      results = [
        { content: '', finishReason: mapFinishReason(delta.stop_reason) }
      ];
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

function mapFinishReason(
  stopReason?: AnthropicChatResponse['stop_reason'] | null
): TextResponse['results'][0]['finishReason'] | undefined {
  if (!stopReason) {
    return undefined;
  }
  switch (stopReason) {
    case 'stop_sequence':
      return 'stop';
      break;
    case 'max_tokens':
      return 'length';
      break;
    case 'tool_use':
      return 'function_call';
      break;
    case 'end_turn':
      return 'stop';
      break;
    default:
      return 'stop';
  }
}
