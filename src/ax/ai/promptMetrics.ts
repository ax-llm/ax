import type { AxChatRequest } from './types.js';

/** @internal Count only prompt-visible text content across chat messages. */
export function countChatPromptContentChars(
  chatPrompt: Readonly<AxChatRequest['chatPrompt']> | undefined
): number {
  if (!chatPrompt || !Array.isArray(chatPrompt)) {
    return 0;
  }

  let totalLength = 0;

  for (const message of chatPrompt) {
    switch (message.role) {
      case 'system':
      case 'assistant':
        if (typeof message.content === 'string') {
          totalLength += message.content.length;
        }
        break;

      case 'user':
        if (typeof message.content === 'string') {
          totalLength += message.content.length;
          break;
        }

        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'text') {
              totalLength += part.text.length;
            }
          }
        }
        break;

      case 'function':
        if (typeof message.result === 'string') {
          totalLength += message.result.length;
        }
        break;
    }
  }

  return totalLength;
}
