import { HuggingFaceOptions, HuggingFaceRequest } from './types';

export const generateReq = (
  prompt: string,
  opt: Readonly<HuggingFaceOptions>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _stopSequences: readonly string[]
): HuggingFaceRequest => {
  return {
    model: opt.model,
    inputs: prompt,
    parameters: {
      max_new_tokens: opt.maxNewTokens,
      repetition_penalty: opt.repetitionPenalty,
      temperature: opt.temperature,
      top_p: opt.topP,
      top_k: opt.topK,
      return_full_text: opt.returnFullText,
      num_return_sequences: opt.numReturnSequences,
      do_sample: opt.doSample,
      max_time: opt.maxTime,
    },
    options: {
      use_cache: opt.useCache,
      wait_for_model: opt.waitForModel,
    },
  };
};
