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

import { axModelInfoCohere } from './info.js';
import {
  type AxAICohereChatRequest,
  type AxAICohereChatResponse,
  type AxAICohereChatResponseDelta,
  type AxAICohereConfig,
  AxAICohereEmbedModel,
  type AxAICohereEmbedRequest,
  type AxAICohereEmbedResponse,
  AxAICohereModel,
} from './types.js';

/**
 * Creates the default configuration for Cohere AI service
 * @returns A deep clone of the default Cohere configuration with CommandRPlus model and EmbedEnglishV30 embed model
 */
export const axAICohereDefaultConfig = (): AxAICohereConfig =>
  structuredClone({
    model: AxAICohereModel.CommandRPlus,
    embedModel: AxAICohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultConfig(),
  });

/**
 * Creates a creative configuration for Cohere AI service with more flexible parameters
 * @returns A deep clone of the creative Cohere configuration with CommandR model and EmbedEnglishV30 embed model
 */
export const axAICohereCreativeConfig = (): AxAICohereConfig =>
  structuredClone({
    model: AxAICohereModel.CommandR,
    embedModel: AxAICohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultCreativeConfig(),
  });

/**
 * Configuration arguments for initializing the Cohere AI service
 * @template TModelKey - The type of model keys supported
 */
export interface AxAICohereArgs<TModelKey> {
  name: 'cohere';
  apiKey: string;
  config?: Readonly<Partial<AxAICohereConfig>>;
  options?: Readonly<AxAIServiceOptions>;
  models?: AxAIInputModelList<AxAICohereModel, AxAICohereEmbedModel, TModelKey>;
}

/**
 * Implementation class for Cohere AI service that handles API requests and responses
 */
