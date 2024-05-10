import type {
  TextModelConfig,
  TextModelInfo,
  TextResponse
} from '../ai/types.js';
import { FunctionJSONSchema } from '../text/functions.js';

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

export type AITextRequestIdentity = {
  user?: string;
  organization?: string;
};

export type AITextBaseRequest = {
  identity?: Readonly<AITextRequestIdentity>;
};

export type AITextChatRequest = {
  chatPrompt: Readonly<
    | { role: 'system'; content: string }
    | { role: 'user'; content: string; name?: string }
    | {
        role: 'assistant';
        content: string | null;
        name?: string;
        functionCalls?: {
          id: string;
          type: 'function';
          // eslint-disable-next-line functional/functional-parameters
          function: { name: string; arguments?: string | object };
        }[];
      }
    | { role: 'function'; content: string; functionId: string }
  >[];
  functions?: Readonly<{
    name: string;
    description: string;
    parameters?: FunctionJSONSchema;
  }>[];
  functionCall?:
    | 'none'
    | 'auto'
    | { type: 'function'; function: { name: string } };
  modelConfig?: Readonly<TextModelConfig>;
  modelInfo?: Readonly<TextModelInfoWithProvider>;
} & AITextBaseRequest;

export type AITextEmbedRequest = {
  texts?: readonly string[];
  embedModelInfo?: Readonly<TextModelInfoWithProvider>;
} & AITextBaseRequest;

export type AITextTraceStepRequest = AITextChatRequest | AITextEmbedRequest;

export type AITextTraceStepResponse = Omit<TextResponse, 'sessionId'> & {
  modelResponseTime?: number;
  embedModelResponseTime?: number;
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
