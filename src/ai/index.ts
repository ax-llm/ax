import { Anthropic } from './anthropic/api.js';
import { AzureOpenAI } from './azure-openai/api.js';
import { Cohere } from './cohere/api.js';
import { Google } from './google/api.js';
import { HuggingFace } from './huggingface/api.js';
import { OpenAI } from './openai/api.js';
import { Together } from './together/api.js';

export * from './openai/index.js';
export * from './azure-openai/index.js';
export * from './huggingface/index.js';
export * from './together/index.js';
export * from './cohere/index.js';
export * from './google/index.js';
export * from './anthropic/index.js';
export * from './types.js';

// export * from './betty.js';
// export * from './alephalpha.js';

export const AI = (
  name: string,
  apiKey: string,
  options: Record<string, string>
) => {
  switch (name) {
    case 'openai':
      return new OpenAI(apiKey);
    case 'azure-openai':
      return new AzureOpenAI(apiKey, options.host, options.deploymentName);
    case 'huggingface':
      return new HuggingFace(apiKey);
    case 'together':
      return new Together(apiKey);
    case 'cohere':
      return new Cohere(apiKey);
    case 'google':
      return new Google(apiKey, options.projectId);
    case 'anthropic':
      return new Anthropic(apiKey);
  }
  throw new Error(`Unknown AI ${name}`);
};
