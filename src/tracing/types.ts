import { JSONSchemaType } from 'ajv';

import { TextModelConfig, TextResponse, TextModelInfo } from '../ai/types';

export type APIError = {
  pathname: string;
  statusCode: number;
  statusMessage?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headers?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any;
};

export type ParsingError = { message: string; value: string };

export type TextModelInfoWithProvider = TextModelInfo & { provider: string };

export type AITextChatPromptItem = {
  text: string;
  role: string;
  name?: string;
  // eslint-disable-next-line functional/functional-parameters
  functionCall?: { name: string; arguments: string }[];
};

export type AITextRequestFunction = {
  name: string;
  description?: string;
  parameters: JSONSchemaType<unknown>;
};

export type AITextResponseFunction = {
  name: string;
  args?: string;
  result?: string;
};

export type AITextRequestIdentity = {
  user?: string;
  organization?: string;
};

export type AITextTraceStepRequest = {
  prompt?: string;
  chatPrompt?: Readonly<AITextChatPromptItem>[];
  systemPrompt?: string;
  texts?: readonly string[];
  functions?: Readonly<AITextRequestFunction>[];
  functionCall?: string;
  modelConfig?: Readonly<TextModelConfig>;
  modelInfo?: Readonly<TextModelInfoWithProvider>;
  embedModelInfo?: Readonly<TextModelInfoWithProvider>;
  identity?: Readonly<AITextRequestIdentity>;
};

export type AITextTraceStepResponse = Omit<TextResponse, 'sessionId'> & {
  modelResponseTime?: number;
  embedModelResponseTime?: number;
  functions?: Readonly<AITextResponseFunction>[];
  parsingError?: Readonly<ParsingError>;
  apiError?: Readonly<APIError>;
};

export type AITextTraceStep = {
  traceId: string;
  sessionId?: string;
  request: AITextTraceStepRequest;
  response: AITextTraceStepResponse;
  createdAt: string;
};
