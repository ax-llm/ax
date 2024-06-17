import type { API } from '../../util/apicall.js';
import { AxBaseAI, axBaseAIDefaultConfig } from '../base.js';
import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxModelConfig
} from '../types.js';

import { axModelInfoAnthropic } from './info.js';
import {
  type AxAnthropicChatError,
  type AxAnthropicChatRequest,
  type AxAnthropicChatResponse,
  type AxAnthropicChatResponseDelta,
  type AxAnthropicConfig,
  type AxAnthropicContentBlockDeltaEvent,
  type AxAnthropicContentBlockStartEvent,
  type AxAnthropicMessageDeltaEvent,
  type AxAnthropicMessageStartEvent,
  AxAnthropicModel
} from './types.js';

export const axAnthropicDefaultConfig = (): AxAnthropicConfig =>
  structuredClone({
    model: AxAnthropicModel.Claude3Haiku,
    ...axBaseAIDefaultConfig()
  });

export interface AxAnthropicArgs {
  apiKey: string;
  config?: Readonly<AxAnthropicConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxAnthropic extends AxBaseAI<
  AxAnthropicChatRequest,
  unknown,
  AxAnthropicChatResponse,
  AxAnthropicChatResponseDelta,
  unknown
> {
  private config: AxAnthropicConfig;

  constructor({
    apiKey,
    config = axAnthropicDefaultConfig(),
    options
  }: Readonly<AxAnthropicArgs>) {
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
      modelInfo: axModelInfoAnthropic,
      models: { model: config.model as string },
      options,
      supportFor: { functions: true, streaming: true }
    });

    this.config = config;
  }

  override getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream
    } as AxModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AxChatRequest>
  ): [API, AxAnthropicChatRequest] => {
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

    const tools: AxAnthropicChatRequest['tools'] = req.functions?.map((v) => ({
      name: v.name,
      description: v.description,
      input_schema: v.parameters
    }));

    const reqValue: AxAnthropicChatRequest = {
      model: req.modelInfo?.name ?? this.config.model,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      ...(tools && tools.length > 0 ? { tools } : {}),
      messages
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    response: Readonly<AxAnthropicChatResponse | AxAnthropicChatError>
  ): AxChatResponse => {
    const err = response as AxAnthropicChatError;
    if (err.type === 'error') {
      throw new Error(`Anthropic Chat API Error: ${err.error.message}`);
    }

    const resp = response as AxAnthropicChatResponse;
    const results = resp.content.map((msg) => {
      let finishReason: AxChatResponse['results'][0]['finishReason'];

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
    resp: Readonly<AxAnthropicChatResponseDelta>
  ): AxChatResponse => {
    let results: AxChatResponseResult[] = [];
    let modelUsage;

    if ('message' in resp) {
      const { message } = resp as unknown as AxAnthropicMessageStartEvent;
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
        resp as unknown as AxAnthropicContentBlockStartEvent;
      results = [{ content: cb.text }];
    }

    if (
      'delta' in resp &&
      'text' in (resp as unknown as AxAnthropicContentBlockDeltaEvent).delta
    ) {
      const { delta: cb } =
        resp as unknown as AxAnthropicContentBlockDeltaEvent;
      results = [{ content: cb.text }];
    }

    if (
      'delta' in resp &&
      'stop_reason' in (resp as unknown as AxAnthropicMessageDeltaEvent).delta
    ) {
      const { delta } = resp as unknown as AxAnthropicMessageDeltaEvent;
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
  stopReason?: AxAnthropicChatResponse['stop_reason'] | null
): AxChatResponse['results'][0]['finishReason'] | undefined {
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
