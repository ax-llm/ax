import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { TextModelConfig } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { modelInfoTogether } from './info.js';
import {
  TogetherCompletionRequest,
  TogetherCompletionResponse,
} from './types.js';

export const generateTraceCompletionTogether = (
  request: string,
  response?: string
): AITextTraceStepBuilder => {
  const req = JSON.parse(request) as TogetherCompletionRequest;
  let resp: TogetherCompletionResponse | undefined;

  if (!response) {
    resp = undefined;
  } else {
    resp = JSON.parse(response) as TogetherCompletionResponse;
  }

  const {
    prompt,
    max_tokens: max_tokens,
    temperature,
    top_p,
    repetition_penalty: presence_penalty,
  } = req;

  // Fetching model info
  const mi = findItemByNameOrAlias(modelInfoTogether, req.model.toString());
  const modelInfo = {
    ...mi,
    name: req.model.toString(),
    provider: 'together',
  };

  // Configure TextModel based on TogetherCompletionRequest
  const modelConfig: TextModelConfig = {
    maxTokens: max_tokens ?? 0,
    temperature: temperature,
    topP: top_p,
    presencePenalty: presence_penalty,
  };

  const results = resp
    ? resp.output.choices.map((choice) => ({ text: choice.text }))
    : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder().setStep(prompt, modelConfig, modelInfo)
    )
    .setResponse(new TextResponseBuilder().setResults(results));
};
