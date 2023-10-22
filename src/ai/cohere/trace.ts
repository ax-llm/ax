import {
  TextRequestBuilder,
  TextResponseBuilder
} from '../../tracing/index.js';
import { BaseAIMiddleware, PromptUpdater } from '../middleware.js';
import { AIMiddleware, TextModelConfig } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { modelInfoCohere } from './info.js';
import { CohereCompletionRequest, CohereCompletionResponse } from './types.js';

export class CohereCompletionMiddleware
  extends BaseAIMiddleware<CohereCompletionRequest, CohereCompletionResponse>
  implements AIMiddleware
{
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (fn) {
      const memory = await fn({ prompt: this.req.prompt });
      this.req.prompt += memory.map(({ text }) => text).join('\n');
      this.reqUpdated = true;
    }

    const { prompt, model, stop_sequences, max_tokens, temperature, p, k } =
      this.req;

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoCohere, model);
    const modelInfo = { ...mi, name: model, provider: 'cohere' };

    // Configure TextModel based on CohereCompletionRequest
    const modelConfig: TextModelConfig = {
      stop: stop_sequences,
      maxTokens: max_tokens,
      temperature: temperature,
      topP: p,
      topK: k
    };

    this.sb.setRequest(
      new TextRequestBuilder().setCompletionStep(
        { prompt },
        modelConfig,
        modelInfo
      )
    );
  };

  addResponse = (response: string) => {
    super.addResponse(response);

    if (!this.resp) {
      throw new Error('Invalid response');
    }

    const results = this.resp.generations.map((gen) => ({
      text: gen.text,
      finishReason: gen.id // Changed completion to generation and stop_reason to id
    }));

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };
}
