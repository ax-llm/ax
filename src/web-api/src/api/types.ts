import { ai } from '@/types/agents';
import { ObjectId } from 'mongodb';
import { z } from 'zod';

export const user = z.strictObject({
  createdAt: z.coerce.date(),
  email: z.string().email(),
  emailVerified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
  updatedAt: z.coerce.date().optional()
});

export type User = z.infer<typeof user>;

export const agent = z.strictObject({
  aiBigModel: ai,
  aiSmallModel: ai,
  createdAt: z.coerce.date(),
  description: z.string(),
  name: z.string(),
  updatedAt: z.coerce.date().optional(),
  userId: z.instanceof(ObjectId)
});

export type Agent = z.infer<typeof agent>;

export const chat = z.strictObject({
  agentId: z.instanceof(ObjectId),
  agents: z.instanceof(ObjectId).array().optional(),
  createdAt: z.coerce.date(),
  isDone: z.boolean().optional(),
  refMessageIds: z.instanceof(ObjectId).array().optional(),
  title: z.string(),
  updatedAt: z.coerce.date().optional(),
  userId: z.instanceof(ObjectId),
  users: z.instanceof(ObjectId).array().optional()
});

export type Chat = z.infer<typeof chat>;

export const message = z.strictObject({
  agentId: z.instanceof(ObjectId).optional(),
  chatId: z.instanceof(ObjectId),
  createdAt: z.coerce.date(),
  error: z.string().optional(),
  mentions: z
    .strictObject({
      agentId: z.instanceof(ObjectId)
    })
    .array()
    .optional(),
  parentId: z.instanceof(ObjectId).optional(),
  processing: z.boolean().optional(),
  text: z.string().optional(),
  threadId: z.instanceof(ObjectId).optional(),
  updatedAt: z.coerce.date().optional()
});

export type Message = z.infer<typeof message>;
