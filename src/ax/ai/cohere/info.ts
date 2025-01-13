import type { AxModelInfo } from '../types.js'

import { AxAICohereEmbedModel, AxAICohereModel } from './types.js'

export const axModelInfoCohere: AxModelInfo[] = [
  {
    name: AxAICohereModel.CommandRPlus,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15,
  },
  {
    name: AxAICohereModel.CommandR,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
  },
  {
    name: AxAICohereModel.Command,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
  },
  {
    name: AxAICohereModel.CommandLight,
    currency: 'usd',
    promptTokenCostPer1M: 0.3,
    completionTokenCostPer1M: 0.6,
  },
  {
    name: AxAICohereEmbedModel.EmbedEnglishLightV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1,
  },
  {
    name: AxAICohereEmbedModel.EmbedEnglishV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1,
  },
  {
    name: AxAICohereEmbedModel.EmbedMultiLingualV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1,
  },
  {
    name: AxAICohereEmbedModel.EmbedMultiLingualLightV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1,
  },
]
