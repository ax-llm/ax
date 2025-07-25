// New AI abstraction layer exports
export * from './processor.js';
export * from './capabilities.js';
export * from './router.js';

// Re-export enhanced error types
export {
  AxMediaNotSupportedError,
  AxContentProcessingError,
} from '../util/apicall.js';

// Re-export enhanced types and features
export type {
  AxChatRequest,
  AxAIService,
  AxAIServiceOptions,
} from './types.js';

export type { AxAIFeatures } from './base.js';
