import type { AxModelInfo } from '../types.js';

import { AxAIWebLLMModel } from './types.js';

/**
 * WebLLM model information
 * Note: WebLLM runs models locally in the browser, so there are no API costs
 * However, we include context window and capability information
 */
export const axModelInfoWebLLM: AxModelInfo[] = [
  // Llama 3.1 series
  {
    name: AxAIWebLLMModel.Llama31_8B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0, // Local inference - no cost
    completionTokenCostPer1M: 0, // Local inference - no cost
    contextWindow: 128000,
    maxTokens: 4096,
  },
  {
    name: AxAIWebLLMModel.Llama31_70B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 128000,
    maxTokens: 4096,
    isExpensive: true, // Large model - requires significant compute
  },
  
  // Llama 3.2 series
  {
    name: AxAIWebLLMModel.Llama32_1B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 128000,
    maxTokens: 2048,
  },
  {
    name: AxAIWebLLMModel.Llama32_3B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 128000,
    maxTokens: 2048,
  },
  
  // Mistral series
  {
    name: AxAIWebLLMModel.Mistral7B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 32768,
    maxTokens: 4096,
  },
  
  // Phi series
  {
    name: AxAIWebLLMModel.Phi35_Mini_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 128000,
    maxTokens: 4096,
  },
  
  // Gemma series
  {
    name: AxAIWebLLMModel.Gemma2_2B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 8192,
    maxTokens: 2048,
  },
  {
    name: AxAIWebLLMModel.Gemma2_9B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 8192,
    maxTokens: 2048,
  },
  
  // Qwen series
  {
    name: AxAIWebLLMModel.Qwen2_5_0_5B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 32768,
    maxTokens: 2048,
  },
  {
    name: AxAIWebLLMModel.Qwen2_5_1_5B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 32768,
    maxTokens: 2048,
  },
  {
    name: AxAIWebLLMModel.Qwen2_5_3B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 32768,
    maxTokens: 2048,
  },
  {
    name: AxAIWebLLMModel.Qwen2_5_7B_Instruct,
    currency: 'usd',
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    contextWindow: 32768,
    maxTokens: 4096,
  },
];