import {
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { BaseAIMiddleware, PromptUpdater } from '../middleware.js';
import { AIMiddleware, TextModelConfig } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { modelInfoAnthropic } from './info.js';
import {
  AnthropicCompletionRequest,
  AnthropicCompletionResponse,
  AnthropicResponseDelta,
} from './types.js';

export class AnthropicCompletionMiddleware
  extends BaseAIMiddleware<
    AnthropicCompletionRequest,
    AnthropicCompletionResponse
  >
  implements AIMiddleware
{
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (fn) {
      const memory = await fn({
        prompt: this.req.prompt,
        user: this.req.metadata?.user_id,
      });

      this.req.prompt += memory.map(({ text }) => text).join('\n');
      this.reqUpdated = true;
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
    } = this.req;

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

    this.sb.setRequest(
      new TextRequestBuilder().setCompletionStep({ prompt }, modelConfig, modelInfo)
    );
  };

  addResponse = (response: string) => {
    if (this.sb.isStream()) {
      this.resp = mergeCompletionResponseDeltas(
        (response as string).split('\n') as string[]
      );
    } else {
      super.addResponse(response);
    }

    if (!this.resp) {
      throw new Error('Invalid response');
    }

    const { completion, stop_reason } = this.resp;

    const results = [
      {
        text: completion,
        finishReason: stop_reason ?? undefined,
      },
    ];

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };
}

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
