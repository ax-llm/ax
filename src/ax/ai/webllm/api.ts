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
  type AxAIWebLLMEngine,
  AxAIWebLLMModel,
  type AxAIWebLLMModelId,
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
  engine: AxAIWebLLMEngine;
  config?: Readonly<Partial<AxAIWebLLMConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<
    AxAIWebLLMModelId,
    AxAIWebLLMEmbedModel,
    TModelKey
  >;
}

class AxAIWebLLMImpl
  implements
    AxAIServiceImpl<
      AxAIWebLLMModelId,
      AxAIWebLLMEmbedModel,
      AxAIWebLLMChatRequest,
      AxAIWebLLMEmbedRequest,
      AxAIWebLLMChatResponse,
      AxAIWebLLMChatResponseDelta,
      AxAIWebLLMEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined;
  private readonly engine: AxAIWebLLMEngine;

  constructor(
    private config: AxAIWebLLMConfig,
    engine: AxAIWebLLMEngine
  ) {
    this.engine = engine;
  }

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
    req: Readonly<AxInternalChatRequest<AxAIWebLLMModelId>>
  ): [AxAPI, AxAIWebLLMChatRequest] {
    const model = req.model;
    const supportsFunctions = this.config.supportsFunctions ?? false;

    const messages = req.chatPrompt.map((msg) => {
      if (msg.role === 'function') {
        return {
          role: 'tool' as const,
          tool_call_id: msg.functionId,
          content:
            typeof msg.result === 'string'
              ? msg.result
              : JSON.stringify(msg.result),
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
              arguments:
                typeof fc.function.params === 'string'
                  ? fc.function.params
                  : JSON.stringify(fc.function.params || {}),
            },
          })),
        };
      }

      return baseMsg;
    });

    const tools = supportsFunctions
      ? req.functions?.map((fn) => ({
          type: 'function' as const,
          function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters || { type: 'object', properties: {} },
          },
        }))
      : undefined;
    const toolChoice =
      supportsFunctions && tools?.length
        ? req.functionCall === undefined
          ? 'auto'
          : req.functionCall
        : undefined;
    const responseFormat = this.createResponseFormat(req.responseFormat);

    const apiConfig = {
      name: '/chat/completions',
      localCall: async <TRequest, TResponse>(
        data: TRequest,
        stream?: boolean
      ): Promise<TResponse | ReadableStream<TResponse>> => {
        try {
          const response = await this.engine.chat.completions.create({
            ...(data as AxAIWebLLMChatRequest),
            stream: stream ?? false,
          });

          if (stream) {
            return this.toReadableStream(
              response as
                | AsyncIterable<AxAIWebLLMChatResponseDelta>
                | ReadableStream<AxAIWebLLMChatResponseDelta>
            ) as TResponse | ReadableStream<TResponse>;
          }
          return response as TResponse | ReadableStream<TResponse>;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(`WebLLM API error: ${message}`, { cause: error });
        }
      },
    };

    const reqValue: AxAIWebLLMChatRequest = {
      model,
      messages,
      ...(tools?.length ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      ...(req.modelConfig?.temperature !== undefined
        ? { temperature: req.modelConfig.temperature }
        : {}),
      ...(req.modelConfig?.topP !== undefined
        ? { top_p: req.modelConfig.topP }
        : {}),
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      stop: req.modelConfig?.stopSequences ?? this.config.stopSequences,
      stream: req.modelConfig?.stream ?? this.config.stream,
      ...((req.modelConfig?.stream ?? this.config.stream)
        ? { stream_options: { include_usage: true } }
        : {}),
      n: req.modelConfig?.n ?? this.config.n,
      ...(this.config.logitBias !== undefined
        ? { logit_bias: this.config.logitBias }
        : {}),
      ...(this.config.logProbs !== undefined
        ? { logprobs: this.config.logProbs }
        : {}),
      ...(this.config.topLogprobs !== undefined
        ? { top_logprobs: this.config.topLogprobs }
        : {}),
    };

    return [apiConfig, reqValue];
  }

  private createResponseFormat(
    responseFormat: AxInternalChatRequest<AxAIWebLLMModelId>['responseFormat']
  ): AxAIWebLLMChatRequest['response_format'] | undefined {
    if (responseFormat?.type === 'json_object') {
      return { type: 'json_object' };
    }

    if (responseFormat?.type === 'json_schema') {
      const schema =
        (responseFormat as { schema?: unknown }).schema ??
        (responseFormat as { json_schema?: unknown }).json_schema;
      return {
        type: 'json_schema',
        json_schema: schema,
      };
    }

    return undefined;
  }

  private toReadableStream(
    response:
      | AsyncIterable<AxAIWebLLMChatResponseDelta>
      | ReadableStream<AxAIWebLLMChatResponseDelta>
  ): ReadableStream<AxAIWebLLMChatResponseDelta> {
    if (this.isReadableStream(response)) {
      return response;
    }

    if (
      response &&
      typeof (response as AsyncIterable<AxAIWebLLMChatResponseDelta>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
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
    }

    throw new Error('WebLLM streaming response is not async iterable');
  }

  private isReadableStream(
    response: unknown
  ): response is ReadableStream<AxAIWebLLMChatResponseDelta> {
    return (
      response !== null &&
      typeof response === 'object' &&
      typeof (response as { getReader?: unknown }).getReader === 'function'
    );
  }

  createEmbedReq = (
    _req: Readonly<AxInternalEmbedRequest<AxAIWebLLMEmbedModel>>
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
        logprobs: choice.logprobs
          ? this.createLogprobs(choice.logprobs)
          : undefined,
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
      logprobs?: AxChatResponse['results'][0]['logprobs'];
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
          existingCall.id = deltaToolCall.id ?? existingCall.id;
          existingCall.type = deltaToolCall.type ?? existingCall.type;
          existingCall.function ??= {};
          existingCall.function.name =
            deltaToolCall.function?.name ?? existingCall.function.name;
          if (deltaToolCall.function?.arguments) {
            existingCall.function.arguments =
              (existingCall.function?.arguments || '') +
              deltaToolCall.function.arguments;
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

    if (choice.logprobs) {
      const nextLogprobs = this.createLogprobs(choice.logprobs);
      ss.logprobs = {
        content: [
          ...(ss.logprobs?.content ?? []),
          ...(nextLogprobs.content ?? []),
        ],
      };
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
        logprobs: ss.logprobs,
      },
    ];

    return { results, remoteId: resp.id };
  };

  private createLogprobs(
    logprobs: NonNullable<AxAIWebLLMChatResponse['choices'][number]['logprobs']>
  ): NonNullable<AxChatResponse['results'][number]['logprobs']> {
    return {
      content: logprobs.content.map((item) => ({
        token: item.token,
        logprob: item.logprob,
        topLogprobs: item.top_logprobs?.map((top) => ({
          token: top.token,
          logprob: top.logprob,
        })),
      })),
    };
  }

  createEmbedResp(_resp: Readonly<AxAIWebLLMEmbedResponse>): AxEmbedResponse {
    throw new Error('WebLLM does not support embeddings');
  }
}

export class AxAIWebLLM<TModelKey> extends AxBaseAI<
  AxAIWebLLMModelId,
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
      apiURL: undefined, // No URL needed for local inference
      headers: async () => ({}), // No headers needed
      modelInfo: axModelInfoWebLLM,
      defaults: { model: Config.model },
      supportFor: (_model: AxAIWebLLMModelId) => ({
        functions: Config.supportsFunctions ?? false,
        streaming: true,
        media: {
          images: {
            supported: false,
            formats: [],
          },
          audio: {
            supported: false,
            formats: [],
          },
          files: {
            supported: false,
            formats: [],
            uploadMethod: 'none' as const,
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: false,
        multiTurn: true,
      }),
      options,
      models,
    });
  }
}
