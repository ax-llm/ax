import { AIServiceOptions } from '../../text/types.js';
import { API } from '../../util/apicall.js';
import {
  OpenAI,
  OpenAICreativeConfig,
  OpenAIDefaultConfig,
  OpenAIFastConfig
} from '../openai/api.js';
import { OpenAIConfig } from '../openai/types.js';

/**
 * AzureOpenAI: API call details
 * @export
 */
export type AzureOpenAIApiConfig = API & {
  headers: { 'api-key'?: string };
};

/**
 * AzureOpenAI: Default Model options for text generation
 * @export
 */
export const AzureOpenAIDefaultConfig = OpenAIDefaultConfig;

/**
 * AzureOpenAI: Default model options for more creative text generation
 * @export
 */
export const AzureOpenAICreativeConfig = OpenAICreativeConfig;

/**
 * AzureOpenAI: Default model options for more fast text generation
 * @export
 */
export const AzureOpenAIFastConfig = OpenAIFastConfig;

export interface AzureOpenAIArgs {
  apiKey: string;
  resourceName: string;
  deploymentName: string;
  version?: string;
  config: Readonly<OpenAIConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * AzureOpenAI: AI Service
 * @export
 */
export class AzureOpenAI extends OpenAI {
  constructor({
    apiKey,
    resourceName,
    deploymentName,
    version = 'api-version=2024-02-15-preview',
    config,
    options
  }: Readonly<AzureOpenAIArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Azure OpenAPI API key not set');
    }
    if (!resourceName || resourceName === '') {
      throw new Error('Azure OpenAPI resource name not set');
    }
    if (!deploymentName || deploymentName === '') {
      throw new Error('Azure OpenAPI deployment id not set');
    }
    super({ apiKey, config, options });

    const host = resourceName.includes('://')
      ? resourceName
      : `https://${resourceName}.openai.azure.com/`;

    super.aiName = 'Azure OpenAI';
    super.apiURL = new URL(
      `/openai/deployments/${deploymentName}?api-version=${version}`,
      host
    ).href;
    super.headers = { 'api-key': apiKey };
  }
}
