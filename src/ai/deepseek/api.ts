import type { AIServiceOptions } from '../../text/types.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

import { DeepSeekModel } from './types.js';

type DeepSeekConfig = OpenAIConfig;

/**
 * DeepSeek: Default Model options for text generation
 * @export
 */
export const DeepSeekDefaultConfig = (): DeepSeekConfig => ({
  model: DeepSeekModel.DeepSeekChat,
  stream: false,
  suffix: null,
  maxTokens: 200,
  temperature: 0.1,
  topP: 0.9
});

/**
 * DeepSeek: Default Model options for text generation
 * @export
 */
export const DeepSeekCodeConfig = (): DeepSeekConfig => ({
  model: DeepSeekModel.DeepSeekCoder,
  stream: false,
  suffix: null,
  maxTokens: 200,
  temperature: 0.1,
  topP: 0.9
});

export interface DeepSeekArgs {
  apiKey: string;
  config: Readonly<DeepSeekConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * DeepSeek: AI Service
 * @export
 */
export class DeepSeek extends OpenAI {
  constructor({
    apiKey,
    config = DeepSeekDefaultConfig(),
    options
  }: Readonly<DeepSeekArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set');
    }

    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.deepseek.com'
    });

    super.setName('DeepSeek');
  }
}
