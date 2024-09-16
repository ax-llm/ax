import { IdSchema } from '@/local/other.js';
import { z } from 'zod';

export const baseChatReq = z.strictObject({
  mentions: z
    .strictObject({
      agentId: z.string()
    })
    .array()
    .nullable()
    .optional(),
  text: z
    .string()
    .min(1, 'Message is too short')
    .max(3000, 'Message is too long (max 3000 characters)')
});

export type BaseChatReq = z.infer<typeof baseChatReq>;

export const createChatReq = baseChatReq.extend({
  agentId: z.string(),
  messageIds: z.string().array().optional(),
  refChatId: z.string().optional()
});

export type CreateChatReq = z.infer<typeof createChatReq>;

export const getChatRes = z.strictObject({
  agent: z.strictObject({
    description: z.string().optional(),
    id: IdSchema,
    name: z.string()
  }),
  agents: z
    .strictObject({
      description: z.string().optional(),
      id: IdSchema,
      name: z.string()
    })
    .array()
    .optional(),
  id: IdSchema,
  isDone: z.boolean().optional(),
  isReferenced: z.boolean().optional(),
  title: z.string(),
  updatedAt: z.coerce.date(),
  user: z.strictObject({
    id: IdSchema,
    name: z.string(),
    picture: z.string().optional()
  })
});

export type GetChatRes = z.infer<typeof getChatRes>;

export type ListChatsRes = GetChatRes[];
