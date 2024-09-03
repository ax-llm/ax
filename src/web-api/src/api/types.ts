import { ai } from '@/types/agents';
import { ObjectId, UUID } from 'mongodb';
import { z } from 'zod';

export const agent = z.strictObject({
  aiBigModel: ai.extend({
    apiKeyId: z.string().optional()
  }),
  aiSmallModel: ai.extend({
    apiKeyId: z.string().optional()
  }),
  createdAt: z.coerce.date(),
  description: z.string().optional(),
  name: z.string(),
  updatedAt: z.coerce.date().optional()
});

export type Agent = z.infer<typeof agent>;

export const chat = z.strictObject({
  agentId: z.instanceof(ObjectId),
  createdAt: z.coerce.date(),
  title: z.string(),
  updatedAt: z.coerce.date().optional()
});

export type Chat = z.infer<typeof chat>;

export const message = z.strictObject({
  agentId: z.instanceof(ObjectId).optional(),
  chatId: z.instanceof(ObjectId),
  createdAt: z.coerce.date(),
  error: z.string().optional(),
  parentId: z.instanceof(ObjectId).optional(),
  processing: z.boolean().optional(),
  text: z.string().optional(),
  updatedAt: z.coerce.date().optional()
});

export type Message = z.infer<typeof message>;
