import type { Context } from 'hono';

import type { HandlerContext } from './util.js';

export const readyHandler =
  (hc: Readonly<HandlerContext>) => async (c: Readonly<Context>) => {
    await hc.db.command({ ping: 1 });
    return c.json({ ok: true });
  };