class AxAICohereImpl
  implements
    AxAIServiceImpl<
      AxAICohereModel,
      AxAICohereEmbedModel,
      AxAICohereChatRequest,
      AxAICohereEmbedRequest,
      AxAICohereChatResponse,
      AxAICohereChatResponseDelta,
      AxAICohereEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined;

  /**
   * Creates a new instance of AxAICohereImpl
   * @param config - The configuration object for the Cohere AI service
   */
  constructor(private config: AxAICohereConfig) {}

  /**
   * Returns the token usage information from the last API call
   * @returns Token usage data or undefined if no tokens have been used
   */
  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  /**
   * Extracts and returns the model configuration parameters
   * @returns Model configuration object with parameters like maxTokens, temperature, etc.
   */
  getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      endSequences: config.endSequences,
      stopSequences: config.stopSequences,
      stream: config.stream,
      n: config.n,
    } as AxModelConfig;
  }

  /**
   * Creates a chat request in Cohere API format from internal request format
   * @param req - The internal chat request object
   * @returns A tuple containing API configuration and the formatted Cohere chat request
   */
  createChatReq(
    req: Readonly<AxInternalChatRequest<AxAICohereModel>>
  ): [AxAPI, AxAICohereChatRequest] {
    const model = req.model;

    const lastChatMsg = req.chatPrompt.at(-1);
    const restOfChat = req.chatPrompt.slice(0, -1);

    let message: AxAICohereChatRequest['message'] | undefined;

    if (
      lastChatMsg &&
      lastChatMsg.role === 'user' &&
      typeof lastChatMsg.content === 'string'
    ) {
      message = lastChatMsg?.content;
    }

    const chatHistory = createHistory(restOfChat);

    type PropValue = NonNullable<
      AxAICohereChatRequest['tools']
    >[0]['parameter_definitions'][0];

    const tools: AxAICohereChatRequest['tools'] = req.functions?.map((v) => {
      const props: Record<string, PropValue> = {};
      if (v.parameters?.properties) {
        for (const [key, value] of Object.entries(v.parameters.properties)) {
          props[key] = {
            description: value.description,
            type: value.type,
            required: v.parameters.required?.includes(key) ?? false,
          };
        }
      }

      return {
        name: v.name,
        description: v.description,
        parameter_definitions: props,
      };
    });

    type FnType = Extract<AxChatRequest['chatPrompt'][0], { role: 'function' }>;

    const toolResults: AxAICohereChatRequest['tool_results'] = (
      req.chatPrompt as FnType[]
    )
      .filter((chat) => chat.role === 'function')
      .map((chat) => {
        const fn = tools?.find((t) => t.name === chat.functionId);
        if (!fn) {
          throw new Error('Function not found');
        }
        return {
          call: { name: fn.name, parameters: fn.parameter_definitions },
          outputs: [{ result: chat.result ?? '' }],
        };
      });

    const apiConfig = {
      name: '/chat',
    };

    const reqValue: AxAICohereChatRequest = {
      message,
      model,
      tools,
      ...(toolResults && !message ? { tool_results: toolResults } : {}),
      chat_history: chatHistory,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      ...(req.modelConfig?.temperature !== undefined
        ? { temperature: req.modelConfig.temperature }
        : {}),
      k: req.modelConfig?.topK ?? this.config.topK,
      ...(req.modelConfig?.topP !== undefined
        ? { p: req.modelConfig.topP }
        : {}),
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      end_sequences: this.config.endSequences,
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
    };

    return [apiConfig, reqValue];
  }

  /**
   * Creates an embedding request in Cohere API format from internal request format
   * @param req - The internal embed request object
   * @returns A tuple containing API configuration and the formatted Cohere embed request
   */
  createEmbedReq = (
    req: Readonly<AxInternalEmbedRequest<AxAICohereEmbedModel>>
  ): [AxAPI, AxAICohereEmbedRequest] => {
    const model = req.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: '/embed',
    };

    const reqValue = {
      model,
      texts: req.texts ?? [],
      input_type: 'classification',
      truncate: '',
    };

    return [apiConfig, reqValue];
  };

  /**
   * Converts Cohere chat response to internal chat response format
   * @param resp - The Cohere chat response object
   * @returns Formatted internal chat response
   */
  createChatResp = (resp: Readonly<AxAICohereChatResponse>): AxChatResponse => {
    this.tokensUsed = resp.meta.billed_units
      ? {
          promptTokens: resp.meta.billed_units.input_tokens,
          completionTokens: resp.meta.billed_units.output_tokens,
          totalTokens:
            resp.meta.billed_units.input_tokens +
            resp.meta.billed_units.output_tokens,
        }
      : undefined;

    let finishReason: AxChatResponse['results'][0]['finishReason'];
    if ('finish_reason' in resp) {
      switch (resp.finish_reason) {
        case 'COMPLETE':
          finishReason = 'stop';
          break;
        case 'MAX_TOKENS':
          finishReason = 'length';
          break;
        case 'ERROR':
          throw new Error('Finish reason: ERROR');
        case 'ERROR_TOXIC':
          throw new Error('Finish reason: CONTENT_FILTER');
        default:
          finishReason = 'stop';
          break;
      }
    }

    let functionCalls: AxChatResponse['results'][0]['functionCalls'];

    if ('tool_calls' in resp) {
      functionCalls = resp.tool_calls?.map(
        (v): NonNullable<AxChatResponse['results'][0]['functionCalls']>[0] => {
          return {
            id: v.name,
            type: 'function' as const,
            function: { name: v.name, params: v.parameters },
          };
        }
      );
    }

    const results: AxChatResponse['results'] = [
      {
        index: 0,
        id: resp.generation_id,
        content: resp.text,
        functionCalls,
        finishReason,
      },
    ];

    return { results, remoteId: resp.response_id };
  };

  /**
   * Converts Cohere streaming chat response to internal chat response format
   * @param resp - The Cohere streaming chat response delta
   * @param state - State object to maintain across streaming chunks
   * @returns Formatted internal chat response for streaming
   */
  createChatStreamResp = (
    resp: Readonly<AxAICohereChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    const ss = state as {
      generation_id?: string;
    };

    if (resp.event_type === 'stream-start') {
      ss.generation_id = resp.generation_id;
    }

    this.tokensUsed = {
      promptTokens: 0,
      completionTokens: resp.meta.billed_units?.output_tokens ?? 0,
      totalTokens: resp.meta.billed_units?.output_tokens ?? 0,
    };

    const { results } = this.createChatResp(resp);
    const result = results[0];
    if (!result) {
      throw new Error('No result');
    }

    result.id = ss.generation_id ?? '';
    return { results };
  };

  /**
   * Converts Cohere embedding response to internal embedding response format
   * @param resp - The Cohere embedding response object
   * @returns Formatted internal embedding response
   */
  createEmbedResp(resp: Readonly<AxAICohereEmbedResponse>): AxEmbedResponse {
    return {
      remoteId: resp.id,
      embeddings: resp.embeddings,
    };
  }
}

/**
 * Main Cohere AI service class that extends the base AI implementation
 * @template TModelKey - The type of model keys supported
 */
export class AxAICohere<TModelKey> extends AxBaseAI<
  AxAICohereModel,
  AxAICohereEmbedModel,
  AxAICohereChatRequest,
  AxAICohereEmbedRequest,
  AxAICohereChatResponse,
  AxAICohereChatResponseDelta,
  AxAICohereEmbedResponse,
  TModelKey
