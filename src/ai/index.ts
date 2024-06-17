import { AxAnthropic, type AxAnthropicArgs } from './anthropic/api.js';
import { AxAzureOpenAI, type AxAzureOpenAIArgs } from './azure-openai/api.js';
import { AxCohere, type AxCohereArgs } from './cohere/api.js';
import { AxDeepSeek, type AxDeepSeekArgs } from './deepseek/api.js';
import {
  AxGoogleGemini,
  type AxGoogleGeminiArgs
} from './google-gemini/api.js';
import { type AxAxGroqArgs, AxGroq } from './groq/api.js';
import { AxHuggingFace, type AxHuggingFaceArgs } from './huggingface/api.js';
import { AxMistral, type AxMistralArgs } from './mistral/api.js';
import { AxOllama, type AxOllamaArgs } from './ollama/api.js';
import { AxOpenAI, type AxOpenAIArgs } from './openai/api.js';
import { AxTogether, type AxTogetherArgs } from './together/api.js';

export * from './openai/index.js';
export * from './azure-openai/index.js';
export * from './huggingface/index.js';
export * from './together/index.js';
export * from './cohere/index.js';
export * from './google-gemini/index.js';
export * from './anthropic/index.js';
export * from './groq/index.js';
export * from './mistral/index.js';
export * from './deepseek/index.js';
export * from './ollama/index.js';
export * from './types.js';
export * from './balance.js';
export * from './base.js';

export type { API } from '../util/apicall.js';

export type AxAIName =
  | 'openai'
  | 'azure-openai'
  | 'huggingface'
  | 'together'
  | 'cohere'
  | 'google-gemini'
  | 'anthropic'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'ollama';

export const axAI = (
  name: AxAIName,
  options: Readonly<
    | AxAzureOpenAIArgs
    | AxOpenAIArgs
    | AxTogetherArgs
    | AxAnthropicArgs
    | AxCohereArgs
    | AxHuggingFaceArgs
    | AxAxGroqArgs
    | AxMistralArgs
    | AxDeepSeekArgs
    | AxOllamaArgs
  >
) => {
  switch (name) {
    case 'openai':
      return new AxOpenAI(options as AxOpenAIArgs);
    case 'azure-openai':
      return new AxAzureOpenAI(options as AxAzureOpenAIArgs);
    case 'huggingface':
      return new AxHuggingFace(options as AxHuggingFaceArgs);
    case 'groq':
      return new AxGroq(options as AxAxGroqArgs);
    case 'together':
      return new AxTogether(options as AxTogetherArgs);
    case 'cohere':
      return new AxCohere(options as AxCohereArgs);
    case 'google-gemini':
      return new AxGoogleGemini(options as AxGoogleGeminiArgs);
    case 'anthropic':
      return new AxAnthropic(options as AxAnthropicArgs);
    case 'mistral':
      return new AxMistral(options as AxMistralArgs);
    case 'deepseek':
      return new AxDeepSeek(options as AxDeepSeekArgs);
    case 'ollama':
      return new AxOllama(options as AxOllamaArgs);
    default:
      throw new Error(`Unknown AI ${name}`);
  }
};
