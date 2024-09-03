import { z } from 'zod';

export const createChatReq = z.strictObject({
  agentId: z.string(),
  text: z.string().min(1).max(500)
});

export type CreateChatReq = z.infer<typeof createChatReq>;

export const getChatRes = z.strictObject({
  agent: z.strictObject({
    description: z.string(),
    id: z.string(),
    name: z.string()
  }),
  id: z.string(),
  title: z.string()
});

export type GetChatRes = z.infer<typeof getChatRes>;

export const listChatsRes = z
  .strictObject({
    id: z.string(),
    title: z.string()
  })
  .array();

export type ListChatsRes = z.infer<typeof listChatsRes>;
