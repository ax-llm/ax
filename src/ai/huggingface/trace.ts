import {
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { BaseAIMiddleware, PromptUpdater } from '../middleware.js';
import { AIMiddleware } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { HuggingFace } from './api.js';
import { modelInfoHuggingFace } from './info.js';
import { HuggingFaceRequest, HuggingFaceResponse } from './types.js';

export class HuggingFaceCompletionMiddleware
  extends BaseAIMiddleware<HuggingFaceRequest, HuggingFaceResponse>
  implements AIMiddleware
{
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (fn) {
      const memory = await fn({ prompt: this.req.inputs });
      this.req.inputs += memory.map(({ text }) => text).join('\n');
      this.reqUpdated = true;
    }

    const {
      model,
      inputs: prompt,
      parameters: {
        max_new_tokens: max_tokens,
        temperature,
        top_p,
        num_return_sequences: n,
        repetition_penalty: presence_penalty,
      },
    } = this.req;

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoHuggingFace, model);
    const modelInfo = { ...mi, name: model, provider: 'huggingface' };

    // Configure TextModel based on HuggingFaceRequest
    const modelConfig = {
      maxTokens: max_tokens ?? 0,
      temperature: temperature,
      topP: top_p,
      n: n,
      presencePenalty: presence_penalty,
    };

    this.sb.setRequest(
      new TextRequestBuilder().setStep(prompt, modelConfig, modelInfo)
    );
  };

  addResponse = (response: string) => {
    super.addResponse(response);

    if (!this.resp) {
      throw new Error('Invalid response');
    }

    const results = [
      {
        text: this.resp.generated_text,
      },
    ];

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };

  embed = async (text: string): Promise<readonly number[]> => {
    const ai = new HuggingFace(this.apiKey);
    const res = await ai.embed(text);
    return res.embedding;
  };
}
