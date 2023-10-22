import {
  TextRequestBuilder,
  TextResponseBuilder
} from '../../tracing/index.js';
import { BaseAIMiddleware, PromptUpdater } from '../middleware.js';
import { AIMiddleware } from '../types.js';
import { findItemByNameOrAlias, uniqBy } from '../util.js';

import { modelInfoGoogle } from './info.js';
import {
  GoogleChatRequest,
  GoogleChatResponse,
  GoogleCompletionRequest,
  GoogleCompletionResponse
} from './types.js';

class GoogleCompletionMiddleware
  extends BaseAIMiddleware<GoogleCompletionRequest, GoogleCompletionResponse>
  implements AIMiddleware
{
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (this.req.instances.length === 0) {
      throw new Error('Invalid request: no instances');
    }

    const instance = this.req.instances[0];

    if (fn) {
      const memory = await fn({ prompt: instance.prompt });
      this.req.instances[0].prompt += memory.map(({ text }) => text).join('\n');
      this.reqUpdated = true;
    }

    const {
      instances: [{ prompt }],
      parameters: {
        maxOutputTokens: max_tokens,
        temperature,
        topP: top_p,
        topK: top_k
      }
    } = this.req;

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoGoogle, 'google');
    const modelInfo = { ...mi, name: 'google', provider: 'google' };

    // Configure TextModel based on GoogleCompletionRequest
    const modelConfig = {
      maxTokens: max_tokens ?? 0,
      temperature: temperature,
      topP: top_p,
      topK: top_k
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

    const prediction = this.resp.predictions.at(0);
    const results = prediction ? [{ text: prediction.content }] : undefined;

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  embed = async (_text: string): Promise<readonly number[]> => [];
}

class GoogleChatMiddleware
  extends BaseAIMiddleware<GoogleChatRequest, GoogleChatResponse>
  implements AIMiddleware
{
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (this.req.instances.length === 0) {
      throw new Error('Invalid request: no instances');
    }

    const instance = this.req.instances[0];

    if (fn) {
      const memory = await fn({ prompt: instance.messages.at(-1)?.content });
      const prompt = memory.map(({ role: author = '', text: content }) => ({
        author,
        content
      }));

      this.req.instances[0].messages = uniqBy(
        [...prompt, ...instance.messages],
        ({ content }) => content
      );

      this.reqUpdated = true;
    }

    const {
      parameters: { maxOutputTokens, temperature, topP, topK }
    } = this.req;

    const examples = instance?.examples
      .map(({ input, output }) => [[`Input: ${input}`, `Output: ${output}`]])
      .join('\n');

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoGoogle, 'google');
    const modelInfo = { ...mi, name: 'google', provider: 'google' };

    // Context Prompt
    const prompt = [
      instance?.context,
      examples ? `Examples:\n${examples}` : null
    ].join('\n');

    // Building the prompt string from messages array
    const chatPrompt =
      instance?.messages.map(({ content: text, author: role }) => ({
        text,
        role,
        name: role // assuming author is same as name
      })) ?? [];

    // Configure TextModel based on GoogleChatRequest
    const modelConfig = {
      maxTokens: maxOutputTokens,
      temperature: temperature,
      topP: topP,
      topK: topK
    };

    this.sb.setRequest(
      new TextRequestBuilder()
        .setChatStep({ chatPrompt }, modelConfig, modelInfo)
        .setSystemPrompt(prompt)
    );
  };

  addResponse = (response: string) => {
    super.addResponse(response);

    if (!this.resp) {
      throw new Error('Invalid response');
    }

    const prediction = this.resp?.predictions.at(0);

    const results = prediction?.candidates.map(({ content }, i) => ({
      text: [content, prediction?.citationMetadata?.at(i)?.citations].join('\n')
    }));

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  embed = async (_text: string): Promise<readonly number[]> => [];
}

export class GoogleMiddleware
  extends BaseAIMiddleware<
    GoogleChatRequest | GoogleCompletionRequest,
    GoogleChatResponse | GoogleCompletionResponse
  >
  implements AIMiddleware
{
  mw?: AIMiddleware;

  addRequest = (request: string, fn?: PromptUpdater | undefined) => {
    super.addRequest(request);
    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (!this.req.instances || this.req.instances.length === 0) {
      throw new Error('Invalid request: no instances');
    }

    const rq = this.req as GoogleCompletionRequest;

    if (rq.instances.at(0)?.prompt) {
      this.mw = new GoogleCompletionMiddleware(this.exReq);
    } else {
      this.mw = new GoogleChatMiddleware(this.exReq);
    }
    this.mw.addRequest(request, fn);
  };

  addResponse = (response: string) => {
    if (!this.mw) {
      throw new Error('Invalid middlware');
    }
    this.mw.addResponse(response);
  };

  // embed = async (text: string): Promise<readonly number[]> => {
  //   const projectId = this.exReq.headers[
  //     'x-llmclient-google-project-id'
  //   ] as string;
  //   if (!projectId) {
  //     throw new Error(
  //       'Missing Google project ID header: x-llmclient-google-project-id'
  //     );
  //   }
  //   const ai = new Google(this.apiKey, projectId);
  //   const res = await ai.embed(text, {
  //     traceId: this.exReq?.traceId,
  //     sessionId: this.exReq?.sessionId,
  //   });
  //   return res.embedding;
  // };
}
