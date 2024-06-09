import type { AITextTraceStep } from '../types/index.js';

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
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  endSequences?: string[];
  stream?: boolean;
  n?: number;
};

export type TextResponseFunctionCall = {
  id?: string;
  name: string;
  args: string;
};

export type TextResponseResult = {
  content: string | null;
  name?: string;
  id?: string;
  functionCalls?: {
    id: string;
    type: 'function';
    // eslint-disable-next-line functional/functional-parameters
    function: { name: string; arguments?: string | object };
  }[];
  finishReason?:
    | 'stop'
    | 'length'
    | 'function_call'
    | 'content_filter'
    | 'error';
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
