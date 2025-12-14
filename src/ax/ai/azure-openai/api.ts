import { getModelInfo } from '../../dsp/modelinfo.js';
import {
  type AxAIOpenAIArgs,
  AxAIOpenAIBase,
  axAIOpenAIBestConfig,
  axAIOpenAICreativeConfig,
  axAIOpenAIDefaultConfig,
  axAIOpenAIFastConfig,
} from '../openai/api.js';
import type {
  AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from '../openai/chat_types.js';
import { axModelInfoOpenAI } from '../openai/info.js';

const normalizeAzureApiVersion = (version: string): string => {
  const v = version.trim();
  if (!v) return v;

  // Accept both "2024-10-21" and "api-version=2024-10-21" (and similar)
  if (v.includes('api-version=')) {
    const start = v.indexOf('api-version=');
    const paramStr = v.slice(start);
    const params = new URLSearchParams(paramStr);
    const apiVersion = params.get('api-version');

    return apiVersion ?? v;
  }

  return v;
};

const azureSupportsStructuredOutputs = (apiVersion: string): boolean => {
  // Azure structured outputs support was added in 2024-08-01-preview and later.
  const m = apiVersion.match(/^(\d{4}-\d{2}-\d{2})/);

  if (!m) return false;

  return m[1] >= '2024-08-01';
};

export const axAIAzureOpenAIDefaultConfig = axAIOpenAIDefaultConfig;

export const axAIAzureOpenAICreativeConfig = axAIOpenAICreativeConfig;

export const axAIAzureOpenAIFastConfig = axAIOpenAIFastConfig;

export const axAIAzureOpenAIBestConfig = axAIOpenAIBestConfig;

export type AxAIAzureOpenAIConfig = AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
>;
export type AxAIAzureOpenAIArgs<TModelKey> = AxAIOpenAIArgs<
  'azure-openai',
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel,
  TModelKey
> & {
  resourceName: string;
  deploymentName: string;
  version?: string;
};

export class AxAIAzureOpenAI<TModelKey> extends AxAIOpenAIBase<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel,
  TModelKey
> {
  constructor({
    apiKey,
    resourceName,
    deploymentName,
    version = 'api-version=2024-02-15-preview',
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIAzureOpenAIArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Azure OpenAPI API key not set');
    }
    if (!resourceName || resourceName === '') {
      throw new Error('Azure OpenAPI resource name not set');
    }
    if (!deploymentName || deploymentName === '') {
      throw new Error('Azure OpenAPI deployment id not set');
    }

    const Config = {
      ...axAIAzureOpenAIDefaultConfig(),
      ...config,
    };

    const apiVersion = normalizeAzureApiVersion(version);
    const supportsStructured = azureSupportsStructuredOutputs(apiVersion);

    modelInfo = [...axModelInfoOpenAI, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIOpenAIModel) => {
      const mi = getModelInfo<AxAIOpenAIModel, AxAIOpenAIEmbedModel, TModelKey>(
        {
          model,
          modelInfo,
          models,
        }
      );
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        structuredOutputs:
          supportsStructured && (mi?.supported?.structuredOutputs ?? false),
        functionCot: false,
        media: {
          images: {
            supported: true,
            formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            maxSize: 20 * 1024 * 1024, // 20MB
            detailLevels: ['high', 'low', 'auto'] as (
              | 'high'
              | 'low'
              | 'auto'
            )[],
          },
          audio: {
            supported: false,
            formats: [],
            maxDuration: 0,
          },
          files: {
            supported: false,
            formats: [],
            maxSize: 0,
            uploadMethod: 'none' as 'inline' | 'upload' | 'cloud' | 'none',
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: mi?.supported?.thinkingBudget ?? false,
        multiTurn: true,
      };
    };

    super({
      apiKey,
      config: Config,
      options,
      models,
      modelInfo,
      supportFor,
    });

    const host = resourceName.includes('://')
      ? resourceName
      : `https://${resourceName}.openai.azure.com/`;

    super.setName('Azure OpenAI');

    super.setAPIURL(
      new URL(
        `/openai/deployments/${deploymentName}?api-version=${apiVersion}`,
        host
      ).href
    );

    super.setHeaders(async () => ({ 'api-key': apiKey }));
  }
}
