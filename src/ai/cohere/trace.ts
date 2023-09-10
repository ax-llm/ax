import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { TextModelConfig } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { modelInfoCohere } from './info.js';
import { CohereCompletionRequest, CohereCompletionResponse } from './types.js';

export const generateCompletionTraceCohere = (
  request: string,
  response?: string
): AITextTraceStepBuilder => {
  const req = JSON.parse(request) as CohereCompletionRequest;
  let resp: CohereCompletionResponse | undefined;

  if (!response) {
    resp = undefined;
  } else {
    resp = JSON.parse(response) as CohereCompletionResponse;
  }

  const { prompt, model, stop_sequences, max_tokens, temperature, p, k } = req;

  // Fetching model info
  const mi = findItemByNameOrAlias(modelInfoCohere, model);
  const modelInfo = { ...mi, name: model, provider: 'cohere' };

  // Configure TextModel based on CohereCompletionRequest
  const modelConfig: TextModelConfig = {
    stop: stop_sequences,
    maxTokens: max_tokens,
    temperature: temperature,
    topP: p,
    topK: k,
  };

  const results = resp
    ? resp.generations.map((gen) => ({
        text: gen.text,
        finishReason: gen.id, // Changed completion to generation and stop_reason to id
      }))
    : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder().setStep(prompt, modelConfig, modelInfo)
    )
    .setResponse(new TextResponseBuilder().setResults(results));
};
