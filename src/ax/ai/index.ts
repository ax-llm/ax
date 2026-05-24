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
// Re-export enhanced types and features
export type {
  AxAIService,
  AxAIServiceOptions,
  AxAudioFormat,
  AxChatAudioConfig,
  AxChatAudioOutput,
  AxChatRequest,
  AxContextCacheInfo,
  AxContextCacheOptions,
} from './types.js';
