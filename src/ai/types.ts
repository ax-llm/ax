import type { AITextTraceStep } from '../tracing/types.js';

export type TextModelInfo = {
  name: string;
  currency?: string;
  characterIsToken?: boolean;
  promptTokenCostPer1M?: number;
  completionTokenCostPer1M?: number;
  aliases?: string[];
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TextModelConfig = {
  maxTokens?: number;
  temperature: number;
  topP?: number;
  topK?: number;
  n?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  presencePenalty?: number;
  frequencyPenalty?: number;
  bestOf?: number;
  logitBias?: Map<string, number>;
  suffix?: string | null;
  stop?: readonly string[];
};

export type TextResponseFunctionCall = {
  id?: string;
  name: string;
  args: string;
};

export type TextResponseResult = {
  content: string | null;
  role?: string;
  name?: string;
  id?: string;
  functionCalls?: Readonly<{
    id: string;
    type: 'function';
    // eslint-disable-next-line functional/functional-parameters
    function: { name: string; arguments?: string };
  }>[];
  finishReason?: string;
};

export type TextResponse = {
  sessionId?: string;
  remoteId?: string;
  results: readonly TextResponseResult[];
  modelUsage?: TokenUsage;
  embedModelUsage?: TokenUsage;
};

export type EmbedResponse = {
  remoteId?: string;
  sessionId?: string;
  embeddings: readonly (readonly number[])[];
  modelUsage?: TokenUsage;
};

export type TranscriptResponse = {
  sessionId?: string;
  duration: number;
  segments: {
    id: number;
    start: number;
    end: number;
    text: string;
  }[];
};

export type LoggerFunction = (traceStep: Readonly<AITextTraceStep>) => void;

export type RateLimiterFunction = <T>(func: unknown) => T;
