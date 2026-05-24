/**
 * DeepSeek: Models for text generation
 */
export enum AxAIDeepSeekModel {
  DeepSeekV4Flash = 'deepseek-v4-flash',
  DeepSeekV4Pro = 'deepseek-v4-pro',
  /** @deprecated Use DeepSeekV4Flash. DeepSeek will remove this alias on 2026-07-24. */
  DeepSeekChat = 'deepseek-chat',
  /** @deprecated Use DeepSeekV4Flash or DeepSeekV4Pro. */
  DeepSeekCoder = 'deepseek-coder',
  /** @deprecated Use DeepSeekV4Flash with thinking enabled. DeepSeek will remove this alias on 2026-07-24. */
  DeepSeekReasoner = 'deepseek-reasoner',
}
