import type { API } from '../../util/apicall.js';
import { AxBaseAI, axBaseAIDefaultConfig } from '../base.js';
import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxInternalChatRequest,
  AxModelConfig
} from '../types.js';

import { axModelInfoAnthropic } from './info.js';
import {
  type AxAIAnthropicChatError,
  type AxAIAnthropicChatRequest,
  type AxAIAnthropicChatResponse,
  type AxAIAnthropicChatResponseDelta,
  type AxAIAnthropicConfig,
  type AxAIAnthropicContentBlockDeltaEvent,
  type AxAIAnthropicContentBlockStartEvent,
  type AxAIAnthropicErrorEvent,
  type AxAIAnthropicMessageDeltaEvent,
  type AxAIAnthropicMessageStartEvent,
  AxAIAnthropicModel
} from './types.js';

export const axAIAnthropicDefaultConfig = (): AxAIAnthropicConfig =>
  structuredClone({
    model: AxAIAnthropicModel.Claude35Sonnet,
    ...axBaseAIDefaultConfig()
  });

export interface AxAIAnthropicArgs {
  name: 'anthropic';
  apiKey: string;
  config?: Readonly<Partial<AxAIAnthropicConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  modelMap?: Record<string, AxAIAnthropicModel | string>;
}

export class AxAIAnthropic extends AxBaseAI<
  AxAIAnthropicChatRequest,
  unknown,
  AxAIAnthropicChatResponse,
  AxAIAnthropicChatResponseDelta,
  unknown
