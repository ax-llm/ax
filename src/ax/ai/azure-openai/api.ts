import {
  type AxAIOpenAIArgs,
  AxAIOpenAIBase,
  axAIOpenAIBestConfig,
  axAIOpenAICreativeConfig,
  axAIOpenAIDefaultConfig,
  axAIOpenAIFastConfig,
} from '../openai/api.js'
import { axModelInfoOpenAI } from '../openai/info.js'
import type {
  AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from '../openai/types.js'

export const axAIAzureOpenAIDefaultConfig = axAIOpenAIDefaultConfig

export const axAIAzureOpenAICreativeConfig = axAIOpenAICreativeConfig

export const axAIAzureOpenAIFastConfig = axAIOpenAIFastConfig

export const axAIAzureOpenAIBestConfig = axAIOpenAIBestConfig

export type AxAIAzureOpenAIConfig = AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
>
export type AxAIAzureOpenAIArgs = AxAIOpenAIArgs<
  'azure-openai',
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> & {
  resourceName: string
  deploymentName: string
  version?: string
}

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
  }: Readonly<Omit<AxAIAzureOpenAIArgs, 'name' | 'modelInfo'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Azure OpenAPI API key not set')
    }
    if (!resourceName || resourceName === '') {
      throw new Error('Azure OpenAPI resource name not set')
    }
    if (!deploymentName || deploymentName === '') {
      throw new Error('Azure OpenAPI deployment id not set')
    }
    const _config = {
      ...axAIAzureOpenAIDefaultConfig(),
      ...config,
    }
    super({
      apiKey,
      config: _config,
      options,
      models,
      modelInfo: axModelInfoOpenAI,
      supportFor: (model: AxAIOpenAIModel) => {
        const modelInf = axModelInfoOpenAI.find((m) => m.name === model)
        return {
          functions: true,
          streaming: true,
          hasThinkingBudget: modelInf?.hasThinkingBudget ?? false,
          hasShowThoughts: modelInf?.hasShowThoughts ?? false,
        }
      },
    })

    const host = resourceName.includes('://')
      ? resourceName
      : `https://${resourceName}.openai.azure.com/`

    super.setName('Azure OpenAI')

    super.setAPIURL(
      new URL(
        `/openai/deployments/${deploymentName}?api-version=${version}`,
        host
      ).href
    )

    super.setHeaders(async () => ({ 'api-key': apiKey }))
  }
}
