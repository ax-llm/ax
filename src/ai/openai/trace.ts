import {
  TextRequestBuilder,
  TextResponseBuilder
} from '../../tracing/index.js';
import { BaseAIMiddleware, PromptUpdater } from '../middleware.js';
import { AIMiddleware, TextModelConfig } from '../types.js';
import { findItemByNameOrAlias, uniqBy } from '../util.js';

import { modelInfoOpenAI } from './info.js';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatResponseDelta,
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAICompletionResponseDelta,
  OpenAILogprob
} from './types.js';

export class OpenAICompletionMiddleware extends BaseAIMiddleware<
  OpenAICompletionRequest,
  OpenAICompletionResponse
> {
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (fn) {
      const memory = await fn({ prompt: this.req.prompt, user: this.req.user });
      this.req.prompt += memory.map(({ text }) => text).join('\n');
      this.reqUpdated = true;
    }

    const {
      model,
      prompt,
      max_tokens,
      temperature,
      top_p,
      n,
      stream,
      presence_penalty,
      frequency_penalty,
      logit_bias,
      user,
      organization
    } = this.req;

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoOpenAI, model);
    const modelInfo = { ...mi, name: model, provider: 'openai' };

    // Configure TextModel based on OpenAICompletionRequest
    const modelConfig: TextModelConfig = {
      maxTokens: max_tokens,
      temperature: temperature,
      topP: top_p,
      n: n,
      stream: stream,
      presencePenalty: presence_penalty,
      frequencyPenalty: frequency_penalty,
      logitBias: logit_bias
    };

    const identity = user || organization ? { user, organization } : undefined;

    this.sb.setRequest(
      new TextRequestBuilder()
        .setCompletionStep({ prompt }, modelConfig, modelInfo)
        .setIdentity(identity)
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

    const { id, usage, choices } = this.resp;

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    const results = choices.map((choice) => ({
      text: choice.text,
      finishReason: choice.finish_reason
    }));

    this.sb.setResponse(
      new TextResponseBuilder()
        .setModelUsage(modelUsage)
        .setResults(results)
        .setRemoteId(id)
    );
  };
}

export class OpenAIChatMiddleware
  extends BaseAIMiddleware<OpenAIChatRequest, OpenAIChatResponse>
  implements AIMiddleware
{
  addRequest = async (request: string, fn?: PromptUpdater) => {
    super.addRequest(request);

    if (!this.req) {
      throw new Error('Invalid request');
    }

    if (fn) {
      const memory = await fn({
        prompt: this.req.messages.at(-1)?.content,
        user: this.req.user
      });

      const prompt = memory.map(({ role = '', text: content }) => ({
        role,
        content
      }));

      const system = this.req.messages.filter(({ role }) => role === 'system');
      let messages = [];

      if (system) {
        const other = this.req.messages.filter(({ role }) => role !== 'system');
        messages = [...system, ...prompt, ...other];
      } else {
        messages = [...prompt, ...this.req.messages];
      }

      this.req.messages = uniqBy(messages, ({ content }) => content);
      this.reqUpdated = true;
    }

    const {
      model,
      messages,
      functions,
      function_call,
      max_tokens,
      temperature,
      top_p,
      n,
      stream,
      presence_penalty,
      frequency_penalty,
      logit_bias,
      user,
      organization
    } = this.req;

    // Fetching model info
    const mi = findItemByNameOrAlias(modelInfoOpenAI, model);
    const modelInfo = { ...mi, name: model, provider: 'openai' };

    // Building the prompt string from messages array
    const chatPrompt = messages.map(
      ({ content: text, role, name, function_call: fc }) => ({
        text,
        role,
        name,
        functionCall: fc ? { name: fc.name, args: fc.arguments } : undefined
      })
    );

    const systemPrompt = chatPrompt
      .filter((m) => m.role === 'system')
      ?.at(0)?.text;

    // Configure TextModel based on OpenAIChatRequest
    const modelConfig: TextModelConfig = {
      maxTokens: max_tokens,
      temperature: temperature,
      topP: top_p,
      n: n,
      stream: stream,
      presencePenalty: presence_penalty,
      frequencyPenalty: frequency_penalty,
      logitBias: logit_bias
    };

    const identity = user || organization ? { user, organization } : undefined;

    this.sb.setRequest(
      new TextRequestBuilder()
        .setChatStep({ chatPrompt }, modelConfig, modelInfo)
        .setSystemPrompt(systemPrompt)
        .setFunctions(functions)
        .setFunctionCall(function_call as string)
        .setIdentity(identity)
    );
  };

  addResponse = (response: string) => {
    if (this.sb.isStream()) {
      this.resp = mergeChatResponseDeltas(
        (response as string).split('\n') as string[]
      );
    } else {
      super.addResponse(response);
    }

    if (!this.resp) {
      throw new Error('Invalid response');
    }

    const { id, usage, choices } = this.resp;

    const modelUsage = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        }
      : undefined;

    const results = choices.map((choice) => ({
      id: `${choice.index}`,
      text: choice.message.content,
      role: choice.message.role,
      finishReason: choice.finish_reason
    }));

    this.sb.setResponse(
      new TextResponseBuilder()
        .setModelUsage(modelUsage)
        .setResults(results)
        .setRemoteId(id)
    );
  };
}

