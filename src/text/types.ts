import { JSONSchemaType } from 'ajv';

import { AI } from './wrap';

export type GenerateTextExtraOptions = {
  debug: boolean;
  sessionID?: string;
};

export type TextModelInfo = {
  id: string;
  currency: string;
  characterIsToken?: boolean;
  promptTokenCostPer1K: number;
  completionTokenCostPer1K: number;
  maxTokens: number;
  oneTPM: number;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type GenerateTextModelConfig = {
  suffix: string | null;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK?: number;
  n?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  presencePenalty?: number;
  frequencyPenalty?: number;
  bestOf?: number;
  logitBias?: Map<string, number>;
};

export type FunctionExec = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response?: any;
  reasoning?: string[];
  parsingError?: { error: string; data: string };
};

export type GenerateTextResponse = {
  sessionID?: string;
  remoteID?: string;
  results: {
    text: string;
    id?: string;
    finishReason?: string;
  }[];
  modelUsage?: TokenUsage;
  embedModelUsage?: TokenUsage;
};

export type AIGenerateTextResponse = GenerateTextResponse & {
  requestID: string;
  prompt?: string;
  modelInfo?: Readonly<TextModelInfo>;
  modelConfig?: Readonly<GenerateTextModelConfig>;
  modelResponseTime?: number;
  embedModelInfo?: Readonly<TextModelInfo>;
  embedModelResponseTime?: number;
  functions?: FunctionExec[];
  parsingError?: { error: string; data: string };
  apiError?: Error;
};

// eslint-disable-next-line functional/no-mixed-types
export type AITextResponse<T> = {
  id: string;
  prompt: string;
  sessionID?: string;
  responses: AIGenerateTextResponse[];
  value(): T;
};

export type EmbedResponse = {
  remoteID?: string;
  sessionID?: string;
  texts: readonly string[];
  embedding: readonly number[];
  modelUsage?: TokenUsage;
};

export type TranscriptResponse = {
  sessionID?: string;
  duration: number;
  segments: {
    id: number;
    start: number;
    end: number;
    text: string;
  }[];
};

export interface AIMemory {
  add(text: string, sessionID?: string): void;
  history(sessionID?: string): string;
  peek(sessionID?: string): Readonly<string[]>;
}

export type Embeddings = {
  model: string;
  embedding: number[];
};

export type PromptFunctionExtraOptions = {
  ai: Readonly<AI>;
  debug: boolean;
  sessionID?: string;
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
  responseConfig?: PromptResponseConfig<T>;
};

export type AIPromptConfig = {
  stopSequences: string[];
};

export interface AIService {
  name(): string;
  getModelInfo(): Readonly<TextModelInfo> | undefined;
  getEmbedModelInfo(): Readonly<TextModelInfo> | undefined;
  getModelConfig(): Readonly<GenerateTextModelConfig>;
  generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse>;
  embed(
    text2Embed: readonly string[] | string,
    sessionID?: string
  ): Promise<EmbedResponse>;
  transcribe(
    file: string,
    prompt?: string,
    language?: string,
    sessionID?: string
  ): Promise<TranscriptResponse>;
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
