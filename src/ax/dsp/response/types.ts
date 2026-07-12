import type { Context, Span, Tracer } from '@opentelemetry/api';
import type { AxPromptMetrics } from '../../ai/promptMetrics.js';
import type {
  AxAIService,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxLoggerFunction,
} from '../../ai/types.js';
import type { AxAIMemory } from '../../mem/types.js';
import type { AxAssertion, AxStreamingAssertion } from '../asserts.js';
import type { extractionState } from '../extract.js';
import type { AxFieldProcessor } from '../fieldProcessor.js';
import type { SignatureToolCallingManager } from '../signatureToolCalling.js';
import type { AxStepContextImpl } from '../stepContext.js';
import type { StructuredStreamAccumulator } from './structuredDelta.js';

export interface AxResponseHandlerArgs<T> {
  ai: Readonly<AxAIService>;
  model?: string;
  res: T;
  mem: AxAIMemory;
  sessionId?: string;
  traceId?: string;
  traceContext?: Context;
  tracer?: Tracer;
  functions: Readonly<AxFunction[]>;
  strictMode?: boolean;
  span?: Span;
  logger: AxLoggerFunction;
  debugPromptMetrics?: Readonly<AxPromptMetrics>;
  onFunctionCall?: (
    call: Readonly<import('../types.js').AxFunctionCallTrace>
  ) => void | Promise<void>;
  mcpExecutionContext?: import('../../mcp/execution.js').AxMCPExecutionContext;
  eventContext?: import('../../event/types.js').AxEventContext;
}

export type InternalAxGenState = {
  index: number;
  values: Record<string, any>;
  content: string;
  functionsExecuted: Set<string>;
  functionCalls: NonNullable<AxChatResponseResult['functionCalls']>;
  xstate: extractionState;
  structuredAccumulator?: StructuredStreamAccumulator;
};

export type ProcessResponseBaseArgs = Readonly<
  AxResponseHandlerArgs<AxChatResponse>
> & {
  states: InternalAxGenState[];
  usage: import('../../ai/types.js').AxModelUsage[];
  excludeContentFromTrace: boolean;
  asserts: AxAssertion<any>[];
  fieldProcessors: AxFieldProcessor[];
  thoughtFieldName: string;
  signature: import('../sig.js').AxSignature;
  parseJsonStringFields: boolean;
  debug: boolean;
  functionResultFormatter?: (result: unknown) => string;
  signatureToolCallingManager?: SignatureToolCallingManager;
  stopFunctionNames?: readonly string[];
  disableMemoryCleanup?: boolean;
  stepContext?: AxStepContextImpl;
  abortSignal?: AbortSignal;
};

export type ProcessStreamingResponseArgs = Readonly<
  AxResponseHandlerArgs<ReadableStream<AxChatResponse>>
> & {
  states: InternalAxGenState[];
  usage: import('../../ai/types.js').AxModelUsage[];
  streamingAsserts: AxStreamingAssertion[];
  asserts: AxAssertion<any>[];
  fieldProcessors: AxFieldProcessor[];
  streamingFieldProcessors: AxFieldProcessor[];
  thoughtFieldName: string;
  signature: import('../sig.js').AxSignature;
  excludeContentFromTrace: boolean;
  parseJsonStringFields: boolean;
  debug: boolean;
  functionResultFormatter?: (result: unknown) => string;
  signatureToolCallingManager: SignatureToolCallingManager | undefined;
  stopFunctionNames?: readonly string[];
  disableMemoryCleanup?: boolean;
  stepContext?: AxStepContextImpl;
  abortSignal?: AbortSignal;
};

export type FinalizeStreamingResponseArgs = Readonly<
  Omit<ProcessStreamingResponseArgs, 'res' | 'states' | 'usage'> & {
    state: InternalAxGenState;
    stepContext?: AxStepContextImpl;
  }
>;
