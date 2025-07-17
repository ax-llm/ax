import { AxRateLimiterTokenUsage } from '../../util/rate-limit.js';
import { axBaseAIDefaultConfig } from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';
import type {
  AxAIServiceOptions,
  AxModelInfo,
  AxRateLimiterFunction,
} from '../types.js';

import { axModelInfoGroq } from './info.js';
import { AxAIGroqModel } from './types.js';

type AxAIGroqAIConfig = AxAIOpenAIConfig<AxAIGroqModel, undefined>;

const axAIGroqDefaultConfig = (): AxAIGroqAIConfig =>
  structuredClone({
    model: AxAIGroqModel.Llama33_70B,
    ...axBaseAIDefaultConfig(),
  });

export type AxAIGroqArgs<TModelKey = string> = AxAIOpenAIArgs<
  'groq',
  AxAIGroqModel,
  undefined,
  TModelKey
> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number };
  modelInfo?: AxModelInfo[];
};

export class AxAIGroq<TModelKey = string> extends AxAIOpenAIBase<
  AxAIGroqModel,
  undefined,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIGroqArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Groq API key not set');
    }
    const Config = {
      ...axAIGroqDefaultConfig(),
      ...config,
    };

    const Options = {
      ...options,
      streamingUsage: false,
    };

    modelInfo = [...axModelInfoGroq, ...(modelInfo ?? [])];

    const supportFor = {
      functions: true,
      streaming: true,
      hasThinkingBudget: false,
      hasShowThoughts: false,
    };

    super({
      apiKey,
      config: Config,
      options: Options,
      modelInfo,
      apiURL: 'https://api.groq.com/openai/v1',
      models,
      supportFor,
    });

    super.setName('Groq');
    this.setOptions(Options);
  }

  override setOptions = (options: Readonly<AxAIServiceOptions>) => {
    const rateLimiter = this.newRateLimiter(options);
    super.setOptions({ ...options, rateLimiter });
  };

  private newRateLimiter = (options: Readonly<AxAIGroqArgs['options']>) => {
    if (options?.rateLimiter) {
      return options.rateLimiter;
    }

    const tokensPerMin = options?.tokensPerMinute ?? 4800;
    const rt = new AxRateLimiterTokenUsage(tokensPerMin, tokensPerMin / 60, {
      debug: options?.debug,
    });

    const rtFunc: AxRateLimiterFunction = async (func, info) => {
      const totalTokens = info.modelUsage?.tokens?.totalTokens || 0;
      await rt.acquire(totalTokens);
      return await func();
    };

    return rtFunc;
  };
}
