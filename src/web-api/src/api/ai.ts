import type { GetAIListRes } from '@/types/agents.js';
import type { Context } from 'hono';

import {
  AxAI,
  type AxAIArgs,
  type AxModelInfo,
  axModelInfoAnthropic,
  axModelInfoCohere,
  axModelInfoDeepSeek,
  axModelInfoGoogleGemini,
  axModelInfoGroq,
  axModelInfoHuggingFace,
  axModelInfoMistral,
  axModelInfoOpenAI,
  axModelInfoTogether
} from '@ax-llm/ax';
import { axModelInfoReka } from '@ax-llm/ax/ai/reka/info.js';

import type { Agent } from './types.js';

type AIList = Array<{
  id: string;
  models: AxModelInfo[];
  name: string;
}>;

export const aiList: AIList = [
  { id: 'openai', models: axModelInfoOpenAI, name: 'OpenAI' },
  {
    id: 'google-gemini',
    models: axModelInfoGoogleGemini,
    name: 'Google Gemini'
  },
  { id: 'anthropic', models: axModelInfoAnthropic, name: 'Anthropic' },
  { id: 'cohere', models: axModelInfoCohere, name: 'Cohere' },
  { id: 'together', models: axModelInfoTogether, name: 'Together' },
  { id: 'groq', models: axModelInfoGroq, name: 'Groq' },
  { id: 'huggingface', models: axModelInfoHuggingFace, name: 'Hugging Face' },
  { id: 'deepseek', models: axModelInfoDeepSeek, name: 'DeepSeek' },
  { id: 'mistral', models: axModelInfoMistral, name: 'Mistral' },
  { id: 'reka', models: axModelInfoReka, name: 'Reka' },
  { id: 'ollama', models: [], name: 'Ollama' }
] as const;

export const aiListHandler = () => async (c: Readonly<Context>) => {
  return c.json<GetAIListRes>(
    aiList.map((ai) => ({
      id: ai.id,
      models: ai.models.map((m) => ({
        id: m.name,
        inputTokenPrice: m.promptTokenCostPer1M,
        outputTokenPrice: m.promptTokenCostPer1M
      })),
      name: ai.name
    }))
  );
};

export const createAI = (agent: Readonly<Agent>, aiType: 'big' | 'small') => {
  let args: AxAIArgs | undefined;

  if (aiType === 'big') {
    args = {
      apiKey: agent.aiBigModel.apiKey ?? '',
      config: { model: agent.aiBigModel.model },
      name: agent.aiBigModel.id
    } as AxAIArgs;
  }

  if (aiType === 'small') {
    args = {
      apiKey: agent.aiSmallModel.apiKey ?? '',
      config: { model: agent.aiSmallModel.model },
      name: agent.aiSmallModel.id
    } as AxAIArgs;
  }
  if (!args) {
    throw new Error('Invalid AI type: ' + aiType);
  }
  return new AxAI(args);
};
