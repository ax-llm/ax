import { TogetherCompletionRequest, TogetherConfig } from './types.js';

export const generateReq = (
  prompt: string,
  opt: Readonly<TogetherConfig>,
  stopSequences?: readonly string[]
): TogetherCompletionRequest => ({
  stream_tokens: opt.stream,
  model: opt.model,
  prompt,
  max_tokens: opt.maxTokens,
  stop: stopSequences,
  temperature: opt.temperature,
  top_p: opt.topP,
  top_k: opt.topK,
  repetition_penalty: opt.repetitionPenalty
});
