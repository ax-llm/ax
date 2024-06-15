import type { AIServiceOptions } from '../../text/types.js';
import {
  OpenAI,
  OpenAIBestConfig,
  OpenAICreativeConfig,
  OpenAIDefaultConfig,
  OpenAIFastConfig
} from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

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

export const AzureOpenAIBestConfig = OpenAIBestConfig;

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

    super.setName('Azure OpenAI');

    super.setAPIURL(
      new URL(
        `/openai/deployments/${deploymentName}?api-version=${version}`,
        host
      ).href
    );

    super.setHeaders({ 'api-key': apiKey });
  }
}
