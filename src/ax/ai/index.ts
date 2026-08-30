// New AI abstraction layer exports

// Re-export enhanced error types
export {
  AxContentProcessingError,
  AxMediaNotSupportedError,
} from '../util/apicall.js';
export * from './audio/api.js';
export * from './audio/defaults.js';
export type * from './audio/types.js';
export * from './audio/util.js';
export type { AxAIFeatures } from './base.js';
export * from './capabilities.js';
export {
  axAIOpenAIRealtimeDefaultConfig,
  axAIOpenAIRealtimeTranscriptionDefaultConfig,
} from './openai/realtime.js';
export * from './processor.js';
export * from './router.js';
export * from './service_tier.js';
// Re-export enhanced types and features
export type {
  AxAICredentialProvider,
  AxAICredentialRequest,
  AxAIService,
  AxAIServiceOptions,
  AxAppliedServiceTier,
  AxAudioFormat,
  AxChatAudioConfig,
  AxChatAudioOutput,
  AxChatRequest,
  AxContextCacheInfo,
  AxContextCacheOptions,
  AxRateLimitInfo,
  AxRuntimeHooks,
  AxServiceTier,
  AxServiceTierPricing,
  AxStructuredOutputMode,
  AxStructuredOutputRung,
  AxUsageContext,
  AxUsageEvent,
  AxUsageObserver,
} from './types.js';
