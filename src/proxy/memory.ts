import { Prompt, PromptUpdaterArgs } from '../ai/middleware.js';
import { getMemory } from '../tracing/trace.js';

import { ExtendedIncomingMessage } from './types.js';

export class RemoteMemoryStore {
  getMemory = async (
    req: Readonly<ExtendedIncomingMessage>,
    { user }: Readonly<PromptUpdaterArgs>
  ): Promise<Prompt[] | undefined> => {
    const apiKey = req.llmClientAPIKey;
    if (!apiKey || apiKey === '') {
      return;
    }

    const memory = req.headers['x-llmclient-memory'] as string | undefined;
    if (!memory || memory === '') {
      return;
    }

    const filter: {
      sessionId?: string;
      user?: string;
      limit?: number;
    } = { limit: 10 };

    if (memory.indexOf('session') > -1) {
      filter.sessionId = req.sessionId;
    }
    if (memory.indexOf('user') > -1) {
      filter.user = user;
    }

    return await getMemory(apiKey, filter);
  };
}
