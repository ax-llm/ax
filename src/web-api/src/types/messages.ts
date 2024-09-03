import { z } from 'zod';

export const listChatMessagesRes = z
  .strictObject({
    agent: z
      .strictObject({
        id: z.string(),
        name: z.string()
      })
      .optional(),
    createdAt: z.coerce.date(),
    error: z.string().optional(),
    html: z.string().optional(),
    id: z.string(),
    processing: z.boolean().optional(),
    text: z.string().optional(),
    updatedAt: z.coerce.date().optional()
  })
  .array();

export type ListChatMessagesRes = z.infer<typeof listChatMessagesRes>;

export const createUpdateChatMessageReq = z.strictObject({
  messageId: z.string().optional(),
  text: z.string().min(1).max(500)
});

export type CreateUpdateChatMessageReq = z.infer<
  typeof createUpdateChatMessageReq
>;

export const updateChatMessageReq = z.strictObject({
  responseId: z.string()
});

export type UpdateChatMessageReq = z.infer<typeof updateChatMessageReq>;
