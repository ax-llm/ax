import { Prompt, PromptUpdater } from '../ai/middleware.js';

import { RemoteMemoryStore } from './memory.js';
import { ExtendedIncomingMessage } from './types.js';
import { VectorMemoryStore } from './vector.js';

const promptUpdater = (
  debug: boolean,
  req: Readonly<ExtendedIncomingMessage>
): PromptUpdater | undefined => {
  return async (args) => {
    const prompt: Prompt[] = [];

    const rms = new RemoteMemoryStore(debug);
    const res1 = await rms.getMemory(req, args);
    if (res1) {
      prompt.push(...res1);
    }

    const vms = new VectorMemoryStore(debug);
    const res2 = await vms.getMemory(req, args);
    if (res2) {
      prompt.push(...res2);
    }

    console.log('prompt', prompt);

    return prompt;
  };
};

export const processAIRequest = async (
  debug: boolean,
  req: Readonly<ExtendedIncomingMessage>
): Promise<string | undefined> => {
  await req.middleware.addRequest(req.reqBody, promptUpdater(debug, req));

  if (req.middleware.isRequestUpdated()) {
    return await req.middleware.renderRequest();
  }
  return;
};
