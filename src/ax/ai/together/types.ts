export enum AxAITogetherModel {
  KimiK25 = 'moonshotai/Kimi-K2.5',
  KimiK2Instruct0905 = 'moonshotai/Kimi-K2-Instruct-0905',
  KimiK2Thinking = 'moonshotai/Kimi-K2-Thinking',
  DeepSeekV31 = 'deepseek-ai/DeepSeek-V3.1',
  DeepSeekR1 = 'deepseek-ai/DeepSeek-R1',
  GPTOSS120B = 'openai/gpt-oss-120b',
  GPTOSS20B = 'openai/gpt-oss-20b',
  Qwen35_397B = 'Qwen/Qwen3.5-397B-A17B',
  Qwen3CoderNext = 'Qwen/Qwen3-Coder-Next-FP8',
  Qwen3Coder480B = 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
  Qwen3_235BInstruct2507 = 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
  Qwen3_235BThinking2507 = 'Qwen/Qwen3-235B-A22B-Thinking-2507',
  Qwen3Next80BInstruct = 'Qwen/Qwen3-Next-80B-A3B-Instruct',
  Qwen3Next80BThinking = 'Qwen/Qwen3-Next-80B-A3B-Thinking',
  GLM5 = 'zai-org/GLM-5',
  GLM47 = 'zai-org/GLM-4.7',
  Llama4Maverick = 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
  Llama33_70B = 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
}

export type AxAITogetherChatModel = AxAITogetherModel | (string & {});
