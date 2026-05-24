import type { AxAIFeatures } from '../base.js';
import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js';
import type { AxAIServiceOptions } from '../types.js';

import { axModelInfoDeepSeek } from './info.js';
import { AxAIDeepSeekModel } from './types.js';

/**
 * Configuration type for DeepSeek AI models
 */
type DeepSeekConfig = AxAIOpenAIConfig<AxAIDeepSeekModel, undefined>;

type DeepSeekReasoningEffort =
  | NonNullable<AxAIOpenAIChatRequest<AxAIDeepSeekModel>['reasoning_effort']>
  | 'max';

type DeepSeekChatRequest<TModel> = AxAIOpenAIChatRequest<TModel> & {
  thinking?: { type: 'enabled' | 'disabled' };
};

const axAIDeepSeekSupportsToolChoice = (model: unknown): boolean => {
  switch (String(model)) {
    case AxAIDeepSeekModel.DeepSeekV4Flash:
    case AxAIDeepSeekModel.DeepSeekV4Pro:
    case AxAIDeepSeekModel.DeepSeekReasoner:
      return false;
    default:
      return true;
  }
};

const axAIDeepSeekSupportsThinking = (model: unknown): boolean => {
  switch (String(model)) {
    case AxAIDeepSeekModel.DeepSeekV4Flash:
    case AxAIDeepSeekModel.DeepSeekV4Pro:
      return true;
    default:
      return false;
  }
};

const axAIDeepSeekChatReqUpdater = <TModel>(
  req: Readonly<DeepSeekChatRequest<TModel>>,
  config: Readonly<AxAIServiceOptions>
): DeepSeekChatRequest<TModel> => {
  const nextReq = { ...req };

  if (axAIDeepSeekSupportsThinking(req.model)) {
    const thinkingEnabled =
      config.thinkingTokenBudget !== 'none' &&
      nextReq.reasoning_effort !== 'none' &&
      (config.thinkingTokenBudget !== undefined ||
        nextReq.reasoning_effort !== undefined);

    nextReq.thinking = {
      type: thinkingEnabled ? 'enabled' : 'disabled',
    };

    if (!thinkingEnabled) {
      delete nextReq.reasoning_effort;
    } else {
      switch (nextReq.reasoning_effort) {
        case 'xhigh':
          (
            nextReq as { reasoning_effort?: DeepSeekReasoningEffort }
          ).reasoning_effort = 'max';
          break;
        case 'minimal':
        case 'low':
        case 'medium':
        case undefined:
          nextReq.reasoning_effort = 'high';
          break;
      }

      delete nextReq.temperature;
      delete nextReq.top_p;
      delete nextReq.presence_penalty;
      delete nextReq.frequency_penalty;
    }
  }

  if (axAIDeepSeekSupportsToolChoice(req.model)) {
    return nextReq;
  }

  if (nextReq.tool_choice === 'none') {
    delete nextReq.tools;
  }
  delete nextReq.tool_choice;
  return nextReq;
};

/**
 * Creates the default configuration for DeepSeek AI with the V4 Flash model
 * @returns Default DeepSeek configuration with V4 Flash settings
 */
export const axAIDeepSeekDefaultConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekV4Flash,
    ...axBaseAIDefaultConfig(),
  });

/**
 * Creates a configuration optimized for code generation tasks using DeepSeek V4 Pro
 * @returns DeepSeek configuration with creative settings for coding tasks
 */
export const axAIDeepSeekCodeConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekV4Pro,
    ...axBaseAIDefaultCreativeConfig(),
  });

const axAIDeepSeekSupportFor = (model: AxAIDeepSeekModel): AxAIFeatures => ({
  functions: true,
  streaming: true,
  hasThinkingBudget: axAIDeepSeekSupportsThinking(model),
  hasShowThoughts: axAIDeepSeekSupportsThinking(model),
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
  thinking: axAIDeepSeekSupportsThinking(model),
  multiTurn: true,
});

/**
 * Arguments type for initializing DeepSeek AI instances
 * @template TModelKey - The model key type for type safety
 */
export type AxAIDeepSeekArgs<TModelKey> = AxAIOpenAIArgs<
  'deepseek',
  AxAIDeepSeekModel,
  undefined,
  TModelKey
>;

/**
 * DeepSeek AI client implementation extending OpenAI base functionality
 * Provides access to DeepSeek's language models through OpenAI-compatible API
 * @template TModelKey - The model key type for type safety
 */
export class AxAIDeepSeek<TModelKey> extends AxAIOpenAIBase<
  AxAIDeepSeekModel,
  undefined,
  TModelKey,
  DeepSeekChatRequest<AxAIDeepSeekModel>
> {
  /**
   * Creates a new DeepSeek AI client instance
   * @param args - Configuration arguments for the DeepSeek client
   * @param args.apiKey - DeepSeek API key for authentication
   * @param args.config - Optional configuration overrides
   * @param args.options - Optional client options
   * @param args.models - Optional model definitions
   * @param args.modelInfo - Optional additional model information
   * @throws {Error} When API key is not provided or empty
   */
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIDeepSeekArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set');
    }
    const Config = {
      ...axAIDeepSeekDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoDeepSeek, ...(modelInfo ?? [])];

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://api.deepseek.com',
      modelInfo,
      chatReqUpdater: axAIDeepSeekChatReqUpdater,
      supportFor: axAIDeepSeekSupportFor,
      models,
    });

    super.setName('DeepSeek');
  }
}
