import {
  AxAIOpenAI,
  axAIOpenAIBestConfig,
  axAIOpenAICreativeConfig,
  axAIOpenAIDefaultConfig,
  axAIOpenAIFastConfig,
} from '../openai/api.js'
import type {
  AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from '../openai/types.js'
import type { AxAIServiceOptions } from '../types.js'

export const axAIAzureOpenAIDefaultConfig = axAIOpenAIDefaultConfig

export const axAIAzureOpenAICreativeConfig = axAIOpenAICreativeConfig

export const axAIAzureOpenAIFastConfig = axAIOpenAIFastConfig

export const axAIAzureOpenAIBestConfig = axAIOpenAIBestConfig

export interface AxAIAzureOpenAIArgs {
  name: 'azure-openai'
  apiKey: string
  resourceName: string
  deploymentName: string
  version?: string
  config?: Readonly<Partial<AxAIOpenAIConfig>>
  options?: Readonly<AxAIServiceOptions>
  modelMap?: Record<string, AxAIOpenAIModel | AxAIOpenAIEmbedModel>
}

export class AxAIAzureOpenAI extends AxAIOpenAI {
  constructor({
    apiKey,
    resourceName,
    deploymentName,
    version = 'api-version=2024-02-15-preview',
    config,
    options,
    modelMap,
  }: Readonly<Omit<AxAIAzureOpenAIArgs, 'name'>>) {
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
    super({ apiKey, config: _config, options, modelMap })

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
