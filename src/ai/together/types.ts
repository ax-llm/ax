export type TogetherCompletionRequest = {
  model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  logprobs?: number;
  stop?: readonly string[];
  stream_tokens?: boolean;
};

export type TogetherCompletionResponse = {
  status: string;
  prompt: string[];
  model: string;
  model_owner: string;
  tags: Record<string, unknown>;
  num_returns: number;
  args: TogetherCompletionRequest;
  subjobs: string[];
  output: {
    choices: { finish_reason: string; index: number; text: string }[];
    raw_compute_time: number;
    result_type: string;
  };
};

export type TogetherConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK?: number;
  repetitionPenalty?: number;
  stopSequences?: string[];
  stream?: boolean;
};
