import {
  AxOpenAI,
  axOpenAIBestConfig,
  axOpenAICreativeConfig,
  axOpenAIDefaultConfig,
  axOpenAIFastConfig
} from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

export const axAzureOpenAIDefaultConfig = axOpenAIDefaultConfig;

export const axAzureOpenAICreativeConfig = axOpenAICreativeConfig;

export const axAzureOpenAIFastConfig = axOpenAIFastConfig;

export const axAzureOpenAIBestConfig = axOpenAIBestConfig;

export interface AxAzureOpenAIArgs {
  apiKey: string;
  resourceName: string;
  deploymentName: string;
  version?: string;
  config: Readonly<AxOpenAIConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxAzureOpenAI extends AxOpenAI {
  constructor({
    apiKey,
    resourceName,
    deploymentName,
    version = 'api-version=2024-02-15-preview',
    config,
    options
  }: Readonly<AxAzureOpenAIArgs>) {
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
