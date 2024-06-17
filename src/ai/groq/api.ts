import { axBaseAIDefaultConfig } from '../base.js';
import { AxOpenAI } from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

import { AxGroqModel } from './types.js';

type AxAxGroqAIConfig = AxOpenAIConfig;

const axGroqDefaultConfig = (): AxAxGroqAIConfig =>
  structuredClone({
    model: AxGroqModel.Llama3_70B,
    ...axBaseAIDefaultConfig()
  });

export interface AxAxGroqArgs {
  apiKey: string;
  config: Readonly<AxAxGroqAIConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxGroq extends AxOpenAI {
  constructor({
    apiKey,
    config = axGroqDefaultConfig(),
    options
  }: Readonly<AxAxGroqArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Groq API key not set');
    }
    super({
      apiKey,
      config,
      options: { ...options, streamingUsage: false },
      apiURL: 'https://api.groq.com/openai/v1',
      modelInfo: []
    });

    super.setName('AxGroq');
  }
}
