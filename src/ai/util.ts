import crypto from 'crypto';

import Ajv, { Schema } from 'ajv';
import JSON5 from 'json5';

import {
  AITextChatPromptItem,
  AITextChatRequest,
  AITextCompletionRequest,
  AITextRequestFunction
} from '../tracing/types.js';

import {
  TextModelInfo,
  TextResponse,
  TextResponseFunctionCall,
  TextResponseResult,
  TokenUsage
} from './types.js';

const ajv = new Ajv();

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
        args: JSON.stringify(responseResult.functionCall.args)
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

export const parseAndAddFunction = (
  functions: Readonly<AITextRequestFunction[]>,
  res: Readonly<TextResponse>
) => {
  res.results.forEach((v) => {
    // if (!v.functionCall) {
    //   const _fn = parseFunction(v.text);
    //   if (_fn) {
    //     v.functionCall = _fn;
    //     v.role = 'assistant';
    //   }
    // }

    if (!v.functionCall) {
      return;
    }

    const fnSpec = functions.find((f) => f.name === v.functionCall?.name);
    if (!fnSpec) {
      throw new Error(`Function ${v.functionCall?.name} not found`);
    }

    const funcArgJSON = v.functionCall.args as string;

    // if (
    //   fnSpec &&
    //   (fnSpec.parameters as JSONSchemaType<object>)?.type === 'object' &&
    //   !funcArgJSON.startsWith('{') &&
    //   !funcArgJSON.startsWith('[')
    // ) {
    //   funcArgJSON = `{${funcArgJSON}}`;
    // }

    let obj: object;

    try {
      obj = JSON5.parse<object>(funcArgJSON);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const parseError = (e as Error).message.replace(/^JSON5:/, '');
      throw new Error(`Error parsing function:\n${funcArgJSON}\n${parseError}`);
    }

    const valid = ajv.validate(fnSpec.parameters as Schema, obj);
    if (!valid) {
      throw new Error(ajv.errorsText());
    }

    v.functionCall.args = obj;
  });
};

export function mergeTextResponses(
  responses: readonly TextResponse[]
): TextResponse {
  let concatenatedText = '';
  const concatenatedFunctionCalls: TextResponseFunctionCall[] = [];

  // Variables to store the other overwritten values
  let lastSessionId: string | undefined;
  let lastRemoteId: string | undefined;
  let lastModelUsage: TokenUsage | undefined;
  let lastEmbedModelUsage: TokenUsage | undefined;
  let lastResults: readonly TextResponseResult[] = [];

  for (const response of responses) {
    for (const result of response.results) {
      if (result.text) {
        concatenatedText += result.text;
      }
      if (result.functionCall) {
        concatenatedFunctionCalls.push(result.functionCall);
      }
    }

    // Overwrite other values
    lastSessionId = response.sessionId;
    lastRemoteId = response.remoteId;
    lastModelUsage = response.modelUsage;
    lastEmbedModelUsage = response.embedModelUsage;
    lastResults = response.results;
  }

  return {
    sessionId: lastSessionId,
    remoteId: lastRemoteId,
    results: [
      {
        ...lastResults[0],
        text: concatenatedText,
        functionCall: concatenatedFunctionCalls.length
          ? {
              name: concatenatedFunctionCalls.map((fc) => fc.name).join(','),
              args: concatenatedFunctionCalls.map((fc) => fc.args).join(',')
            }
          : undefined
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
