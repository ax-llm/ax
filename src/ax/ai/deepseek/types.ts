/**
 * DeepSeek: Models for text generation
 */
export enum AxAIDeepSeekModel {
  /** DeepSeek's current Flash model (DeepSeek-V4.1-Flash). Accepts text and images. */
  DeepSeekFlash = 'deepseek-flash',
  DeepSeekV4Pro = 'deepseek-v4-pro',
  /**
   * @deprecated Use DeepSeekFlash. DeepSeek retired V4-Flash on 2026-09-10; this
   * id is still accepted and is served by DeepSeek-V4.1-Flash at Flash prices.
   */
  DeepSeekV4Flash = 'deepseek-v4-flash',
  /** @deprecated Use DeepSeekFlash. DeepSeek announced the removal of this alias for 2026-07-24. */
  DeepSeekChat = 'deepseek-chat',
  /** @deprecated Use DeepSeekFlash or DeepSeekV4Pro. */
  DeepSeekCoder = 'deepseek-coder',
  /** @deprecated Use DeepSeekFlash with thinking enabled. DeepSeek announced the removal of this alias for 2026-07-24. */
  DeepSeekReasoner = 'deepseek-reasoner',
}
