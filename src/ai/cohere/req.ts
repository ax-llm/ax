import { CohereCompletionRequest, CohereOptions } from './types';

export const generateReq = (
  prompt: string,
  opt: Readonly<CohereOptions>,
  stopSequences?: readonly string[]
): CohereCompletionRequest => ({
  prompt,
  model: opt.model,
  max_tokens: opt.maxTokens,
  temperature: opt.temperature,
  k: opt.topK,
  p: opt.topP,
  frequency_penalty: opt.frequencyPenalty,
  presence_penalty: opt.presencePenalty,
  end_sequences: stopSequences,
  stop_sequences: opt.stopSequences,
  return_likelihoods: opt.returnLikelihoods,
});
