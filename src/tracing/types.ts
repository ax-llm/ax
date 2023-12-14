import { TextModelConfig, TextModelInfo, TextResponse } from '../ai/types.js';
import { PromptFunctionFunc } from '../text/types.js';

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
  functionCall?: AITextRequestFunctionCall;
};

export type AITextRequestFunction = {
  name: string;
  description: string;
  parameters: unknown;
  func?: PromptFunctionFunc;
};

export type AITextRequestFunctionCall = {
  name: string;
  args?: string;
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

export type AITextBaseRequest = {
  identity?: Readonly<AITextRequestIdentity>;
};

export type AITextCompletionRequest = {
  systemPrompt?: string;
  prompt?: string;
  functions?: Readonly<AITextRequestFunction>[];
  functionCall?: string | { name: string };
  modelConfig?: Readonly<TextModelConfig>;
  modelInfo?: Readonly<TextModelInfoWithProvider>;
} & AITextBaseRequest;

export type AITextChatRequest = {
  chatPrompt?: Readonly<AITextChatPromptItem>[];
  functions?: Readonly<AITextRequestFunction>[];
  functionCall?: string | { name: string };
  modelConfig?: Readonly<TextModelConfig>;
  modelInfo?: Readonly<TextModelInfoWithProvider>;
} & AITextBaseRequest;

export type AITextEmbedRequest = {
  texts?: readonly string[];
  embedModelInfo?: Readonly<TextModelInfoWithProvider>;
} & AITextBaseRequest;

export type AITextTraceStepRequest =
  | AITextCompletionRequest
  | AITextChatRequest
  | AITextEmbedRequest;

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
