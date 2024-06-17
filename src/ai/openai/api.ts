import type { API } from '../../util/apicall.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import type {
  AxAIPromptConfig,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo
} from '../types.js';

import { axModelInfoOpenAI } from './info.js';
import {
  type AxOpenAIChatRequest,
  type AxOpenAIChatResponse,
  type AxOpenAIChatResponseDelta,
  type AxOpenAIConfig,
  AxOpenAIEmbedModels,
  type AxOpenAIEmbedRequest,
  type AxOpenAIEmbedResponse,
  AxOpenAIModel
} from './types.js';

export const axOpenAIDefaultConfig = (): AxOpenAIConfig =>
  structuredClone({
    model: AxOpenAIModel.GPT35Turbo,
    embedModel: AxOpenAIEmbedModels.TextEmbedding3Small,
    ...axBaseAIDefaultConfig()
  });

export const axOpenAIBestConfig = (): AxOpenAIConfig =>
  structuredClone({
    ...axOpenAIDefaultConfig(),
    model: AxOpenAIModel.GPT4Turbo
  });

export const axOpenAICreativeConfig = (): AxOpenAIConfig =>
  structuredClone({
    model: AxOpenAIModel.GPT4Turbo,
    embedModel: AxOpenAIEmbedModels.TextEmbedding3Small,
    ...axBaseAIDefaultCreativeConfig()
  });

export const axOpenAIFastConfig = (): AxOpenAIConfig => ({
  ...axOpenAIDefaultConfig(),
  model: AxOpenAIModel.GPT4O
});

export interface AxOpenAIArgs {
  apiKey: string;
  apiURL?: string;
  config?: Readonly<AxOpenAIConfig>;
  options?: Readonly<AxAIServiceOptions & { streamingUsage?: boolean }>;
  modelInfo?: Readonly<AxModelInfo[]>;
}

export class AxOpenAI extends AxBaseAI<
  AxOpenAIChatRequest,
  AxOpenAIEmbedRequest,
  AxOpenAIChatResponse,
  AxOpenAIChatResponseDelta,
  AxOpenAIEmbedResponse
> {
  private config: AxOpenAIConfig;
  private streamingUsage: boolean;

  constructor({
    apiKey,
    config = axOpenAIDefaultConfig(),
    options,
    apiURL,
    modelInfo = axModelInfoOpenAI
  }: Readonly<AxOpenAIArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set');
    }
    super({
      name: 'OpenAI',
      apiURL: apiURL ? apiURL : 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo,
      models: { model: config.model, embedModel: config.embedModel },
      options,
      supportFor: { functions: true, streaming: true }
    });
    this.config = config;
    this.streamingUsage = options?.streamingUsage ?? true;
  }

  override getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      topP: config.topP,
      n: config.n,
      stream: config.stream
    };
  }

  override generateChatReq = (
    req: Readonly<AxChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AxAIPromptConfig>
  ): [API, AxOpenAIChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: '/chat/completions'
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
            tool_calls: v.functionCalls?.map((v) => ({
              id: v.id,
              type: 'function' as const,
              function: {
                name: v.function.name,
                arguments:
                  typeof v.function.arguments === 'object'
                    ? JSON.stringify(v.function.arguments)
                    : v.function.arguments
              }
            }))
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

    const stream = req.modelConfig?.stream ?? this.config.stream;

    const reqValue: AxOpenAIChatRequest = {
      model,
      messages,
      response_format: this.config?.responseFormat
        ? { type: this.config?.responseFormat }
        : undefined,
      tools,
      tool_choice: toolsChoice,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens ?? 500,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP ?? 1,
      n: req.modelConfig?.n ?? this.config.n,
      stop: req.modelConfig?.stopSequences ?? this.config.stop,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      logit_bias: this.config.logitBias,
      ...(frequencyPenalty ? { frequency_penalty: frequencyPenalty } : {}),
      ...(stream && this.streamingUsage
        ? { stream: true, stream_options: { include_usage: true } }
        : {})
    };

    return [apiConfig, reqValue];
  };

  override generateEmbedReq = (
    req: Readonly<AxEmbedRequest>
  ): [API, AxOpenAIEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: '/embeddings'
    };

    const reqValue = {
      model: model,
      input: req.texts
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxOpenAIChatResponse>
  ): AxChatResponse => {
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

    const results = choices.map((choice) => {
      const finishReason = mapFinishReason(choice.finish_reason);

      return {
        id: `${choice.index}`,
        content: choice.message.content,
        functionCalls: choice.message.tool_calls?.map((v) => ({
          id: v.id,
          type: 'function' as const,
          function: {
            name: v.function.name,
            arguments: v.function.arguments
          }
        })),
        finishReason
      };
    });

    return {
      modelUsage,
      results,
      remoteId: id
    };
  };

  override generateChatStreamResp = (
    resp: Readonly<AxOpenAIChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    const { id, usage, choices } = resp;

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    const sstate = state as {
      indexIdMap: Record<number, string>;
    };

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {};
    }

    const results = choices.map(
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ({ delta: { content, role, tool_calls }, finish_reason }) => {
        const finishReason = mapFinishReason(finish_reason);

        const functionCalls = tool_calls
          ?.map((v) => {
            if (
              typeof v.id === 'string' &&
              typeof v.index === 'number' &&
              !sstate.indexIdMap[v.index]
            ) {
              sstate.indexIdMap[v.index] = v.id;
            }

            const id = sstate.indexIdMap[v.index];
            if (!id) {
              return null;
            }

            return {
              id,
              type: 'function' as const,
              function: {
                name: v.function.name,
                arguments: v.function.arguments
              }
            };
          })
          .filter(Boolean) as NonNullable<
          AxChatResponseResult['functionCalls']
        >;

        return {
          content,
          role: role,
          functionCalls,
          finishReason,
          id
        };
      }
    );

    return {
      results,
      modelUsage
    };
  };

  override generateEmbedResp = (
    resp: Readonly<AxOpenAIEmbedResponse>
  ): AxEmbedResponse => {
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
}

const mapFinishReason = (
  finishReason: AxOpenAIChatResponse['choices'][0]['finish_reason']
): AxChatResponseResult['finishReason'] => {
  switch (finishReason) {
    case 'stop':
      return 'stop' as const;
    case 'length':
      return 'length' as const;
    case 'content_filter':
      return 'error' as const;
    case 'tool_calls':
      return 'function_call' as const;
  }
};