function mergeChatResponseDeltas(
  dataStream: readonly string[]
): OpenAIChatResponse {
  const md = new Map<
    number,
    { content: string; role: string; finish_reason: string }
  >();

  let chunk: OpenAIChatResponseDelta | undefined;

  parseStream(dataStream).forEach((data) => {
    chunk = JSON.parse(data) as OpenAIChatResponseDelta;
    chunk.choices.forEach((c) => {
      const { index, delta, finish_reason } = c;
      const value = md.get(index);

      md.set(index, {
        content: (value?.content ?? '') + delta.content,
        role: value?.role ?? delta.role ?? '',
        finish_reason: value?.finish_reason ?? finish_reason ?? ''
      });
    });
  });

  if (!chunk) {
    throw new Error('No data chunks found');
  }

  return {
    id: chunk.id,
    object: chunk.object,
    created: chunk.created,
    model: chunk.model,
    choices: Array.from(md, ([index, v]) => ({
      index,
      message: {
        role: v.role,
        content: v.content
      },
      finish_reason: v.finish_reason
    })),
    usage: chunk.usage
  };
}

function mergeCompletionResponseDeltas(
  dataStream: readonly string[]
): OpenAICompletionResponse {
  const md = new Map<
    number,
    { text: string; finish_reason: string; logprobs?: OpenAILogprob }
  >();

  let chunk: OpenAICompletionResponseDelta | undefined;

  parseStream(dataStream).forEach((data) => {
    chunk = JSON.parse(data) as OpenAICompletionResponseDelta;
    chunk.choices.forEach((c) => {
      const { index, delta, finish_reason } = c;
      const value = md.get(index);
      md.set(index, {
        text: (value?.text ?? '') + delta.text,
        logprobs: value?.logprobs,
        finish_reason: value?.finish_reason ?? finish_reason ?? ''
      });
    });
  });

  if (!chunk) {
    throw new Error('No data chunks found');
  }

  return {
    id: chunk.id,
    object: chunk.object,
    created: chunk.created,
    model: chunk.model,
    choices: Array.from(md, ([index, v]) => ({
      index,
      text: v.text,
      logprobs: v.logprobs,
      finish_reason: v.finish_reason
    })),
    usage: chunk.usage
  };
}

const parseStream = (dataStream: readonly string[]): string[] => {
  return dataStream
    .map((v) => v.trim())
    .filter((v) => v.startsWith('data:') && !v.endsWith('[DONE]'))
    .map((v) => v.slice('data:'.length));
};
