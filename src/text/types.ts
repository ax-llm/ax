import type { ReadableStream } from 'stream/web';

import type {
  EmbedResponse,
  RateLimiterFunction,
  TextModelConfig,
  TextModelInfo,
  TextResponse,
  TextResponseResult
} from '../ai/types.js';
import type { Tracer } from '../trace/index.js';
import type { AITextChatRequest, AITextEmbedRequest } from '../types/index.js';

export type FunctionExec = {
  id?: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any;
  result?: string;
};

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
};

export type AITranscribeConfig = {
  language?: string;
};

export type AIServiceOptions = {
  debug?: boolean;
  rateLimiter?: RateLimiterFunction;
  fetch?: typeof fetch;
  tracer?: Tracer;
};

export type AIServiceActionOptions = {
  sessionId?: string;
  traceId?: string;
};

// export interface AIServiceBase<
//   TChatRequest,
//   TEmbedRequest,
//   TChatResponse,
//   TEmbedResponse
// > {
//   generateChatReq?(
//     req: Readonly<AITextChatRequest>,
//     config: Readonly<AIPromptConfig>
//   ): [API, TChatRequest];
//   generateEmbedReq?(req: Readonly<AITextChatRequest>): [API, TEmbedRequest];
//   generateChatResp?(resp: Readonly<TChatResponse>): TextResponse;
//   generateEmbedResp?(resp: Readonly<TEmbedResponse>): EmbedResponse;
// }

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
}
