import { getModelInfo } from '@ax-llm/ax/dsp/modelinfo.js';
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

export const axAIAzureOpenAIDefaultConfig = axAIOpenAIDefaultConfig;

export const axAIAzureOpenAICreativeConfig = axAIOpenAICreativeConfig;

export const axAIAzureOpenAIFastConfig = axAIOpenAIFastConfig;

export const axAIAzureOpenAIBestConfig = axAIOpenAIBestConfig;

export type AxAIAzureOpenAIConfig = AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
>;
export type AxAIAzureOpenAIArgs = AxAIOpenAIArgs<
  'azure-openai',
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> & {
  resourceName: string;
  deploymentName: string;
  version?: string;
};

export class AxAIAzureOpenAI extends AxAIOpenAIBase<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
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
  }: Readonly<Omit<AxAIAzureOpenAIArgs, 'name'>>) {
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

    modelInfo = [...axModelInfoOpenAI, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIOpenAIModel) => {
      const mi = getModelInfo<AxAIOpenAIModel, AxAIOpenAIEmbedModel>({
        model,
        modelInfo,
        models,
      });
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.hasThinkingBudget ?? false,
        hasShowThoughts: mi?.hasShowThoughts ?? false,
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
        `/openai/deployments/${deploymentName}?api-version=${version}`,
        host
      ).href
    );

    super.setHeaders(async () => ({ 'api-key': apiKey }));
  }
}
