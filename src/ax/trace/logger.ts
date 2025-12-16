/**
 * AxTraceLogger - Decorator that intercepts AxGen.forward() calls and logs traces.
 *
 * This provides a non-intrusive way to add logging to any AxGen instance
 * without modifying the original class.
 */

import type { AxAIService } from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import type {
  AxGenIn,
  AxGenOut,
  AxProgramForwardOptions,
} from '../dsp/types.js';
import type { AxStorage, AxTrace } from '../mem/storage.js';

/**
 * Configuration options for AxTraceLogger
 */
export interface AxTraceLoggerOptions {
  /** Unique identifier for this agent/generator */
  agentId: string;
  /** Storage backend for persisting traces */
  storage: AxStorage;
  /** Whether to include input values in traces (default: true) */
  logInputs?: boolean;
  /** Whether to include output values in traces (default: true) */
  logOutputs?: boolean;
  /** Custom metadata to include in all traces */
  metadata?: Record<string, unknown>;
  /** Callback when a trace is logged */
  onTrace?: (trace: AxTrace) => void;
  /** Whether logging errors should throw (default: false - errors are silently caught) */
  throwOnError?: boolean;
}

/**
 * Generates a unique trace ID using timestamp and random suffix.
 */
function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `trace-${timestamp}-${random}`;
}

/**
 * AxTraceLogger wraps an AxGen instance to automatically log all forward() calls.
 *
 * @example
 * ```typescript
 * const gen = ax(`query -> response`);
 * const storage = new AxMemoryStorage();
 *
 * const tracedGen = new AxTraceLogger(gen, {
 *   agentId: 'my-agent',
 *   storage,
 * });
 *
 * // Use exactly like AxGen
 * const result = await tracedGen.forward(ai, { query: 'Hello' });
 *
 * // Traces are automatically saved to storage
 * const traces = await storage.getTraces('my-agent');
 * ```
 */
export class AxTraceLogger<IN extends AxGenIn, OUT extends AxGenOut> {
  private gen: AxGen<IN, OUT>;
  private options: Required<
    Pick<
      AxTraceLoggerOptions,
      'agentId' | 'storage' | 'logInputs' | 'logOutputs' | 'throwOnError'
    >
  > &
    Pick<AxTraceLoggerOptions, 'metadata' | 'onTrace'>;

  constructor(gen: AxGen<IN, OUT>, options: AxTraceLoggerOptions) {
    this.gen = gen;
    this.options = {
      agentId: options.agentId,
      storage: options.storage,
      logInputs: options.logInputs ?? true,
      logOutputs: options.logOutputs ?? true,
      metadata: options.metadata,
      onTrace: options.onTrace,
      throwOnError: options.throwOnError ?? false,
    };
  }

  /**
   * Forward call to the underlying AxGen with trace logging.
   */
  async forward(
    ai: AxAIService,
    values: IN,
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<OUT> {
    const traceId = generateTraceId();
    const startTime = new Date();

    let output: OUT | undefined;
    let error: string | undefined;

    try {
      output = await this.gen.forward(ai, values, options);
      return output;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      // Build the trace
      const trace: AxTrace = {
        id: traceId,
        agentId: this.options.agentId,
        input: this.options.logInputs
          ? (values as Record<string, unknown>)
          : {},
        output:
          this.options.logOutputs && output
            ? (output as Record<string, unknown>)
            : {},
        startTime,
        endTime,
        durationMs,
        model: options?.model ?? undefined,
        metadata: this.options.metadata,
        error,
      };

      // Save trace asynchronously (fire-and-forget by default)
      this.saveTrace(trace);
    }
  }

  /**
   * Save trace to storage with error handling.
   */
  private async saveTrace(trace: AxTrace): Promise<void> {
    try {
      await this.options.storage.saveTrace(trace);

      if (this.options.onTrace) {
        this.options.onTrace(trace);
      }
    } catch (err) {
      if (this.options.throwOnError) {
        throw err;
      }
      console.warn('AxTraceLogger: Failed to save trace:', err);
    }
  }

  /**
   * Get the underlying AxGen instance.
   */
  getGen(): AxGen<IN, OUT> {
    return this.gen;
  }

  /**
   * Get the agent ID.
   */
  getAgentId(): string {
    return this.options.agentId;
  }

  /**
   * Get the storage backend.
   */
  getStorage(): AxStorage {
    return this.options.storage;
  }

  /**
   * Update the metadata for future traces.
   */
  setMetadata(metadata: Record<string, unknown>): void {
    this.options.metadata = metadata;
  }

  /**
   * Clone the logger with a new underlying AxGen.
   */
  clone(newGen?: AxGen<IN, OUT>): AxTraceLogger<IN, OUT> {
    return new AxTraceLogger(newGen ?? this.gen.clone(), {
      agentId: this.options.agentId,
      storage: this.options.storage,
      logInputs: this.options.logInputs,
      logOutputs: this.options.logOutputs,
      metadata: this.options.metadata,
      onTrace: this.options.onTrace,
      throwOnError: this.options.throwOnError,
    });
  }
}

/**
 * Helper function to create a trace logger.
 */
export function traceLogger<IN extends AxGenIn, OUT extends AxGenOut>(
  gen: AxGen<IN, OUT>,
  options: AxTraceLoggerOptions
): AxTraceLogger<IN, OUT> {
  return new AxTraceLogger(gen, options);
}
