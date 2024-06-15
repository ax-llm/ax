import { Anthropic, type AnthropicArgs } from './anthropic/api.js';
import { AzureOpenAI, type AzureOpenAIArgs } from './azure-openai/api.js';
import { Cohere, type CohereArgs } from './cohere/api.js';
import { DeepSeek, type DeepSeekArgs } from './deepseek/api.js';
import { GoogleGemini, type GoogleGeminiArgs } from './google-gemini/api.js';
import { Groq, type GroqArgs } from './groq/api.js';
import { HuggingFace, type HuggingFaceArgs } from './huggingface/api.js';
import { Mistral, type MistralArgs } from './mistral/api.js';
import { Ollama, type OllamaArgs } from './ollama/api.js';
import { OpenAI, type OpenAIArgs } from './openai/api.js';
import { Together, type TogetherArgs } from './together/api.js';

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

export type AIName =
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

export const AI = (
  name: AIName,
  options: Readonly<
    | AzureOpenAIArgs
    | OpenAIArgs
    | TogetherArgs
    | AnthropicArgs
    | CohereArgs
    | HuggingFaceArgs
    | GroqArgs
    | MistralArgs
    | DeepSeekArgs
    | OllamaArgs
  >
) => {
  switch (name) {
    case 'openai':
      return new OpenAI(options as OpenAIArgs);
    case 'azure-openai':
      return new AzureOpenAI(options as AzureOpenAIArgs);
    case 'huggingface':
      return new HuggingFace(options as HuggingFaceArgs);
    case 'groq':
      return new Groq(options as GroqArgs);
    case 'together':
      return new Together(options as TogetherArgs);
    case 'cohere':
      return new Cohere(options as CohereArgs);
    case 'google-gemini':
      return new GoogleGemini(options as GoogleGeminiArgs);
    case 'anthropic':
      return new Anthropic(options as AnthropicArgs);
    case 'mistral':
      return new Mistral(options as MistralArgs);
    case 'deepseek':
      return new DeepSeek(options as DeepSeekArgs);
    case 'ollama':
      return new Ollama(options as OllamaArgs);
    default:
      throw new Error(`Unknown AI ${name}`);
  }
};
