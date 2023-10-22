import { ExtendedIncomingMessage } from '../proxy/types';
import { AITextTraceStep } from '../tracing/types';

import { PromptUpdater } from './middleware';

export type TextModelInfo = {
  name: string;
  currency?: string;
  characterIsToken?: boolean;
  promptTokenCostPer1K?: number;
  completionTokenCostPer1K?: number;
  maxTokens?: number;
  aliases?: string[];
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TextModelConfig = {
  maxTokens: number;
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
  name: string;
  args: string;
};

export type TextResponseResult = {
  text: string;
  role?: string;
  name?: string;
  id?: string;
  functionCall?: TextResponseFunctionCall;
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

export type RateLimiterFunction = <T>(func: unknown) => T;

/**
 * Middleware
 * @export
 */
export interface AIMiddleware {
  addRequest(request: string, fn?: PromptUpdater): void;
  addResponse(response: string): void;
  getTrace(req: Readonly<ExtendedIncomingMessage>): AITextTraceStep;
  isRequestUpdated(): boolean;
  renderRequest(): string;
  getAPIKey(): string;
}
