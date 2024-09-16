import { IdSchema } from '@/local/other.js';
import { z } from 'zod';

export const getMeRes = z.strictObject({
  id: IdSchema,
  name: z.string(),
  picture: z.string().optional()
});

export type GetMeRes = z.infer<typeof getMeRes>;

export const getUserRes = z.strictObject({
  id: IdSchema,
  name: z.string(),
  picture: z.string().optional()
});

export type GetUserRes = z.infer<typeof getUserRes>;
