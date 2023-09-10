import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { TextModelConfig } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { modelInfoAnthropic } from './info.js';
import {
  AnthropicCompletionRequest,
  AnthropicCompletionResponse,
  AnthropicResponseDelta,
} from './types.js';

export const generateCompletionTraceAnthropic = (
  request: string,
  response?: string
): AITextTraceStepBuilder => {
  const req = JSON.parse(request) as AnthropicCompletionRequest;
  let resp: AnthropicCompletionResponse | undefined;

  if (!response) {
    resp = undefined;
  } else if (req?.stream) {
    resp = mergeCompletionResponseDeltas(
      (response as string).split('\n') as string[]
    );
  } else {
    resp = JSON.parse(response) as AnthropicCompletionResponse;
  }

  const {
    prompt,
    model,
    stop_sequences,
    max_tokens_to_sample,
    temperature,
    top_p,
    top_k,
    stream,
  } = req;

  // Fetching model info
  const mi = findItemByNameOrAlias(modelInfoAnthropic, model);
  const modelInfo = { ...mi, name: model, provider: 'anthropic' };

  // Configure TextModel based on AnthropicCompletionRequest
  const modelConfig: TextModelConfig = {
    stop: stop_sequences,
    maxTokens: max_tokens_to_sample,
    temperature: temperature,
    topP: top_p,
    topK: top_k,
    stream: stream,
  };

  const results = resp
    ? [
        {
          text: resp.completion,
          finishReason: resp.stop_reason ?? undefined,
        },
      ]
    : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder().setStep(prompt, modelConfig, modelInfo)
    )
    .setResponse(new TextResponseBuilder().setResults(results));
};

function mergeCompletionResponseDeltas(
  dataStream: readonly string[]
): AnthropicCompletionResponse {
  let value = {
    completion: '',
    stop_reason: '',
    model: '',
  };

  let chunk: AnthropicResponseDelta | undefined;

  parseStream(dataStream).forEach((data) => {
    chunk = JSON.parse(data) as AnthropicResponseDelta;
    const { completion, stop_reason, model } = chunk;
    value = {
      completion: (value.completion ?? '') + completion,
      stop_reason: value?.stop_reason ?? stop_reason ?? null,
      model: model,
    };
  });

  if (!chunk) {
    throw new Error('No data chunks found');
  }

  return value;
}

const parseStream = (dataStream: readonly string[]): string[] => {
  return dataStream
    .map((v) => v.trim())
    .filter((v) => v.startsWith('data:') && !v.endsWith('[DONE]'))
    .map((v) => v.slice('data:'.length));
};
