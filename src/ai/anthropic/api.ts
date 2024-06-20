import type { API } from '../../util/apicall.js';
import { AxBaseAI, axBaseAIDefaultConfig } from '../base.js';
import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
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
  type AxAnthropicErrorEvent,
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

    const messages = createMessages(req);

    const tools: AxAnthropicChatRequest['tools'] = req.functions?.map((v) => ({
      name: v.name,
      description: v.description,
      input_schema: v.parameters
    }));

    const stream = req.modelConfig?.stream ?? this.config.stream;

    const reqValue: AxAnthropicChatRequest = {
      model: req.modelInfo?.name ?? this.config.model,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(stream ? { stream: true } : {}),
      messages
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxAnthropicChatResponse | AxAnthropicChatError>
  ): AxChatResponse => {
    if (resp.type === 'error') {
      throw new Error(`Anthropic Chat API Error: ${resp.error.message}`);
    }

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
    resp: Readonly<AxAnthropicChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    if (!('type' in resp)) {
      throw new Error('Invalid Anthropic streaming event');
    }

    const sstate = state as {
      indexIdMap: Record<number, string>;
    };

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {};
    }

    if (resp.type === 'error') {
      const { error } = resp as unknown as AxAnthropicErrorEvent;
      throw new Error(error.message);
    }

    if (resp.type === 'message_start') {
      const { message } = resp as unknown as AxAnthropicMessageStartEvent;
      const results = [{ content: '', id: message.id }];
      const modelUsage = {
        promptTokens: message.usage?.input_tokens ?? 0,
        completionTokens: message.usage?.output_tokens ?? 0,
        totalTokens:
          (message.usage?.input_tokens ?? 0) +
          (message.usage?.output_tokens ?? 0)
      };
      return {
        results,
        modelUsage
      };
    }

    if (resp.type === 'content_block_start') {
      const { content_block: contentBlock } =
        resp as unknown as AxAnthropicContentBlockStartEvent;

      if (contentBlock.type === 'text') {
        return {
          results: [{ content: contentBlock.text }]
        };
      }
      if (contentBlock.type === 'tool_use') {
        if (
          typeof contentBlock.id === 'string' &&
          typeof resp.index === 'number' &&
          !sstate.indexIdMap[resp.index]
        ) {
          sstate.indexIdMap[resp.index] = contentBlock.id;
        }
      }
    }

    if (resp.type === 'content_block_delta') {
      const { delta } = resp as unknown as AxAnthropicContentBlockDeltaEvent;
      if (delta.type === 'text_delta') {
        return {
          results: [{ content: delta.text }]
        };
      }
      if (delta.type === 'input_json_delta') {
        const id = sstate.indexIdMap[resp.index];
        if (!id) {
          throw new Error('invalid streaming index no id found: ' + resp.index);
        }
        const functionCalls = [
          {
            id,
            type: 'function' as const,
            function: {
              name: '',
              arguments: delta.partial_json
            }
          }
        ];
        return {
          results: [{ functionCalls }]
        };
      }
    }

    if (resp.type === 'message_delta') {
      const { delta, usage } = resp as unknown as AxAnthropicMessageDeltaEvent;
      return {
        results: [
          {
            content: '',
            finishReason: mapFinishReason(delta.stop_reason)
          }
        ],
        modelUsage: {
          promptTokens: 0,
          completionTokens: usage.output_tokens,
          totalTokens: usage.output_tokens
        }
      };
    }

    return {
      results: [{ content: '' }]
    };
  };
}

function createMessages(
  req: Readonly<AxChatRequest>
): AxAnthropicChatRequest['messages'] {
  return req.chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'function':
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result',
              text: msg.content,
              tool_use_id: msg.functionId
            }
          ]
        };
      case 'user': {
        if (typeof msg.content === 'string') {
          return { role: 'user' as const, content: msg.content };
        }
        const content = msg.content.map((v) => {
          switch (v.type) {
            case 'text':
              return { type: 'text' as const, text: v.text };
            case 'image':
              return {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: v.mimeType,
                  data: v.image
                }
              };
            default:
              throw new Error('Invalid content type');
          }
        });
        return {
          role: 'user' as const,
          content
        };
      }
      case 'assistant': {
        if (typeof msg.content === 'string') {
          return { role: 'assistant' as const, content: msg.content };
        }
        if (typeof msg.functionCalls !== 'undefined') {
          const content = msg.functionCalls.map((v) => {
            let input;
            if (typeof v.function.arguments === 'string') {
              input = JSON.parse(v.function.arguments);
            } else if (typeof v.function.arguments === 'object') {
              input = v.function.arguments;
            }
            return {
              type: 'tool_use' as const,
              id: v.id,
              name: v.function.name,
              input
            };
          });
          return {
            role: 'assistant' as const,
            content
          };
        }
        throw new Error('Invalid content type');
      }
      default:
        throw new Error('Invalid role');
    }
  });
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
