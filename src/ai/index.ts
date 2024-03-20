import { Anthropic, AnthropicArgs } from './anthropic/api.js';
import { AzureOpenAI, AzureOpenAIArgs } from './azure-openai/api.js';
import { Cohere, CohereArgs } from './cohere/api.js';
import { GoogleGemini, GoogleGeminiArgs } from './google-gemini/api.js';
import { GooglePalm2, GooglePalm2Args } from './google-palm2/api.js';
import { Groq, GroqArgs } from './groq/api.js';
import { HuggingFace, HuggingFaceArgs } from './huggingface/api.js';
import { OpenAI, OpenAIArgs } from './openai/api.js';
import { Together, TogetherArgs } from './together/api.js';

export * from './openai/index.js';
export * from './azure-openai/index.js';
export * from './huggingface/index.js';
export * from './together/index.js';
export * from './cohere/index.js';
export * from './google-palm2/index.js';
export * from './google-gemini/index.js';
export * from './anthropic/index.js';
export * from './types.js';

export type AIName =
  | 'openai'
  | 'azure-openai'
  | 'huggingface'
  | 'together'
  | 'cohere'
  | 'google-palm2'
  | 'google-gemini'
  | 'anthropic'
  | 'groq';

export const AI = (
  name: AIName,
  options: Readonly<
    | AzureOpenAIArgs
    | GooglePalm2Args
    | OpenAIArgs
    | TogetherArgs
    | AnthropicArgs
    | CohereArgs
    | HuggingFaceArgs
    | GroqArgs
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
    case 'google-palm2':
      return new GooglePalm2(options as GooglePalm2Args);
    case 'google-gemini':
      return new GoogleGemini(options as GoogleGeminiArgs);
    case 'anthropic':
      return new Anthropic(options as AnthropicArgs);
    default:
      throw new Error(`Unknown AI ${name}`);
  }
};
