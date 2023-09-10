import {
  AITextTraceStepBuilder,
  TextRequestBuilder,
  TextResponseBuilder,
} from '../../tracing';
import { TextModelConfig } from '../types';
import { findItemByNameOrAlias } from '../util';

import { modelInfoGoogle } from './info';
import {
  GoogleChatRequest,
  GoogleChatResponse,
  GoogleCompletionRequest,
  GoogleCompletionResponse,
} from './types';

const generateCompletionTraceGoogle = (
  req: Readonly<GoogleCompletionRequest>,
  response?: string
): AITextTraceStepBuilder => {
  let resp: GoogleCompletionResponse | undefined;

  if (!response) {
    resp = undefined;
  } else {
    resp = JSON.parse(response) as GoogleCompletionResponse;
  }

  const {
    instances: [{ prompt }],
    parameters: {
      maxOutputTokens: max_tokens,
      temperature,
      topP: top_p,
      topK: top_k,
    },
  } = req;

  // Fetching model info
  const mi = findItemByNameOrAlias(modelInfoGoogle, 'google');
  const modelInfo = { ...mi, name: 'google', provider: 'google' };

  // Configure TextModel based on GoogleCompletionRequest
  const modelConfig: TextModelConfig = {
    maxTokens: max_tokens ?? 0,
    temperature: temperature,
    topP: top_p,
    topK: top_k,
  };

  const prediction = resp?.predictions.at(0);

  const results = prediction ? [{ text: prediction.content }] : undefined;

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder().setStep(prompt, modelConfig, modelInfo)
    )
    .setResponse(new TextResponseBuilder().setResults(results));
};

const generateChatTraceGoogle = (
  req: Readonly<GoogleChatRequest>,
  response?: string
): AITextTraceStepBuilder => {
  let resp: GoogleChatResponse | undefined;

  if (!response) {
    resp = undefined;
  } else {
    resp = JSON.parse(response) as GoogleChatResponse;
  }

  const {
    instances,
    parameters: { maxOutputTokens, temperature, topP, topK },
  } = req;

  const instance = instances.at(0);

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
  const modelConfig: TextModelConfig = {
    maxTokens: maxOutputTokens,
    temperature: temperature,
    topP: topP,
    topK: topK,
  };

  const prediction = resp?.predictions.at(0);

  const results = prediction?.candidates.map(({ content }, i) => ({
    text: [content, prediction?.citationMetadata?.at(i)?.citations].join('\n'),
  }));

  return new AITextTraceStepBuilder()
    .setRequest(
      new TextRequestBuilder()
        .setChatStep(chatPrompt, modelConfig, modelInfo)
        .setSystemPrompt(prompt)
    )
    .setResponse(new TextResponseBuilder().setResults(results));
};

export const generateTraceGoogle = (
  request: string,
  response?: string
): AITextTraceStepBuilder | undefined => {
  const req = JSON.parse(request);

  if (req.instances.length === 0) {
    return;
  }

  if (req.instances[0].prompt > 0) {
    return generateCompletionTraceGoogle(req, response);
  } else {
    return generateChatTraceGoogle(req, response);
  }
};
