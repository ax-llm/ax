import {
  TextRequestBuilder,
  TextResponseBuilder
} from '../../tracing/index.js';
import { BaseAIMiddleware, PromptUpdater } from '../middleware.js';
import { AIMiddleware } from '../types.js';
import { findItemByNameOrAlias, uniqBy } from '../util.js';

import { modelInfoGooglePalm2 } from './info.js';
import {
  GooglePalm2ChatRequest,
  GooglePalm2ChatResponse,
  GooglePalm2CompletionRequest,
  GooglePalm2CompletionResponse
} from './types.js';

class GooglePalm2CompletionMiddleware
  extends BaseAIMiddleware<
    GooglePalm2CompletionRequest,
    GooglePalm2CompletionResponse
  >
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
    const mi = findItemByNameOrAlias(modelInfoGooglePalm2, 'google');
    const modelInfo = { ...mi, name: 'google', provider: 'google' };

    // Configure TextModel based on GooglePalm2CompletionRequest
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

class GooglePalm2ChatMiddleware
  extends BaseAIMiddleware<GooglePalm2ChatRequest, GooglePalm2ChatResponse>
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
    const mi = findItemByNameOrAlias(modelInfoGooglePalm2, 'google');
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

    // Configure TextModel based on GooglePalm2ChatRequest
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

export class GooglePalm2Middleware
  extends BaseAIMiddleware<
    GooglePalm2ChatRequest | GooglePalm2CompletionRequest,
    GooglePalm2ChatResponse | GooglePalm2CompletionResponse
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

    const rq = this.req as GooglePalm2CompletionRequest;

    if (rq.instances.at(0)?.prompt) {
      this.mw = new GooglePalm2CompletionMiddleware(this.exReq);
    } else {
      this.mw = new GooglePalm2ChatMiddleware(this.exReq);
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
  //       'Missing GooglePalm2 project ID header: x-llmclient-google-project-id'
  //     );
  //   }
  //   const ai = new GooglePalm2(this.apiKey, projectId);
  //   const res = await ai.embed(text, {
  //     traceId: this.exReq?.traceId,
  //     sessionId: this.exReq?.sessionId,
  //   });
  //   return res.embedding;
  // };
}
