import type { AxAPI } from '../../util/apicall.js'
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import type {
  AxAIPromptConfig,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxInternalChatRequest,
  AxModelConfig,
} from '../types.js'

import { axModelInfoHuggingFace } from './info.js'
import {
  type AxAIHuggingFaceConfig,
  AxAIHuggingFaceModel,
  type AxAIHuggingFaceRequest,
  type AxAIHuggingFaceResponse,
} from './types.js'

export const axAIHuggingFaceDefaultConfig = (): AxAIHuggingFaceConfig =>
  structuredClone({
    model: AxAIHuggingFaceModel.MetaLlama270BChatHF,
    ...axBaseAIDefaultConfig(),
  })

export const axAIHuggingFaceCreativeConfig = (): AxAIHuggingFaceConfig =>
  structuredClone({
    model: AxAIHuggingFaceModel.MetaLlama270BChatHF,
    ...axBaseAIDefaultCreativeConfig(),
  })

export interface AxAIHuggingFaceArgs {
  name: 'huggingface'
  apiKey: string
  config?: Readonly<Partial<AxAIHuggingFaceConfig>>
  options?: Readonly<AxAIServiceOptions>
  modelMap?: Record<string, AxAIHuggingFaceModel>
}

class AxAIHuggingFaceImpl
  implements
    AxAIServiceImpl<
      AxAIHuggingFaceRequest,
      unknown,
      AxAIHuggingFaceResponse,
      unknown,
      unknown
    >
{
  constructor(private config: AxAIHuggingFaceConfig) {}

  getModelConfig(): AxModelConfig {
    const { config } = this
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      n: config.n,
      presencePenalty: config.presencePenalty,
    } as AxModelConfig
  }

  createChatReq = (
    req: Readonly<AxInternalChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AxAIPromptConfig>
  ): [AxAPI, AxAIHuggingFaceRequest] => {
    const model = req.model

    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : ''

    const prompt = req.chatPrompt
      ?.map((msg) => {
        switch (msg.role) {
          case 'user':
            return `User: ${msg.content}`
          case 'system':
            return `System: ${msg.content}`
          case 'function':
            return `Function Result: ${msg.result}`
          case 'assistant': {
            const fc = msg.functionCalls
              ?.map((fc) => {
                const args =
                  typeof fc.function.params === 'string'
                    ? fc.function.params
                    : JSON.stringify(fc.function.params)

                return `${fc.function.name}(${args})`
              })
              .join('\n')
            if (fc) {
              return `Assistant: ${msg.content}\n Functions:\n${fc}`
            }
            return `Assistant: ${msg.content}`
          }
          default:
            throw new Error(`Unknown role`)
        }

        //return `${msg.role}: ${msg.content}`;
      })
      .join('\n')

    const inputs = `${functionsList} ${prompt}`.trim()

    const apiConfig = {
      name: '/models',
    }

    const reqValue: AxAIHuggingFaceRequest = {
      model,
      inputs,
      parameters: {
        max_new_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
        repetition_penalty:
          req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        top_p: req.modelConfig?.topP ?? this.config.topP,
        top_k: req.modelConfig?.topK ?? this.config.topK,
        return_full_text: this.config.returnFullText,
        num_return_sequences: this.config.n,
        do_sample: this.config.doSample,
        max_time: this.config.maxTime,
      },
      options: {
        use_cache: this.config.useCache,
        wait_for_model: this.config.waitForModel,
      },
    }

    return [apiConfig, reqValue]
  }

  createChatResp = (
    resp: Readonly<AxAIHuggingFaceResponse>
  ): AxChatResponse => {
    return {
      results: [
        {
          content: resp.generated_text,
        },
      ],
    }
  }
}

export class AxAIHuggingFace extends AxBaseAI<
  AxAIHuggingFaceRequest,
  unknown,
  AxAIHuggingFaceResponse,
  unknown,
  unknown
> {
  constructor({
    apiKey,
    config,
    options,
    modelMap,
  }: Readonly<Omit<AxAIHuggingFaceArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('HuggingFace API key not set')
    }
    const _config = {
      ...axAIHuggingFaceDefaultConfig(),
      ...config,
    }

    const aiImpl = new AxAIHuggingFaceImpl(_config)

    super(aiImpl, {
      name: 'HuggingFace',
      apiURL: 'https://api-inference.huggingface.co',
      headers: async () => ({ Authorization: `Bearer ${apiKey}` }),
      modelInfo: axModelInfoHuggingFace,
      models: { model: _config.model },
      options,
      supportFor: { functions: false, streaming: false },
      modelMap,
    })
  }
}
