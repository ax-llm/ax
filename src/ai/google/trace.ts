import {
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { BaseParser, PromptUpdater } from '../parser.js';
import { Parser } from '../types.js';
import { findItemByNameOrAlias, uniqBy } from '../util.js';

import { modelInfoGoogle } from './info.js';
import {
  GoogleChatRequest,
  GoogleChatResponse,
  GoogleCompletionRequest,
  GoogleCompletionResponse,
} from './types.js';

class GoogleCompletionParser
  extends BaseParser<GoogleCompletionRequest, GoogleCompletionResponse>
  implements Parser
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
        topK: top_k,
      },
    } = this.req;

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoGoogle, 'google');
    const modelInfo = { ...mi, name: 'google', provider: 'google' };

    // Configure TextModel based on GoogleCompletionRequest
    const modelConfig = {
      maxTokens: max_tokens ?? 0,
      temperature: temperature,
      topP: top_p,
      topK: top_k,
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

    const prediction = this.resp.predictions.at(0);
    const results = prediction ? [{ text: prediction.content }] : undefined;

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };
}

class GoogleChatParser
  extends BaseParser<GoogleChatRequest, GoogleChatResponse>
  implements Parser
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
        content,
      }));

      this.req.instances[0].messages = uniqBy(
        [...prompt, ...instance.messages],
        ({ content }) => content
      );

      this.reqUpdated = true;
    }

    const {
      parameters: { maxOutputTokens, temperature, topP, topK },
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
      examples ? `Examples:\n${examples}` : null,
    ].join('\n');

    // Building the prompt string from messages array
    const chatPrompt =
      instance?.messages.map(({ content: text, author: role }) => ({
        text,
        role,
        name: role, // assuming author is same as name
      })) ?? [];

    // Configure TextModel based on GoogleChatRequest
    const modelConfig = {
      maxTokens: maxOutputTokens,
      temperature: temperature,
      topP: topP,
      topK: topK,
    };

    this.sb.setRequest(
      new TextRequestBuilder()
        .setChatStep(chatPrompt, modelConfig, modelInfo)
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
      text: [content, prediction?.citationMetadata?.at(i)?.citations].join(
        '\n'
      ),
    }));

    this.sb.setResponse(new TextResponseBuilder().setResults(results));
  };
}

export class GoogleParser
  extends BaseParser<
    GoogleChatRequest | GoogleCompletionRequest,
    GoogleChatResponse | GoogleCompletionResponse
  >
  implements Parser
{
  parser?: Parser;

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
      this.parser = new GoogleCompletionParser();
    } else {
      this.parser = new GoogleChatParser();
    }
    this.parser.addRequest(request, fn);
  };

  addResponse = (response: string) => {
    if (!this.parser) {
      throw new Error('Invalid parser');
    }
    this.parser.addResponse(response);
  };
}
