import { JSONSchemaType } from 'ajv';

import {
  EmbedResponse,
  RateLimiterFunction,
  TextModelConfig,
  TextModelInfo,
  TextResponse,
  TranscriptResponse,
} from '../ai/types';
import { TextRequestBuilder, TextResponseBuilder } from '../tracing/trace';
import { AITextTraceStep } from '../tracing/types';

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
  add(text: string, sessionId?: string): void;
  history(sessionId?: string): string;
  peek(sessionId?: string): Readonly<string[]>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly inputSchema?: any;
  func: PromptFunctionFunc;
};

export type PromptResponseConfig<T> = {
  keyValue?: boolean;
  schema?: JSONSchemaType<T>;
};

export type PromptConfig<T> = AIPromptConfig & {
  queryPrefix?: string;
  responsePrefix?: string;
  functions?: PromptFunction[];
  response?: PromptResponseConfig<T>;
  debug?: boolean;
  log?: (traces: Readonly<AITextTraceStep>) => void;
};

export type AIPromptConfig = {
  stopSequences: string[];
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

export interface AIService {
  name(): string;
  getModelInfo(): Readonly<TextModelInfo & { provider: string }>;
  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined;
  getModelConfig(): Readonly<TextModelConfig>;
  _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse>;
  _embed(
    text2Embed: readonly string[] | string,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<EmbedResponse>;
  _transcribe(
    file: string,
    prompt?: string,
    options?: Readonly<AITranscribeConfig>
  ): Promise<TranscriptResponse>;
  generate(
    prompt: string,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<TextResponse>;
  embed(
    text2Embed: readonly string[] | string,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<EmbedResponse>;
  transcribe(
    file: string,
    prompt?: string,
    options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  ): Promise<TranscriptResponse>;
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
