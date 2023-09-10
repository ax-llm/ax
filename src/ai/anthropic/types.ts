import { API } from '../../util/apicall';

import { AnthropicModel } from './api';

export type AnthropicApiConfig = API & {
  headers: { 'Anthropic-Version': string };
};

export const apiURLAnthropic = 'https://api.anthropic.com/';

export enum AnthropicApi {
  Completion = 'v1/complete',
}

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
