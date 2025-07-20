import type { AxAPI } from '../../util/apicall.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import type {
  AxAIInputModelList,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxTokenUsage,
} from '../types.js';

import { axModelInfoWebLLM } from './info.js';
import {
  type AxAIWebLLMChatRequest,
  type AxAIWebLLMChatResponse,
  type AxAIWebLLMChatResponseDelta,
  type AxAIWebLLMConfig,
  type AxAIWebLLMEmbedModel,
  type AxAIWebLLMEmbedRequest,
  type AxAIWebLLMEmbedResponse,
  AxAIWebLLMModel,
} from './types.js';

export const axAIWebLLMDefaultConfig = (): AxAIWebLLMConfig =>
  structuredClone({
    model: AxAIWebLLMModel.Llama32_3B_Instruct,
    ...axBaseAIDefaultConfig(),
  });

export const axAIWebLLMCreativeConfig = (): AxAIWebLLMConfig =>
  structuredClone({
    model: AxAIWebLLMModel.Llama32_3B_Instruct,
    ...axBaseAIDefaultCreativeConfig(),
  });

export interface AxAIWebLLMArgs<TModelKey> {
  name: 'webllm';
  engine: any; // WebLLM MLCEngine instance
  config?: Readonly<Partial<AxAIWebLLMConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<AxAIWebLLMModel, AxAIWebLLMEmbedModel, TModelKey>;
}

class AxAIWebLLMImpl
  implements
    AxAIServiceImpl<
      AxAIWebLLMModel,
      AxAIWebLLMEmbedModel,
      AxAIWebLLMChatRequest,
      AxAIWebLLMEmbedRequest,
      AxAIWebLLMChatResponse,
      AxAIWebLLMChatResponseDelta,
      AxAIWebLLMEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined;

  constructor(
    private config: AxAIWebLLMConfig,
    private engine: any // WebLLM MLCEngine instance
  ) {}

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      stream: config.stream,
      n: config.n,
    } as AxModelConfig;
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<AxAIWebLLMModel>>
  ): [AxAPI, AxAIWebLLMChatRequest] {
    const model = req.model;

    // Convert Ax chat format to WebLLM format
    const messages = req.chatPrompt.map((msg) => {
      if (msg.role === 'function') {
        return {
          role: 'function' as const,
          name: msg.functionId,
          content: typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result),
        };
      }

      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Handle multi-modal content by extracting text
        content = msg.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n');
      }

      const baseMsg = {
        role: msg.role,
        content,
      };

      // Add function calls for assistant messages
      if (msg.role === 'assistant' && msg.functionCalls?.length) {
        return {
          ...baseMsg,
          tool_calls: msg.functionCalls.map((fc) => ({
            id: fc.id,
            type: 'function' as const,
            function: {
              name: fc.function.name,
              arguments: typeof fc.function.params === 'string' 
                ? fc.function.params 
                : JSON.stringify(fc.function.params || {}),
            },
          })),
        };
      }

      return baseMsg;
    });

    // Convert functions to tools
    const tools = req.functions?.map((fn) => ({
      type: 'function' as const,
      function: {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters || { type: 'object', properties: {} },
      },
    }));

    const apiConfig = {
      name: '/chat/completions', // WebLLM uses OpenAI-compatible endpoint
    };

    const reqValue: AxAIWebLLMChatRequest = {
      model,
      messages,
      ...(tools?.length ? { tools } : {}),
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      presence_penalty: req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      frequency_penalty: req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      stop: req.modelConfig?.stopSequences ?? this.config.stopSequences,
      stream: req.modelConfig?.stream ?? this.config.stream,
      n: req.modelConfig?.n ?? this.config.n,
    };

    return [apiConfig, reqValue];
  }

  createEmbedReq = (
    req: Readonly<AxInternalEmbedRequest<AxAIWebLLMEmbedModel>>
  ): [AxAPI, AxAIWebLLMEmbedRequest] => {
    throw new Error('WebLLM does not support embeddings');
  };

  createChatResp = (resp: Readonly<AxAIWebLLMChatResponse>): AxChatResponse => {
    this.tokensUsed = {
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      completionTokens: resp.usage?.completion_tokens ?? 0,
      totalTokens: resp.usage?.total_tokens ?? 0,
    };

    const results = resp.choices.map((choice, index) => {
      let finishReason: AxChatResponse['results'][0]['finishReason'] = 'stop';
      switch (choice.finish_reason) {
        case 'stop':
          finishReason = 'stop';
          break;
        case 'length':
          finishReason = 'length';
          break;
        case 'tool_calls':
          finishReason = 'function_call';
          break;
        case 'content_filter':
          finishReason = 'content_filter';
          break;
        default:
          finishReason = 'stop';
          break;
      }

      const functionCalls = choice.message.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.function.name,
          params: toolCall.function.arguments,
        },
      }));

      return {
        index,
        id: resp.id,
        content: choice.message.content || '',
        functionCalls,
        finishReason,
      };
    });

    return { results, remoteId: resp.id };
  };

  createChatStreamResp = (
    resp: Readonly<AxAIWebLLMChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    const ss = state as {
      content?: string;
      toolCalls?: Array<{
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };

    // Accumulate streaming content
    const choice = resp.choices[0];
    if (!choice) {
      throw new Error('No choice in WebLLM stream response');
    }

    if (choice.delta.content) {
      ss.content = (ss.content || '') + choice.delta.content;
    }

    // Handle tool calls in streaming
    if (choice.delta.tool_calls) {
      if (!ss.toolCalls) {
        ss.toolCalls = [];
      }
      
      for (const deltaToolCall of choice.delta.tool_calls) {
        const existingCall = ss.toolCalls[deltaToolCall.index];
        if (existingCall) {
          if (deltaToolCall.function?.arguments) {
            existingCall.function!.arguments = 
              (existingCall.function?.arguments || '') + deltaToolCall.function.arguments;
          }
        } else {
          ss.toolCalls[deltaToolCall.index] = {
            id: deltaToolCall.id,
            type: deltaToolCall.type,
            function: {
              name: deltaToolCall.function?.name,
              arguments: deltaToolCall.function?.arguments || '',
            },
          };
        }
      }
    }

    // Update token usage if available
    if (resp.usage) {
      this.tokensUsed = {
        promptTokens: resp.usage.prompt_tokens,
        completionTokens: resp.usage.completion_tokens,
        totalTokens: resp.usage.total_tokens,
      };
    }

    let finishReason: AxChatResponse['results'][0]['finishReason'] | undefined;
    if (choice.finish_reason) {
      switch (choice.finish_reason) {
        case 'stop':
          finishReason = 'stop';
          break;
        case 'length':
          finishReason = 'length';
          break;
        case 'tool_calls':
          finishReason = 'function_call';
          break;
        case 'content_filter':
          finishReason = 'content_filter';
          break;
        default:
          finishReason = 'stop';
          break;
      }
    }

    const functionCalls = ss.toolCalls?.map((toolCall) => ({
      id: toolCall.id || '',
      type: 'function' as const,
      function: {
        name: toolCall.function?.name || '',
        params: toolCall.function?.arguments || '',
      },
    }));

    const results = [
      {
        index: 0,
        id: resp.id,
        content: ss.content || '',
        functionCalls,
        finishReason,
      },
    ];

    return { results, remoteId: resp.id };
  };

  createEmbedResp(resp: Readonly<AxAIWebLLMEmbedResponse>): AxEmbedResponse {
    throw new Error('WebLLM does not support embeddings');
  }
}

