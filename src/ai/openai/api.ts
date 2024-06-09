import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest
} from '../../types/index.js';
import type { API } from '../../util/apicall.js';
import {
  BaseAI,
  BaseAIDefaultConfig,
  BaseAIDefaultCreativeConfig
} from '../base.js';
import type {
  EmbedResponse,
  TextModelConfig,
  TextResponse,
  TextResponseResult
} from '../types.js';

import { modelInfoOpenAI } from './info.js';
import {
  OpenAIAudioModel,
  type OpenAIChatRequest,
  type OpenAIChatResponse,
  type OpenAIChatResponseDelta,
  type OpenAIConfig,
  OpenAIEmbedModels,
  type OpenAIEmbedRequest,
  type OpenAIEmbedResponse,
  OpenAIModel
} from './types.js';

/**
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultConfig = (): OpenAIConfig =>
  structuredClone({
    model: OpenAIModel.GPT35Turbo,
    embedModel: OpenAIEmbedModels.TextEmbedding3Small,
    audioModel: OpenAIAudioModel.Whisper1,
    ...BaseAIDefaultConfig()
  });

/**
 * OpenAI: Default model options to use the more advanced model
 * @export
 */
export const OpenAIBestConfig = (): OpenAIConfig =>
  structuredClone({
    ...OpenAIDefaultConfig(),
    model: OpenAIModel.GPT4Turbo
  });

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeConfig = (): OpenAIConfig =>
  structuredClone({
    model: OpenAIModel.GPT4Turbo,
    embedModel: OpenAIEmbedModels.TextEmbedding3Small,
    audioModel: OpenAIAudioModel.Whisper1,
    ...BaseAIDefaultCreativeConfig()
  });

/**
 * OpenAI: Default model options for more fast text generation
 * @export
 */
export const OpenAIFastConfig = (): OpenAIConfig => ({
  ...OpenAIDefaultConfig(),
  model: OpenAIModel.GPT35Turbo
});

export interface OpenAIArgs {
  apiKey: string;
  apiURL?: string;
  config?: Readonly<OpenAIConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI extends BaseAI<
  OpenAIChatRequest,
  OpenAIEmbedRequest,
  OpenAIChatResponse,
  OpenAIChatResponseDelta,
  OpenAIEmbedResponse
> {
  private config: OpenAIConfig;

  constructor({
    apiKey,
    config = OpenAIDefaultConfig(),
    options,
    apiURL
  }: Readonly<OpenAIArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set');
    }
    super({
      name: 'OpenAI',
      apiURL: apiURL ? apiURL : 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoOpenAI,
      models: { model: config.model, embedModel: config.embedModel },
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
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      topP: config.topP,
      n: config.n,
      stream: config.stream
    };
  }

  override generateChatReq = (
    req: Readonly<AITextChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, OpenAIChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: '/chat/completions',
      headers: {
        ...(req.identity?.organization
          ? { 'OpenAI-Organization': req.identity?.organization }
          : null)
      }
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

    const reqValue: OpenAIChatRequest = {
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
      user: req.identity?.user ?? this.config.user,
      organization: req.identity?.organization,
      ...(frequencyPenalty ? { frequency_penalty: frequencyPenalty } : {}),
      ...(stream
        ? { stream: true, stream_options: { include_usage: true } }
        : {})
    };

    return [apiConfig, reqValue];
  };

  override generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, OpenAIEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: '/embeddings',
      headers: {
        ...(req.identity?.organization
          ? { 'OpenAI-Organization': req.identity?.organization }
          : null)
      }
    };

    const reqValue = {
      model: model,
      input: req.texts
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<OpenAIChatResponse>
  ): TextResponse => {
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
    resp: Readonly<OpenAIChatResponseDelta>,
    state: object
  ): TextResponse => {
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
          .filter(Boolean) as NonNullable<TextResponseResult['functionCalls']>;

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
    resp: Readonly<OpenAIEmbedResponse>
  ): EmbedResponse => {
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
  finishReason: OpenAIChatResponse['choices'][0]['finish_reason']
): TextResponseResult['finishReason'] => {
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

// async _transcribe(
//   file: string,
//   prompt?: string,
//   options?: Readonly<AITranscribeConfig>
// ): Promise<TranscriptResponse> {
//   const res = await this.apiCallWithUpload<
//     OpenAIAudioRequest,
//     OpenAIAudioResponse,
//     OpenAIApiConfig
//   >(
//     this.createAPI(OpenAIApi.Transcribe),
//     generateAudioReq(this.options, prompt, options?.language),
//     file
//   );

//   const { duration, segments } = res;
//   return {
//     duration,
//     segments: segments.map((v) => ({
//       id: v.id,
//       start: v.start,
//       end: v.end,
//       text: v.text,
//     })),
//   };
// }

// export const generateAudioReq = (
//   opt: Readonly<OpenAIConfig>,
//   prompt?: string,
//   language?: string
// ): OpenAIAudioRequest => {
//   if (!opt.audioModel) {
//     throw new Error('OpenAI audio model not set');
//   }

//   return {
//     model: opt.audioModel,
//     prompt,
//     temperature: opt.temperature,
//     language,
//     response_format: 'verbose_json',
//   };
// };
