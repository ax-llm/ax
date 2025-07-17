import { axBaseAIDefaultConfig } from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js';
import type { AxAIServiceOptions, AxModelInfo } from '../types.js';

import { axModelInfoMistral } from './info.js';
import { type AxAIMistralEmbedModels, AxAIMistralModel } from './types.js';

type AxAIMistralConfig = AxAIOpenAIConfig<
  AxAIMistralModel,
  AxAIMistralEmbedModels
>;

export const axAIMistralDefaultConfig = (): AxAIMistralConfig =>
  structuredClone({
    model: AxAIMistralModel.MistralSmall,
    ...axBaseAIDefaultConfig(),
    topP: 1,
  });

export const axAIMistralBestConfig = (): AxAIMistralConfig =>
  structuredClone({
    ...axAIMistralDefaultConfig(),
    model: AxAIMistralModel.MistralLarge,
  });

export type AxAIMistralChatRequest = Omit<
  AxAIOpenAIChatRequest<AxAIMistralModel>,
  'max_completion_tokens' | 'stream_options' | 'messages'
> & {
  max_tokens?: number;
  messages: (
    | { role: 'system'; content: string }
    | {
        role: 'user';
        content:
          | string
          | (
              | {
                  type: 'text';
                  text: string;
                }
              | {
                  type: 'image_url';
                  image_url: string;
                }
            )[];
        name?: string;
      }
    | {
        role: 'assistant';
        content: string;
        name?: string;
        tool_calls?: {
          type: 'function';
          function: {
            name: string;
            // eslint-disable-next-line functional/functional-parameters
            arguments?: string;
          };
        }[];
      }
    | { role: 'tool'; content: string; tool_call_id: string }
  )[];
};

export type AxAIMistralArgs<TModelKey> = AxAIOpenAIArgs<
  'mistral',
  AxAIMistralModel,
  AxAIMistralEmbedModels,
  TModelKey
> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number };
  modelInfo?: AxModelInfo[];
};

export class AxAIMistral<TModelKey> extends AxAIOpenAIBase<
  AxAIMistralModel,
  AxAIMistralEmbedModels,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIMistralArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set');
    }
    const Config = {
      ...axAIMistralDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoMistral, ...(modelInfo ?? [])];

    const supportFor = {
      functions: true,
      streaming: true,
      hasThinkingBudget: false,
      hasShowThoughts: false,
    };

    // Chat request updater to add Grok's search parameters
    const chatReqUpdater = (
      req: Readonly<AxAIOpenAIChatRequest<AxAIMistralModel>>
    ): AxAIMistralChatRequest => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { max_completion_tokens, messages, ...result } =
        req as AxAIOpenAIChatRequest<AxAIMistralModel>;

      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(result as any),
        messages: this.updateMessages(messages),
        max_tokens: max_completion_tokens,
      };
    };

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo,
      models,
      supportFor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chatReqUpdater: chatReqUpdater as any,
    });

    super.setName('Mistral');
  }

  private updateMessages(
    messages: AxAIOpenAIChatRequest<AxAIMistralModel>['messages']
  ) {
    const messagesUpdated: AxAIOpenAIChatRequest<AxAIMistralModel>['messages'] =
      [];

    if (!Array.isArray(messages)) {
      return messages;
    }

    for (const message of messages) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        const contentUpdated = message.content.map((item) => {
          if (
            typeof item === 'object' &&
            item !== null &&
            'image_url' in item
          ) {
            return {
              type: 'image_url' as const,
              image_url: { url: item.image_url?.url },
            };
          }
          return item;
        });
        messagesUpdated.push({ ...message, content: contentUpdated });
      } else {
        messagesUpdated.push(message);
      }
    }

    return messagesUpdated;
  }
}
