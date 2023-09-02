import { JSONSchemaType } from 'ajv';

import {
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from '../ai/types';

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

export type AIGenerateTextChatPromptItem = {
  text: string;
  role: string;
  name?: string;
  // eslint-disable-next-line functional/functional-parameters
  functionCall?: { name: string; arguments: string }[];
};

export type AIGenerateTextRequestFunction = {
  name: string;
  description?: string;
  parameters: JSONSchemaType<unknown>;
};

export type AIGenerateTextResponseFunction = {
  name: string;
  args?: string;
  result?: string;
};

export type AIGenerateTextRequestIdentity = {
  user?: string;
  organization?: string;
};

export type AIGenerateTextTraceStepRequest = {
  prompt?: string;
  chatPrompt?: Readonly<AIGenerateTextChatPromptItem>[];
  systemPrompt?: string;
  texts?: readonly string[];
  functions?: Readonly<AIGenerateTextRequestFunction>[];
  functionCall?: string;
  modelConfig?: Readonly<GenerateTextModelConfig>;
  modelInfo?: Readonly<TextModelInfoWithProvider>;
  embedModelInfo?: Readonly<TextModelInfoWithProvider>;
  identity?: Readonly<AIGenerateTextRequestIdentity>;
};

export type AIGenerateTextTraceStepResponse = Omit<
  GenerateTextResponse,
  'sessionId'
> & {
  modelResponseTime?: number;
  embedModelResponseTime?: number;
  functions?: Readonly<AIGenerateTextResponseFunction>[];
  parsingError?: Readonly<ParsingError>;
  apiError?: Readonly<APIError>;
};

export type AIGenerateTextTraceStep = {
  traceId: string;
  sessionId?: string;
  request: AIGenerateTextTraceStepRequest;
  response: AIGenerateTextTraceStepResponse;
  createdAt: string;
};
