// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import { IdSchema } from '@/local/other.js';
import { z } from 'zod';

export const getAIListRes = z
  .strictObject({
    id: z.string(),
    models: z
      .strictObject({
        id: z.string(),
        inputTokenPrice: z.number().optional(),
        outputTokenPrice: z.number().optional()
      })
      .array(),
    name: z.string()
  })
  .array();

export type GetAIListRes = z.infer<typeof getAIListRes>;

export const aiList = [
  'openai',
  'google-gemini',
  'azure-openai',
  'anthropic',
  'cohere',
  'together',
  'groq',
  'huggingface',
  'deepseek',
  'mistral',
  'ollama',
  'reka'
] as const;

export const ai = z.strictObject({
  apiKey: z.string().optional(),
  apiKeyId: z.string().optional(),
  id: z.enum(aiList),
  model: z.string().min(3).max(100)
});

export const createUpdateAgentReq = z.strictObject({
  aiBigModel: ai,
  aiSmallModel: ai,
  description: z.string().min(3).max(2000),
  name: z.string().min(3).max(100)
});

export type CreateUpdateAgentReq = z.infer<typeof createUpdateAgentReq>;

export const getAgentRes = z.strictObject({
  aiBigModel: ai
    .omit({ apiKey: true })
    .extend({ apiKeyId: z.string().optional() }),
  aiSmallModel: ai
    .omit({ apiKey: true })
    .extend({ apiKeyId: z.string().optional() }),
  createdAt: z.date(),
  description: z.string().optional(),
  id: IdSchema,
  name: z.string(),
  updatedAt: z.date().optional()
});

export type GetAgentRes = z.infer<typeof getAgentRes>;

export const listAgentsRes = z
  .strictObject({
    description: z.string().optional(),
    id: IdSchema,
    name: z.string()
  })
  .array();

export type ListAgentsRes = z.infer<typeof listAgentsRes>;
