import crypto from 'crypto';

import type { AITextChatRequest } from '../tracing/types.js';

import type {
  TextModelInfo,
  TextResponse,
  TextResponseResult,
  TokenUsage
} from './types.js';

export const findItemByNameOrAlias = (
  list: readonly TextModelInfo[],
  name: string
): TextModelInfo | undefined => {
  for (const item of list) {
    if (item.name === name || item.aliases?.includes(name)) {
      return item;
    }
  }
  return undefined;
};

export const uniqBy = <T>(
  array: readonly T[],
  uniqueField: (value: T) => unknown
): T[] => {
  const uniqueValues = new Map();

  array.forEach((value: T) => {
    const field = uniqueField(value);

    if (!uniqueValues.has(field)) {
      uniqueValues.set(field, value);
    }
  });

  return Array.from(uniqueValues.values());
};

export function convertToChatPromptItem({
  content,
  name,
  functionCalls
}: Readonly<TextResponseResult>): AITextChatRequest['chatPrompt'][0] {
  return { content, role: 'assistant', name, functionCalls };
}

const functionCallRe = /(\w+)\((.*)\)/s;

export const parseFunction = (
  value: string
): { name: string; args?: string } | undefined => {
  let v: string[] | null;

  // extract function calls
  if ((v = functionCallRe.exec(value)) !== null) {
    const name = v.at(1)?.trim();
    const args = v.at(2)?.trim();
    if (!name || name) {
      throw new Error(`Invalid function format: ${value}`);
    }
    return { name, args };
  }
  return;
};

export function mergeTextResponses(
  responses: readonly TextResponse[]
): TextResponse {
  let concatenatedText = '';
  const concatenatedFunctionCalls: TextResponse['results'][0]['functionCalls'] =
    [];

  // Variables to store the other overwritten values
  let lastSessionId: string | undefined;
  let lastRemoteId: string | undefined;
  let lastModelUsage: TokenUsage | undefined;
  let lastEmbedModelUsage: TokenUsage | undefined;
  let lastResults: readonly TextResponseResult[] = [];

  for (const response of responses) {
    for (const result of response.results ?? []) {
      if (result.content) {
        concatenatedText += result.content;
      }
      const fc = result.functionCalls?.at(0);
      if (fc) {
        concatenatedFunctionCalls.push(fc);
      }
    }

    // Overwrite other values
    lastSessionId = response.sessionId;
    lastRemoteId = response.remoteId;
    lastModelUsage = response.modelUsage;
    lastEmbedModelUsage = response.embedModelUsage;
    lastResults = response.results ?? [];
  }

  return {
    sessionId: lastSessionId,
    remoteId: lastRemoteId,
    results: [
      {
        ...lastResults[0],
        content: concatenatedText,
        functionCalls: concatenatedFunctionCalls
      }
    ],
    modelUsage: lastModelUsage,
    embedModelUsage: lastEmbedModelUsage
  };
}

export const hashObject = (obj: object) => {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(obj));
  return hash.digest('hex');
};
