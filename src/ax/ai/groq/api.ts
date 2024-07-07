import { AxRateLimiterTokenUsage } from '../../util/rate-limit.js';
import { axBaseAIDefaultConfig } from '../base.js';
import { AxAIOpenAI } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions, AxRateLimiterFunction } from '../types.js';

import { AxAIGroqModel } from './types.js';

type AxAIGroqAIConfig = AxAIOpenAIConfig;

const axAIGroqDefaultConfig = (): AxAIGroqAIConfig =>
  structuredClone({
    model: AxAIGroqModel.Llama3_70B,
    ...axBaseAIDefaultConfig()
  });

export interface AxAIGroqArgs {
  name: 'groq';
  apiKey: string;
  config?: Readonly<Partial<AxAIGroqAIConfig>>;
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number };
}

export class AxAIGroq extends AxAIOpenAI {
  constructor({
    apiKey,
    config,
    options
  }: Readonly<Omit<AxAIGroqArgs, 'groq'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Groq API key not set');
    }
    const _config = {
      ...axAIGroqDefaultConfig(),
      ...config
    };

    const _options = {
      ...options,
      streamingUsage: false
    };

    super({
      apiKey,
      config: _config,
      options: _options,
      apiURL: 'https://api.groq.com/openai/v1',
      modelInfo: []
    });

    super.setName('Groq');
    this.setOptions(_options);
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
      debug: options?.debug
    });

    const rtFunc: AxRateLimiterFunction = async (func, info) => {
      const totalTokens = info.modelUsage?.totalTokens || 0;
      await rt.acquire(totalTokens);
      return await func();
    };

    return rtFunc;
  };
}
