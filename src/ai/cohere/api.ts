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
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig
} from '../types.js';

import { axModelInfoCohere } from './info.js';
import {
  type AxCohereChatRequest,
  type AxCohereChatResponse,
  type AxCohereChatResponseDelta,
  type AxCohereConfig,
  AxCohereEmbedModel,
  type AxCohereEmbedRequest,
  type AxCohereEmbedResponse,
  AxCohereModel
} from './types.js';

export const axCohereDefaultConfig = (): AxCohereConfig =>
  structuredClone({
    model: AxCohereModel.Command,
    embedModel: AxCohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultConfig()
  });

export const axCohereCreativeConfig = (): AxCohereConfig =>
  structuredClone({
    model: AxCohereModel.CommandR,
    embedModel: AxCohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultCreativeConfig()
  });

export interface AxCohereArgs {
  apiKey: string;
  config: Readonly<AxCohereConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxCohere extends AxBaseAI<
  AxCohereChatRequest,
  AxCohereEmbedRequest,
  AxCohereChatResponse,
  AxCohereChatResponseDelta,
  AxCohereEmbedResponse
> {
  private config: AxCohereConfig;

  constructor({
    apiKey,
    config = axCohereDefaultConfig(),
    options
  }: Readonly<AxCohereArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    super({
      name: 'Cohere',
      apiURL: 'https://api.cohere.ai',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: axModelInfoCohere,
      models: { model: config.model },
      supportFor: { functions: false, streaming: true },
      options
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
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      endSequences: config.endSequences,
      stopSequences: config.stopSequences
    } as AxModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AxChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AxAIPromptConfig>
  ): [API, AxCohereChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    // const functionsList = req.functions
    //   ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`

    const lastChatMsg = req.chatPrompt.at(-1);
    const restOfChat = req.chatPrompt.slice(0, -1);

    const message = lastChatMsg?.content ?? '';
    const chatHistory = restOfChat
      .filter((chat) => chat.role !== 'function' || chat.content?.length > 0)
      .map((chat) => {
        let role: AxCohereChatRequest['chat_history'][0]['role'];
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
      AxCohereChatRequest['tools']
    >[0]['parameter_definitions'][0];

    const tools: AxCohereChatRequest['tools'] = req.functions?.map((v) => {
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

    type FnType = Extract<AxChatRequest['chatPrompt'][0], { role: 'function' }>;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const tool_results: AxCohereChatRequest['tool_results'] = (
      req.chatPrompt as FnType[]
    )
      .filter((chat) => chat.role === 'function')
      .map((chat) => {
        const fn = tools?.find((t) => t.name === chat.functionId);
        if (!fn) {
          throw new Error('AxFunction not found');
        }
        return {
          call: { name: fn.name, parameters: fn.parameter_definitions },
          outputs: [{ result: chat.content ?? '' }]
        };
      });

    const apiConfig = {
      name: '/v1/generate'
    };

    const reqValue: AxCohereChatRequest = {
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
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences
    };

    return [apiConfig, reqValue];
  };

  override generateEmbedReq = (
    req: Readonly<AxEmbedRequest>
  ): [API, AxCohereEmbedRequest] => {
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
      input_type: 'classification',
      truncate: ''
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxCohereChatResponse>
  ): AxChatResponse => {
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
      functionCalls =
        resp.tool_calls?.map((v) => {
          return {
            id: v.name,
            type: 'function' as const,
            function: { name: v.name, args: v.parameters }
          };
        }) ?? [];
    }

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

  override generateChatStreamResp = (
    resp: Readonly<AxCohereChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    const ss = state as {
      generation_id?: string;
    };

    if (resp.event_type === 'stream-start') {
      ss.generation_id = resp.generation_id;
    }

    const { results } = this.generateChatResp(resp);
    const result = results[0];
    if (!result) {
      throw new Error('No result');
    }

    result.id = ss.generation_id ?? '';
    return { results };
  };

  override generateEmbedResp = (
    resp: Readonly<AxCohereEmbedResponse>
  ): AxEmbedResponse => {
    return {
      remoteId: resp.id,
      embeddings: resp.embeddings
    };
  };
}