export class AxAIWebLLM<TModelKey> extends AxBaseAI<
  AxAIWebLLMModel,
  AxAIWebLLMEmbedModel,
  AxAIWebLLMChatRequest,
  AxAIWebLLMEmbedRequest,
  AxAIWebLLMChatResponse,
  AxAIWebLLMChatResponseDelta,
  AxAIWebLLMEmbedResponse,
  TModelKey
> {
  constructor({
    engine,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIWebLLMArgs<TModelKey>, 'name'>>) {
    if (!engine) {
      throw new Error('WebLLM engine instance is required');
    }

    const Config = {
      ...axAIWebLLMDefaultConfig(),
      ...config,
    };

    const aiImpl = new AxAIWebLLMImpl(Config, engine);

    super(aiImpl, {
      name: 'WebLLM',
      apiURL: '', // No API URL needed for local inference
      headers: async () => ({}), // No headers needed
      modelInfo: axModelInfoWebLLM,
      defaults: { model: Config.model },
      supportFor: (model: AxAIWebLLMModel) => ({
        functions: true, // WebLLM supports function calling
        streaming: true, // WebLLM supports streaming
      }),
      options,
      models,
    });

    // Override the API call method to use the WebLLM engine directly
    this.overrideApiCall(engine);
  }

  private overrideApiCall(engine: any) {
    // Override the internal API call method to use WebLLM engine
    const originalCall = (this as any).apiCall;
    (this as any).apiCall = async (
      api: AxAPI,
      data: any,
      stream?: boolean
    ) => {
      try {
        // Use WebLLM engine's chat.completions.create method
        const response = await engine.chat.completions.create({
          ...data,
          stream: stream || false,
        });

        if (stream) {
          // Return a ReadableStream for streaming responses
          return new ReadableStream({
            async start(controller) {
              try {
                for await (const chunk of response) {
                  controller.enqueue(chunk);
                }
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            },
          });
        } else {
          return response;
        }
      } catch (error) {
        throw new Error(`WebLLM API error: ${error}`);
      }
    };
  }
}