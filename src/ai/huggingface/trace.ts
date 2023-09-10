import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing';
import { TextModelConfig } from '../types';
import { findItemByNameOrAlias } from '../util';

import { modelInfoHuggingFace } from './info';
import { HuggingFaceRequest, HuggingFaceResponse } from './types';

export const generateTraceCompletionHuggingFace = (
  request: string,
  response?: string
): AITextTraceStepBuilder => {
  const req = JSON.parse(request) as HuggingFaceRequest;
  let resp: HuggingFaceResponse | undefined;

  if (!response) {
    resp = undefined;
  } else {
    resp = JSON.parse(response) as HuggingFaceResponse;
  }

  const {
    inputs: prompt,
    parameters: {
      max_new_tokens: max_tokens,
      temperature,
      top_p,
      num_return_sequences: n,
      repetition_penalty: presence_penalty,
    },
  } = req;

  // Fetching model info
  const mi = findItemByNameOrAlias(modelInfoHuggingFace, req.model);
  const modelInfo = { ...mi, name: req.model, provider: 'huggingface' };

  // Configure TextModel based on HuggingFaceRequest
  const modelConfig: TextModelConfig = {
    maxTokens: max_tokens ?? 0,
    temperature: temperature,
    topP: top_p,
    n: n,
    presencePenalty: presence_penalty,
  };

  const results = resp
    ? [
        {
          text: resp.generated_text,
        },
      ]
    : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder().setStep(prompt, modelConfig, modelInfo)
    )
    .setResponse(new TextResponseBuilder().setResults(results));
};
