import { JSONSchemaType } from 'ajv';

import {
  EmbedResponse,
  RateLimiterFunction,
  TextModelConfig,
  TextModelInfo,
  TextResponse,
  TextResponseResult
} from '../ai/types';
import { TextRequestBuilder, TextResponseBuilder } from '../tracing/trace';
import {
  AITextChatPromptItem,
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest,
  AITextTraceStep
} from '../tracing/types';
import { API } from '../util/apicall';

export type FunctionExec = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any;
  result?: string;
  // reasoning?: string[];
};

// eslint-disable-next-line functional/no-mixed-types
export type AITextResponse<T> = {
  prompt: string;
  sessionId?: string;
  value(): T;
};

export interface AIMemory {
  add(result: Readonly<TextResponseResult>, sessionId?: string): void;
  history(sessionId?: string): Readonly<AITextChatPromptItem[]>;
  peek(sessionId?: string): Readonly<TextResponseResult[]>;
  reset(sessionId?: string): void;
}

export type PromptFunctionExtraOptions = {
  ai: AIService;
  sessionId?: string;
};

export type PromptFunctionFunc = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any,
  extra?: Readonly<PromptFunctionExtraOptions>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any>;

export type PromptFunction = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  func: PromptFunctionFunc;
};

export type PromptResponseConfig<T> = {
  keyValue?: boolean;
  schema?: JSONSchemaType<T>;
};

export type PromptConfig<T> = AIPromptConfig & {
  functions?: PromptFunction[];
  functionCall?: string | { name: string };
  response?: PromptResponseConfig<T>;
  debug?: boolean;
  log?: (traces: Readonly<AITextTraceStep>) => void;
};

export type AIPromptConfig = {
  stopSequences: string[];
  stream?: boolean;
};

export type AITranscribeConfig = {
  language?: string;
};

// eslint-disable-next-line functional/no-mixed-types
export type AIServiceOptions = {
  debug?: boolean;
  disableLog?: boolean;
  llmClientAPIKey?: string;
  log?: (traceStep: Readonly<AITextTraceStep>) => void;
  rateLimiter?: RateLimiterFunction;
};

export type AIServiceActionOptions = {
  sessionId?: string;
  traceId?: string;
};

export interface AIServiceBase<
  TCompletionRequest,
  TChatRequest,
  TEmbedRequest,
  TCompletionResponse,
  TChatResponse,
  TEmbedResponse
> {
  generateCompletionReq?(
    req: Readonly<AITextCompletionRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, TCompletionRequest];
  generateChatReq?(
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, TChatRequest];
  generateEmbedReq?(req: Readonly<AITextChatRequest>): [API, TEmbedRequest];
  generateCompletionResp?(resp: Readonly<TCompletionResponse>): TextResponse;
  generateChatResp?(resp: Readonly<TChatResponse>): TextResponse;
  generateEmbedResp?(resp: Readonly<TEmbedResponse>): EmbedResponse;
}

export interface AIService {
  name(): string;
  getModelInfo(): Readonly<TextModelInfo & { provider: string }>;
  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined;
  getModelConfig(): Readonly<TextModelConfig>;

  // _transcribe(
  //   file: string,
  //   prompt?: string,
  //   options?: Readonly<AITranscribeConfig>
  // ): Promise<TranscriptResponse>;
  completion(
    req: Readonly<AITextCompletionRequest>,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<TextResponse | ReadableStream<TextResponse>>;
  chat(
    req: Readonly<AITextChatRequest>,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<TextResponse | ReadableStream<TextResponse>>;
  embed(
    req: Readonly<AITextEmbedRequest>,
    options?: Readonly<AIServiceActionOptions & AIServiceActionOptions>
  ): Promise<EmbedResponse>;
  // transcribe(
  //   file: string,
  //   prompt?: string,
  //   options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  // ): Promise<TranscriptResponse>;
  setOptions(options: Readonly<AIServiceOptions>): void;
  getTraceRequest(): Readonly<TextRequestBuilder> | undefined;
  getTraceResponse(): Readonly<TextResponseBuilder> | undefined;
  traceExists(): boolean;
  logTrace(): void;
}

/*
Magic isn't always unicorns and fairy dust␊
Sometimes it's computer code and technology that's quite a bit of work␊
But if you learn the tricks and the trades␊
You'll find there's a wonder that awaits␊

With a computer and some basic coding␊
You can make anything your heart desires␊
From games that you'll play for hours on end␊
To apps that will make life much more fun␊

So don't be afraid of the unknown␊
Embrace the magic of computer code␊
And you'll find that your dreams can come true␊
With just a little bit of coding, you can do anything too!
*/
