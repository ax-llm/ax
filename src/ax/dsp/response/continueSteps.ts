import type { AxAIMemory } from '../../mem/types.js';
import type { InternalAxGenState } from './types.js';

export function shouldContinueSteps(
  mem: AxAIMemory,
  stopFunction: readonly string[] | undefined,
  states: InternalAxGenState[],
  sessionId?: string
) {
  const lastMemItem = mem.getLast(sessionId);

  if (!lastMemItem) {
    return true;
  }

  for (const [index, state] of states.entries()) {
    const stopFunctionExecuted = stopFunction
      ? Array.from(stopFunction).some((s) => state.functionsExecuted.has(s))
      : false;

    const chat = lastMemItem.chat[index];

    if (!chat) {
      throw new Error(`No chat message found for result (index: ${index})`);
    }

    const isFunction = lastMemItem.role === 'function';
    const isProcessor = lastMemItem.tags
      ? lastMemItem.tags.some((tag) => tag === 'processor')
      : false;

    if (isFunction && stopFunction && stopFunctionExecuted) {
      return false;
    }

    if (!(isFunction || isProcessor)) {
      return false;
    }
  }

  return true;
}