> {
  /**
   * Creates a new instance of AxAICohere
   * @param args - Configuration arguments including API key, config, options, and models
   */
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAICohereArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    const Config = {
      ...axAICohereDefaultConfig(),
      ...config,
    };

    const aiImpl = new AxAICohereImpl(Config);

    // Normalize per-model presets: allow provider-specific config on each model list item
    const normalizedModels = models?.map((item) => {
      const anyItem = item as any;
      const cfg = anyItem?.config as Partial<AxAICohereConfig> | undefined;
      if (!cfg) return item;

      const modelConfig: Partial<AxModelConfig> = {};
      if (cfg.maxTokens !== undefined) modelConfig.maxTokens = cfg.maxTokens;
      if (cfg.temperature !== undefined)
        modelConfig.temperature = cfg.temperature;
      if (cfg.topP !== undefined) modelConfig.topP = cfg.topP;
      if (cfg.topK !== undefined) modelConfig.topK = cfg.topK as number;
      if (cfg.presencePenalty !== undefined)
        modelConfig.presencePenalty = cfg.presencePenalty as number;
      if (cfg.frequencyPenalty !== undefined)
        modelConfig.frequencyPenalty = cfg.frequencyPenalty as number;
      if (cfg.stopSequences !== undefined)
        modelConfig.stopSequences = cfg.stopSequences as string[];
      if ((cfg as any).endSequences !== undefined)
        (modelConfig as any).endSequences = (cfg as any).endSequences;
      if (cfg.stream !== undefined) modelConfig.stream = cfg.stream as boolean;
      if (cfg.n !== undefined) modelConfig.n = cfg.n as number;

      const out: any = { ...anyItem };
      if (Object.keys(modelConfig).length > 0) {
        out.modelConfig = { ...(anyItem.modelConfig ?? {}), ...modelConfig };
      }
      return out as typeof item;
    });

    super(aiImpl, {
      name: 'Cohere',
      apiURL: 'https://api.cohere.ai/v1',
      headers: async () => ({ Authorization: `Bearer ${apiKey}` }),
      modelInfo: axModelInfoCohere,
      defaults: { model: Config.model },
      supportFor: {
        functions: true,
        streaming: true,
        media: {
          images: {
            supported: false,
            formats: [],
            maxSize: 0,
            detailLevels: [] as ('high' | 'low' | 'auto')[],
          },
          audio: {
            supported: false,
            formats: [],
            maxDuration: 0,
          },
          files: {
            supported: false,
            formats: [],
            maxSize: 0,
            uploadMethod: 'none' as 'inline' | 'upload' | 'cloud' | 'none',
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
      },
      options,
      models: normalizedModels ?? models,
    });
  }
}

/**
 * Converts internal chat prompt format to Cohere chat history format
 * @param chatPrompt - Array of chat messages in internal format
 * @returns Formatted chat history for Cohere API
 */
function createHistory(
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
): AxAICohereChatRequest['chat_history'] {
  return chatPrompt.map((chat) => {
    let message = '';

    if (
      chat.role === 'system' ||
      chat.role === 'assistant' ||
      chat.role === 'user'
    ) {
      if (typeof chat.content === 'string') {
        message = chat.content;
      } else {
        throw new Error('Multi-modal content not supported');
      }
    }

    switch (chat.role) {
      case 'user':
        return { role: 'USER' as const, message };
      case 'system':
        return { role: 'SYSTEM' as const, message };
      case 'assistant': {
        const toolCalls = createToolCall(chat.functionCalls);
        return {
          role: 'CHATBOT' as const,
          message,
          tool_calls: toolCalls,
        };
      }
      case 'function': {
        const functionCalls = chatPrompt
          .map((v) => {
            if (v.role === 'assistant') {
              return v.functionCalls?.find((f) => f.id === chat.functionId);
            }
            return undefined;
          })
          .filter((v) => v !== undefined);

        const call = createToolCall(functionCalls)?.at(0);

        if (!call) {
          throw new Error('Function call not found');
        }

        const outputs = [{ result: chat.result }];
        return {
          role: 'TOOL' as const,
          tool_results: [
            {
              call,
              outputs,
            },
          ],
        };
      }
      default:
        throw new Error('Unknown role');
    }
  });
}

/**
 * Converts function calls from internal format to Cohere tool call format
 * @param functionCalls - Array of function calls from assistant messages
 * @returns Formatted tool calls for Cohere API or undefined if no function calls
 */
function createToolCall(
  functionCalls: Readonly<
    Extract<
      AxChatRequest['chatPrompt'][0],
      { role: 'assistant' }
    >['functionCalls']
  >
) {
  return functionCalls?.map((v) => {
    let parameters: any;
    if (typeof v.function.params === 'string') {
      const raw = v.function.params;
      if (raw.trim().length === 0) {
        parameters = {};
      } else {
        try {
          parameters = JSON.parse(raw);
        } catch {
          throw new Error(`Failed to parse function params JSON: ${raw}`);
        }
      }
    } else {
      parameters = v.function.params;
    }
    return { name: v.function.name, parameters };
  });
}
