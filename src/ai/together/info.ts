import { TextModelInfo } from '../types';

import { TogetherChatModel, TogetherLanguageModel } from './types';

export const modelInfoTogether: TextModelInfo[] = [
  {
    name: TogetherLanguageModel.Llama27B,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.Llama27BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 4000,
  },
  {
    name: TogetherLanguageModel.Llama213B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.Llama213BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 4000,
  },
  {
    name: TogetherLanguageModel.Llama270B,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.Llama270BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.RedPajamaIncite7BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 2048,
  },
  {
    name: TogetherChatModel.GPTNeoXTChatBase20B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 2048,
  },
  {
    name: TogetherChatModel.Falcon7BInstruct,
    currency: 'usd',
    promptTokenCostPer1K: 0.006,
    completionTokenCostPer1K: 0.006,
    maxTokens: 2048,
  },
  // {
  //   id: TogetherLanguageModel.TogetherComputerMPT30BInstruct,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.006,
  //   completionTokenCostPer1K: 0.006,
  //   maxTokens: 2048,
  // },
  // {
  //   id: TogetherChatModel.LMSysVicuna7BDeltaV11,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.000252,
  //   completionTokenCostPer1K: 0.000252,
  //   maxTokens: 2048,
  // },
  // {
  //   id: TogetherChatModel.LMsysVicuna13BDeltaV11,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.003,
  //   completionTokenCostPer1K: 0.003,
  //   maxTokens: 2048,
  // },
  // {
  //   id: TogetherChatModel.MosaiclMPT7BChat,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.001,
  //   completionTokenCostPer1K: 0.001,
  //   maxTokens: 2048,
  // },

  // {
  //   id: TogetherChatModel.TatsuLabAlpaca7BWdiff,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.006,
  //   completionTokenCostPer1K: 0.006,
  //   maxTokens: 2048,
  // },
];
