/* eslint-disable @typescript-eslint/naming-convention */
import { createHash } from 'crypto';

import type {
  AxChatResponse,
  AxChatResponseResult,
  AxModelInfo,
  AxTokenUsage
} from './types.js';

export const findItemByNameOrAlias = (
  list: readonly AxModelInfo[],
  name: string
): AxModelInfo | undefined => {
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

export interface mergeFunctionsState {
  lastId: string;
}

export function mergeFunctionCalls(
  // eslint-disable-next-line functional/prefer-immutable-types
  functionCalls: NonNullable<AxChatResponseResult['functionCalls']>,
  functionCallDeltas: Readonly<
    NonNullable<AxChatResponseResult['functionCalls']>
  >,
  // eslint-disable-next-line functional/prefer-immutable-types
  state?: mergeFunctionsState
): NonNullable<AxChatResponseResult['functionCalls']>[0] | undefined {
  for (const _fc of functionCallDeltas) {
    const fc = functionCalls.find((fc) => fc.id === _fc.id);

    if (fc) {
      if (
        typeof _fc.function.name == 'string' &&
        _fc.function.name.length > 0
      ) {
        fc.function.name += _fc.function.name;
      }

      if (
        typeof _fc.function.arguments == 'string' &&
        _fc.function.arguments.length > 0
      ) {
        fc.function.arguments += _fc.function.arguments;
      }

      if (typeof _fc.function.arguments == 'object') {
        fc.function.arguments = _fc.function.arguments;
      }
    } else {
      functionCalls.push(_fc);
    }

    if (!state) {
      continue;
    }

    let retFunc;
    if (state.lastId !== _fc.id) {
      retFunc = functionCalls.find((fc) => fc.id === state.lastId);
    }

    state.lastId = _fc.id;
    if (retFunc) {
      return retFunc;
    }
  }
}

export function mergeChatResponses(
  responses: readonly AxChatResponse[]
): AxChatResponse {
  const functionCalls: NonNullable<AxChatResponseResult['functionCalls']> = [];
  let content = '';

  // Variables to store the other overwritten values
  let lastSessionId: string | undefined;
  let lastRemoteId: string | undefined;
  let lastModelUsage: AxTokenUsage | undefined;
  let lastEmbedModelUsage: AxTokenUsage | undefined;
  let lastResults: readonly AxChatResponseResult[] = [];

  for (const response of responses) {
    for (const result of response.results ?? []) {
      if (result.content) {
        content += result.content;
      }
      if (result.functionCalls) {
        mergeFunctionCalls(functionCalls, result.functionCalls);
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
        content,
        functionCalls
      }
    ],
    modelUsage: lastModelUsage,
    embedModelUsage: lastEmbedModelUsage
  };
}

export const hashObject = (obj: object) => {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(obj));
  return hash.digest('hex');
};
