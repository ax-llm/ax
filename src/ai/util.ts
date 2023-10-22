import {
  AITextChatPromptItem,
  AITextChatRequest,
  AITextCompletionRequest
} from '../tracing/types';

import { TextModelInfo, TextResponse, TextResponseResult } from './types';

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

export function convertToChatRequest(
  req: Readonly<AITextCompletionRequest>,
  systemRole = 'system',
  userRole = 'user'
): AITextChatRequest {
  if (!req.prompt || req.prompt.length === 0) {
    throw new Error('Prompt is required');
  }
  const chatPrompt = [];

  if (req.systemPrompt && req.systemPrompt.length > 0) {
    chatPrompt.push({ text: req.systemPrompt, role: systemRole });
  }

  chatPrompt.push({ text: req.prompt, role: userRole });

  return {
    ...req,
    chatPrompt
  };
}

export function convertToCompletionRequest(
  chatRequest: Readonly<AITextChatRequest>
): AITextCompletionRequest {
  // Extract the text from the first chatPrompt item, if available
  const promptContent = chatRequest.chatPrompt
    ? chatRequest.chatPrompt.map((item) => item.text).join('\n')
    : '';

  // Create a completion request using the extracted content
  return {
    prompt: promptContent,
    ...chatRequest
  };
}

export function convertToChatPromptItem(
  responseResult: Readonly<TextResponseResult>
): AITextChatPromptItem {
  // Extract the functionCall if it exists and map the args field
  const functionCall = responseResult.functionCall
    ? {
        name: responseResult.functionCall.name,
        args: responseResult.functionCall.args
      }
    : undefined;

  return {
    text: responseResult.text,
    role: responseResult.role ?? functionCall ? 'assistant' : 'system',
    name: responseResult.id,
    functionCall
  };
}

const functionCallRe = /(\w+)\((.*)\)/s;

export const parseFunction = (
  value: string
): { name: string; args: string } | undefined => {
  let v: string[] | null;

  // extract function calls
  if ((v = functionCallRe.exec(value)) !== null) {
    return {
      name: v[1].trim(),
      args: v[2].trim()
    };
  }
  return;
};

export const parseAndAddFunction = (res: Readonly<TextResponse>) => {
  res.results.forEach((v) => {
    if (!v.functionCall) {
      const _fn = parseFunction(v.text);
      if (_fn) {
        v.functionCall = _fn;
        v.role = 'assistant';
      }
    }
  });
};
