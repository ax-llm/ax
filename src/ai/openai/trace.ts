import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing/index.js';
import { TextModelConfig } from '../types.js';
import { findItemByNameOrAlias } from '../util.js';

import { modelInfoOpenAI } from './info.js';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatResponseDelta,
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAICompletionResponseDelta,
  OpenAILogprob,
} from './types.js';

export const generateCompletionTraceOpenAI = (
  request: string,
  response?: string
): AITextTraceStepBuilder => {
  const req = JSON.parse(request) as OpenAICompletionRequest;
  let resp: OpenAICompletionResponse | undefined;

  if (!response) {
    resp = undefined;
  } else if (req?.stream) {
    resp = mergeCompletionResponseDeltas(
      (response as string).split('\n') as string[]
    );
  } else {
    resp = JSON.parse(response) as OpenAICompletionResponse;
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
    organization,
  } = req;

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
    logitBias: logit_bias,
  };

  const modelUsage =
    resp && resp.usage
      ? {
          promptTokens: resp.usage.prompt_tokens,
          completionTokens: resp.usage.completion_tokens,
          totalTokens: resp.usage.total_tokens,
        }
      : undefined;

  const results = resp
    ? resp.choices.map((choice) => ({
        text: choice.text,
        id: resp?.id,
        finishReason: choice.finish_reason,
      }))
    : undefined;

  const identity = user || organization ? { user, organization } : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder()
        .setStep(prompt, modelConfig, modelInfo)
        .setIdentity(identity)
    )
    .setResponse(
      new TextResponseBuilder()
        .setModelUsage(modelUsage)
        .setResults(results)
        .setRemoteId(resp?.id)
    );
};

export const generateChatTraceOpenAI = (
  request: string,
  response?: string
): AITextTraceStepBuilder => {
  const req = JSON.parse(request) as OpenAIChatRequest;
  let resp: OpenAIChatResponse | undefined;

  if (!response) {
    resp = undefined;
  } else if (req?.stream) {
    resp = mergeChatResponseDeltas(
      (response as string).split('\n') as string[]
    );
  } else {
    resp = JSON.parse(response) as OpenAIChatResponse;
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
    organization,
  } = req;

  // Fetching model info
  const mi = findItemByNameOrAlias(modelInfoOpenAI, model);
  const modelInfo = { ...mi, name: model, provider: 'openai' };

  // Building the prompt string from messages array
  const chatPrompt = messages.map(
    ({ content: text, role, name, function_call: functionCall }) => ({
      text,
      role,
      name,
      functionCall,
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
    logitBias: logit_bias,
  };

  const modelUsage =
    resp && resp.usage
      ? {
          promptTokens: resp.usage.prompt_tokens,
          completionTokens: resp.usage.completion_tokens,
          totalTokens: resp.usage.total_tokens,
        }
      : undefined;

  const results = resp
    ? resp.choices.map((choice) => ({
        id: `${choice.index}`,
        text: choice.message.content,
        role: choice.message.role,
        finishReason: choice.finish_reason,
      }))
    : undefined;

  const identity = user || organization ? { user, organization } : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder()
        .setChatStep(chatPrompt, modelConfig, modelInfo)
        .setSystemPrompt(systemPrompt)
        .setFunctions(functions)
        .setFunctionCall(function_call as string)
        .setIdentity(identity)
    )
    .setResponse(
      new TextResponseBuilder()
        .setModelUsage(modelUsage)
        .setResults(results)
        .setRemoteId(resp?.id)
    );
};

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
        content: value?.content ?? '' + delta.content,
        role: value?.role ?? delta.role ?? '',
        finish_reason: value?.finish_reason ?? finish_reason ?? '',
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
        content: v.content,
      },
      finish_reason: v.finish_reason,
    })),
    usage: chunk.usage,
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
        text: value?.text ?? '' + delta.text,
        logprobs: value?.logprobs,
        finish_reason: value?.finish_reason ?? finish_reason ?? '',
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
      finish_reason: v.finish_reason,
    })),
    usage: chunk.usage,
  };
}

const parseStream = (dataStream: readonly string[]): string[] => {
  return dataStream
    .map((v) => v.trim())
    .filter((v) => v.startsWith('data:') && !v.endsWith('[DONE]'))
    .map((v) => v.slice('data:'.length));
};
