import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest
} from '../../types/index.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoCohere } from './info.js';
import {
  type CohereChatRequest,
  type CohereChatResponse,
  type CohereConfig,
  CohereEmbedModel,
  type CohereEmbedRequest,
  type CohereEmbedResponse,
  CohereModel
} from './types.js';

/**
 * Cohere: Default Model config for text generation
 * @export
 */
export const CohereDefaultConfig = (): CohereConfig => ({
  model: CohereModel.Command,
  embedModel: CohereEmbedModel.EmbedEnglishV30,
  maxTokens: 500,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  frequencyPenalty: 0.8
});

/**
 * Cohere: Default model config for more creative text generation
 * @export
 */
export const CohereCreativeConfig = (): CohereConfig => ({
  ...CohereDefaultConfig(),
  temperature: 0.7
});

export interface CohereArgs {
  apiKey: string;
  config: Readonly<CohereConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * Cohere: AI Service
 * @export
 */
export class Cohere extends BaseAI<
  CohereChatRequest,
  CohereEmbedRequest,
  CohereChatResponse,
  unknown,
  CohereEmbedResponse
> {
  private config: CohereConfig;

  constructor({
    apiKey,
    config = CohereDefaultConfig(),
    options
  }: Readonly<CohereArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    super({
      name: 'Cohere',
      apiURL: 'https://api.cohere.ai',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoCohere,
      models: { model: config.model },
      supportFor: { functions: false },
      options
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
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      endSequences: config.endSequences,
      stopSequences: config.stopSequences,
      returnLikelihoods: config.returnLikelihoods,
      logitBias: config.logitBias
    } as TextModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AITextChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, CohereChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    // const functionsList = req.functions
    //   ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`

    const lastChatMsg = req.chatPrompt.at(-1);
    const restOfChat = req.chatPrompt.slice(0, -1);

    const message = lastChatMsg?.content ?? '';
    const chatHistory = restOfChat
      .filter((chat) => chat.role !== 'function' || chat.content?.length > 0)
      .map((chat) => {
        let role: CohereChatRequest['chat_history'][0]['role'];
        switch (chat.role) {
          case 'user':
            role = 'USER';
            break;
          case 'system':
            role = 'SYSTEM';
            break;
          case 'assistant':
            role = 'CHATBOT';
            break;
          default:
            role = 'USER';
            break;
        }
        return { role, message: chat.content ?? '' };
      });

    type PropValue = NonNullable<
      CohereChatRequest['tools']
    >[0]['parameter_definitions'][0];

    const tools: CohereChatRequest['tools'] = req.functions?.map((v) => {
      const props: Record<string, PropValue> = {};
      if (v.parameters?.properties) {
        for (const [key, value] of Object.entries(v.parameters.properties)) {
          props[key] = {
            description: value.description,
            type: value.type,
            required: v.parameters.required?.includes(key) ?? false
          };
        }
      }
      return {
        name: v.name,
        description: v.description,
        parameter_definitions: props
      };
    });

    type fnType = Extract<
      AITextChatRequest['chatPrompt'][0],
      { role: 'function' }
    >;

    const tool_results: CohereChatRequest['tool_results'] = (
      req.chatPrompt as fnType[]
    )
      .filter((chat) => chat.role === 'function')
      .map((chat) => {
        const fn = tools?.find((t) => t.name === chat.functionId);
        if (!fn) {
          throw new Error('Function not found');
        }
        return {
          call: { name: fn.name, parameters: fn.parameter_definitions },
          outputs: [{ result: chat.content ?? '' }]
        };
      });

    const apiConfig = {
      name: '/v1/generate'
    };

    const reqValue: CohereChatRequest = {
      model,
      message,
      tools,
      tool_results,
      chat_history: chatHistory,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      k: req.modelConfig?.topK ?? this.config.topK,
      p: req.modelConfig?.topP ?? this.config.topP,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      end_sequences: this.config.endSequences,
      stop_sequences: req.modelConfig?.stop ?? this.config.stopSequences,
      return_likelihoods: this.config.returnLikelihoods,
      logit_bias: this.config.logitBias
    };

    return [apiConfig, reqValue];
  };

  override generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, CohereEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: '/v1/embed'
    };

    const reqValue = {
      model,
      texts: req.texts ?? [],
      truncate: this.config.truncate ?? ''
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<CohereChatResponse>
  ): TextResponse => {
    let finishReason: TextResponse['results'][0]['finishReason'];
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

    const functionCalls =
      resp.tool_calls?.map((v) => {
        return {
          id: v.name,
          type: 'function' as const,
          function: { name: v.name, args: v.parameters }
        };
      }) ?? [];

    return {
      results: [
        {
          id: resp.generation_id,
          content: resp.text,
          functionCalls,
          finishReason
        }
      ]
    };
  };

  override generateEmbedResp = (
    resp: Readonly<CohereEmbedResponse>
  ): EmbedResponse => {
    return {
      remoteId: resp.id,
      embeddings: resp.embeddings
    };
  };
}
