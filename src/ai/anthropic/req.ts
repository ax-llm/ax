import { AnthropicOptions } from './api';
import { AnthropicCompletionRequest } from './types';

export const generateReq = (
  prompt: string,
  opt: Readonly<AnthropicOptions>,
  stopSequences?: readonly string[]
): AnthropicCompletionRequest => ({
  stop_sequences: stopSequences || [],
  model: opt.model,
  prompt,
  max_tokens_to_sample: opt.maxTokens,
  temperature: opt.temperature,
  top_p: opt.topP,
  top_k: opt.topK,
  stream: opt.stream,
});
