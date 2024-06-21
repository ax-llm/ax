import { axBaseAIDefaultConfig } from '../base.js';
import { AxAIOpenAI } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

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
  config: Readonly<AxAIGroqAIConfig>;
  options?: Readonly<AxAIServiceOptions>;
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
    super({
      apiKey,
      config: _config,
      options: { ...options, streamingUsage: false },
      apiURL: 'https://api.groq.com/openai/v1',
      modelInfo: []
    });

    super.setName('Groq');
  }
}
