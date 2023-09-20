import { PromptUpdater } from '../ai/parser';

import { MemoryFilter, RemoteMemoryStore } from './memory';
import { ExtendedIncomingMessage } from './types';

const promptUpdater = (
  debug: boolean,
  req: Readonly<ExtendedIncomingMessage>
): PromptUpdater | undefined => {
  if (!req.apiKey || !req.memory) {
    return;
  }

  const ms = new RemoteMemoryStore(debug, req.apiKey);
  const memory = req.memory;

  return async ({ user }) => {
    const filter: MemoryFilter = { limit: 10 };
    if (memory.indexOf('session') > -1) {
      filter.sessionId = req.sessionId;
    }
    if (memory.indexOf('user') > -1) {
      filter.user = user;
    }

    return await ms.fetch(filter);
  };
};

export const specialRequestHandler = async (
  debug: boolean,
  req: Readonly<ExtendedIncomingMessage>
) => {
  if (req.apiKey && req.memory) {
    await req.parser.addRequest(req.reqBody, promptUpdater(debug, req));
  }
  await req.parser.addRequest(req.reqBody);
};