> {
  private config: AxAIAnthropicConfig;

  constructor({
    apiKey,
    config,
    options,
    modelMap
  }: Readonly<Omit<AxAIAnthropicArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Anthropic API key not set');
    }
    const _config = {
      ...axAIAnthropicDefaultConfig(),
      ...config
    };
    super({
      name: 'Anthropic',
      apiURL: 'https://api.anthropic.com/v1',
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-api-key': apiKey
      },
      modelInfo: axModelInfoAnthropic,
      models: { model: _config.model },
      options,
      supportFor: { functions: true, streaming: true },
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
      stream: config.stream,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      n: config.n
    } as AxModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AxInternalChatRequest>
  ): [API, AxAIAnthropicChatRequest] => {
    const model = req.model;

    const apiConfig = {
      name: '/messages'
    };

    const system = req.chatPrompt
      .filter((msg) => msg.role === 'system')
      .map((msg) => ({
        type: 'text' as const,
        text: msg.content,
        ...(msg.cache ? { cache: { type: 'ephemeral' } } : {})
      }));

    const otherMessages = req.chatPrompt.filter((msg) => msg.role !== 'system');

    const messages = createMessages(otherMessages);

    const tools: AxAIAnthropicChatRequest['tools'] = req.functions?.map(
      (v) => ({
        name: v.name,
        description: v.description,
        input_schema: v.parameters
      })
    );

    const stream = req.modelConfig?.stream ?? this.config.stream;

    const reqValue: AxAIAnthropicChatRequest = {
      model,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      ...(tools && tools.length > 0
        ? { tools, tool_choice: { type: 'auto' } }
        : {}),
      ...(stream ? { stream: true } : {}),
      ...(system ? { system } : {}),
      messages
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxAIAnthropicChatResponse | AxAIAnthropicChatError>
  ): AxChatResponse => {
    if (resp.type === 'error') {
      throw new Error(`Anthropic Chat API Error: ${resp.error.message}`);
    }

    const finishReason = mapFinishReason(resp.stop_reason);

    const results = resp.content.map((msg): AxChatResponseResult => {
      if (msg.type === 'tool_use') {
        return {
          id: msg.id,
          functionCalls: [
            {
              id: msg.id,
              type: 'function' as const,
              function: {
                name: msg.name,
                params: msg.input
              }
            }
          ],
          finishReason
        };
      }
      return {
        content: msg.type === 'text' ? msg.text : '',
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
      modelUsage,
      remoteId: resp.id
    };
  };

  override generateChatStreamResp = (
    resp: Readonly<AxAIAnthropicChatResponseDelta>,
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
      const { error } = resp as unknown as AxAIAnthropicErrorEvent;
      throw new Error(error.message);
    }

    if (resp.type === 'message_start') {
      const { message } = resp as unknown as AxAIAnthropicMessageStartEvent;
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
        resp as unknown as AxAIAnthropicContentBlockStartEvent;

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
          const functionCalls = [
            {
              id: contentBlock.id,
              type: 'function' as const,
              function: {
                name: contentBlock.name,
                params: ''
              }
            }
          ];
          return {
            results: [{ functionCalls }]
          };
        }
      }
    }

    if (resp.type === 'content_block_delta') {
      const { delta } = resp as unknown as AxAIAnthropicContentBlockDeltaEvent;
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
              params: delta.partial_json
            }
          }
        ];
        return {
          results: [{ functionCalls }]
        };
      }
    }

    if (resp.type === 'message_delta') {
      const { delta, usage } =
        resp as unknown as AxAIAnthropicMessageDeltaEvent;
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
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
): AxAIAnthropicChatRequest['messages'] {
  const items: AxAIAnthropicChatRequest['messages'] = chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'function':
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result',
              content: msg.result,
              tool_use_id: msg.functionId,
              ...(msg.cache ? { cache: { type: 'ephemeral' } } : {})
            }
          ]
        };
      case 'user': {
        if (typeof msg.content === 'string') {
          return {
            role: 'user' as const,
            content: msg.content
          };
        }
        const content = msg.content.map((v) => {
          switch (v.type) {
            case 'text':
              return {
                type: 'text' as const,
                text: v.text,
                ...(v.cache ? { cache: { type: 'ephemeral' } } : {})
              };
            case 'image':
              return {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: v.mimeType,
                  data: v.image
                },
                ...(v.cache ? { cache: { type: 'ephemeral' } } : {})
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
        let content: Extract<
          AxAIAnthropicChatRequest['messages'][0],
          { role: 'assistant' }
        >['content'] = '';

        if (typeof msg.content === 'string') {
          content = msg.content;
        }
        if (typeof msg.functionCalls !== 'undefined') {
          content = msg.functionCalls.map((v) => {
            let input;
            if (typeof v.function.params === 'string') {
              input = JSON.parse(v.function.params);
            } else if (typeof v.function.params === 'object') {
              input = v.function.params;
            }
            return {
              type: 'tool_use' as const,
              id: v.id,
              name: v.function.name,
              input,
              ...(msg.cache ? { cache: { type: 'ephemeral' } } : {})
            };
          });
        }
        return {
          role: 'assistant' as const,
          content
        };
      }
      default:
        throw new Error('Invalid role');
    }
  });

  return mergeAssistantMessages(items);
}

// Anthropic and some others need this in non-streaming mode
function mergeAssistantMessages(
  messages: Readonly<AxAIAnthropicChatRequest['messages']>
): AxAIAnthropicChatRequest['messages'] {
  const mergedMessages: AxAIAnthropicChatRequest['messages'] = [];

  for (const [i, cur] of messages.entries()) {
    // Continue if not an assistant message or first message
    if (cur.role !== 'assistant') {
      mergedMessages.push(cur);
      continue;
    }

    // Merge current message with the previous one if both are from the assistant
    if (i > 0 && messages.at(i - 1)?.role === 'assistant') {
      const lastMessage = mergedMessages.pop();

      mergedMessages.push({
        ...(lastMessage ? lastMessage : {}),
        ...cur
      });
    } else {
      mergedMessages.push(cur);
    }
  }

  return mergedMessages;
}

function mapFinishReason(
  stopReason?: AxAIAnthropicChatResponse['stop_reason'] | null
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
