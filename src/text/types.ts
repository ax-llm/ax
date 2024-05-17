import type { ReadableStream } from 'stream/web';
import type {
  EmbedResponse,
  LoggerFunction,
  RateLimiterFunction,
  TextModelConfig,
  TextModelInfo,
  TextResponse,
  TextResponseResult
} from '../ai/types.js';
import type {
  TextRequestBuilder,
  TextResponseBuilder
} from '../tracing/trace.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest
} from '../tracing/types.js';
import type { API } from '../util/apicall.js';

export type FunctionExec = {
  id?: string;
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
  add(
    result: Readonly<
      AITextChatRequest['chatPrompt'] | AITextChatRequest['chatPrompt'][0]
    >,
    sessionId?: string
  ): void;
  addResult(result: Readonly<TextResponseResult>, sessionId?: string): void;
  history(sessionId?: string): Readonly<AITextChatRequest['chatPrompt']>;
  peek(sessionId?: string): Readonly<AITextChatRequest['chatPrompt']>;
  reset(sessionId?: string): void;
}

export type AIPromptConfig = {
  stream?: boolean;
  cache?: boolean;
  cacheMaxAgeSeconds?: number;
};

export type AITranscribeConfig = {
  language?: string;
};

export type AIServiceOptions = {
  debug?: boolean;
  disableLog?: boolean;
  log?: LoggerFunction;
  rateLimiter?: RateLimiterFunction;
};

export type AIServiceActionOptions = {
  sessionId?: string;
  traceId?: string;
};

export interface AIServiceBase<
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TEmbedResponse
> {
  generateChatReq?(
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, TChatRequest];
  generateEmbedReq?(req: Readonly<AITextChatRequest>): [API, TEmbedRequest];
  generateChatResp?(resp: Readonly<TChatResponse>): TextResponse;
  generateEmbedResp?(resp: Readonly<TEmbedResponse>): EmbedResponse;
}

export interface AIService {
  getName(): string;
  getModelInfo(): Readonly<TextModelInfo & { provider: string }>;
  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined;
  getModelConfig(): Readonly<TextModelConfig>;
  getFeatures(): { functions: boolean };

  // _transcribe(
  //   file: string,
  //   prompt?: string,
  //   options?: Readonly<AITranscribeConfig>
  // ): Promise<TranscriptResponse>;
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
