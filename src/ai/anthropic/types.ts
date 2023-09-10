import { API } from '../../util/apicall';

export type AnthropicApiConfig = API & {
  headers: { 'Anthropic-Version': string };
};

export const apiURLAnthropic = 'https://api.anthropic.com/';

export enum AnthropicApi {
  Completion = 'v1/complete',
}

/**
 * Anthropic: Models for text generation
 * @export
 */
export enum AnthropicModel {
  Claude2 = 'claude-2',
  ClaudeInstant = 'claude-instant',
}

/**
 * Anthropic: Model options for text generation
 * @export
 */
export type AnthropicOptions = {
  model: AnthropicModel;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK?: number;
  stream?: boolean;
  stopSequences?: string[];
};

export type AnthropicCompletionRequest = {
  stop_sequences: readonly string[];
  metadata?: {
    user_id?: string;
  };
  model: AnthropicModel | string;
  prompt: string;
  max_tokens_to_sample: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
};

export type AnthropicCompletionResponse = {
  completion: string;
  stop_reason?: string | null;
  model: string;
};

export type AnthropicResponseDelta = AnthropicCompletionResponse;
