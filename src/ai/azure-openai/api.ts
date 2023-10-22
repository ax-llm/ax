import { AIServiceOptions } from '../../text/types.js';
import { API } from '../../util/apicall.js';
import { OpenAI } from '../openai/api.js';
import {
  OpenAIEmbedModels,
  OpenAIModel,
  OpenAIOptions
} from '../openai/types.js';

/**
 * AzureOpenAI: API call details
 * @export
 */
export type AzureOpenAIApiConfig = API & {
  headers: { 'api-key'?: string };
};

export const enum AzureOpenAIApi {
  Completion = '/completions',
  Chat = '/chat/completions',
  Embed = '/embeddings',
  Transcribe = '/audio/transcriptions'
}

/**
 * AzureOpenAI: Default Model options for text generation
 * @export
 */
export const AzureOpenAIDefaultOptions = (): OpenAIOptions => ({
  model: OpenAIModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  maxTokens: 500,
  temperature: 0.45,
  topP: 1
});

/**
 * AzureOpenAI: Default model options for more creative text generation
 * @export
 */
export const AzureOpenAICreativeOptions = (): OpenAIOptions => ({
  ...AzureOpenAIDefaultOptions(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.9
});

/**
 * AzureOpenAI: Default model options for more fast text generation
 * @export
 */
export const AzureOpenAIFastOptions = (): OpenAIOptions => ({
  ...AzureOpenAIDefaultOptions(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.45
});

/**
 * AzureOpenAI: AI Service
 * @export
 */
export class AzureOpenAI extends OpenAI {
  constructor(
    apiKey: string,
    host: string,
    deploymentName: string,
    options: Readonly<OpenAIOptions> = AzureOpenAIDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    if (!apiKey || apiKey === '') {
      throw new Error('Azure OpenAPI API key not set');
    }
    if (!host || host === '') {
      throw new Error('Azure OpenAPI host not set (host)');
    }
    if (!deploymentName || deploymentName === '') {
      throw new Error('Azure OpenAPI deployment name not set (deploymentName)');
    }
    super(apiKey, options, otherOptions);

    if (!host.includes('://')) {
      host = `https://${host}.openai.azure.com/`;
    }

    super.aiName = 'Azure OpenAI';
    super.apiURL = new URL(`/openai/deployments/${deploymentName}`, host).href;
    super.headers = { 'api-key': apiKey };
  }
}
