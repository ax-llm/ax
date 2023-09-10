import { GoogleOptions } from './api';
import { GoogleChatRequest, GoogleCompletionRequest } from './types';

export const generateReq = (
  prompt: string,
  opt: Readonly<GoogleOptions>,
  stopSequences: readonly string[]
): GoogleCompletionRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'Google supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    instances: [{ prompt }],
    parameters: {
      maxOutputTokens: opt.maxTokens,
      temperature: opt.temperature,
      topP: opt.topP,
      topK: opt.topK,
    },
  };
};

export const generateChatReq = (
  prompt: string,
  opt: Readonly<GoogleOptions>,
  stopSequences: readonly string[]
): GoogleChatRequest => {
  if (stopSequences.length > 4) {
    throw new Error(
      'Google supports prompts with max 4 items in stopSequences'
    );
  }
  return {
    instances: [{ context: prompt, examples: [], messages: [] }],
    parameters: {
      maxOutputTokens: opt.maxTokens,
      temperature: opt.temperature,
      topP: opt.topP,
      topK: opt.topK,
    },
  };
};
