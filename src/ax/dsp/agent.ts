/**
 * AxLearnAgent - Lightweight stateful wrapper for self-improving agents.
 *
 * Combines AxGen with trace logging, storage, and a convenient tune() method.
 * This is the high-level API for users who want "zero-configuration" optimization.
 *
 * Note: Named "AxLearnAgent" to avoid conflict with the existing AxAgent class
 * in prompts/agent.ts which handles multi-agent orchestration.
 */

import type { AxAIService } from '../ai/types.js';
import type { AxStorage, AxTrace } from '../mem/storage.js';
import { AxMemoryStorage } from '../mem/storage.js';
import { AxTraceLogger, type AxTraceLoggerOptions } from '../trace/logger.js';
import type { AxGen } from './generate.js';
import { type AxTuneOptions, type AxTuneResult, AxTuner } from './tuner.js';
import type { AxGenIn, AxGenOut, AxProgramForwardOptions } from './types.js';

/**
 * Configuration for AxLearnAgent.
 */
export interface AxLearnAgentOptions {
  /** Unique name/identifier for this agent */
  name: string;

  /** Storage backend (default: AxMemoryStorage) */
  storage?: AxStorage;

  /** Whether to log traces (default: true) */
  enableTracing?: boolean;

  /** Whether to log inputs in traces (default: true) */
  logInputs?: boolean;

  /** Whether to log outputs in traces (default: true) */
  logOutputs?: boolean;

  /** Custom metadata for all traces */
  metadata?: Record<string, unknown>;

  /** Callback when a trace is logged */
  onTrace?: (trace: AxTrace) => void;
}

/**
 * AxLearnAgent wraps an AxGen with automatic trace logging and a convenient tune() method.
 *
 * @example
 * ```typescript
 * const gen = ax(`customer_query -> polite_response`);
 *
 * const agent = new AxLearnAgent(gen, {
 *   name: 'support-bot-v1',
 * });
 *
 * // Use in production - traces are logged automatically
 * const result = await agent.forward(ai, { customer_query: 'Where is my order?' });
 *
 * // Tune the agent to improve it
 * const tuneResult = await agent.tune({
 *   teacher: gpt4o,
 *   budget: 20,
 * });
 * ```
 */
export class AxLearnAgent<IN extends AxGenIn, OUT extends AxGenOut> {
  private gen: AxGen<IN, OUT>;
  private options: Required<
    Pick<
      AxLearnAgentOptions,
      'name' | 'storage' | 'enableTracing' | 'logInputs' | 'logOutputs'
    >
  > &
    Pick<AxLearnAgentOptions, 'metadata' | 'onTrace'>;
  private tracer: AxTraceLogger<IN, OUT>;
  private currentScore?: number;

  constructor(gen: AxGen<IN, OUT>, options: AxLearnAgentOptions) {
    this.gen = gen;
    this.options = {
      name: options.name,
      storage: options.storage ?? new AxMemoryStorage(),
      enableTracing: options.enableTracing ?? true,
      logInputs: options.logInputs ?? true,
      logOutputs: options.logOutputs ?? true,
      metadata: options.metadata,
      onTrace: options.onTrace,
    };

    // Create trace logger
    const tracerOptions: AxTraceLoggerOptions = {
      agentId: this.options.name,
      storage: this.options.storage,
      logInputs: this.options.logInputs,
      logOutputs: this.options.logOutputs,
      metadata: this.options.metadata,
      onTrace: this.options.onTrace,
    };

    this.tracer = new AxTraceLogger(gen, tracerOptions);

    // Try to load the latest checkpoint
    this.loadLatestCheckpoint();
  }

  /**
   * Load the latest checkpoint from storage if available.
   */
  private async loadLatestCheckpoint(): Promise<void> {
    try {
      const checkpoint = await this.options.storage.loadCheckpoint(
        this.options.name
      );
      if (checkpoint?.instruction) {
        this.gen.setInstruction(checkpoint.instruction);
        this.currentScore = checkpoint.score;
      }
    } catch {
      // Ignore load errors on initialization
    }
  }

  /**
   * Forward call - behaves exactly like AxGen.forward() but logs traces.
   */
  async forward(
    ai: AxAIService,
    values: IN,
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<OUT> {
    if (this.options.enableTracing) {
      return this.tracer.forward(ai, values, options);
    }
    return this.gen.forward(ai, values, options);
  }

  /**
   * Tune the agent to improve its performance.
   */
  async tune(
    options: AxTuneOptions & { teacher: AxAIService }
  ): Promise<AxTuneResult<IN, OUT>> {
    const tuner = new AxTuner({
      teacher: options.teacher,
      storage: this.options.storage,
    });

    const result = await tuner.tune(this.gen, {
      ...options,
      storage: this.options.storage,
      agentId: this.options.name,
    });

    // Update the internal generator if improved
    if (result.score > (this.currentScore ?? 0)) {
      this.gen = result.improvedGen;
      this.currentScore = result.score;

      // Update tracer with new gen
      this.tracer = this.tracer.clone(this.gen);
    }

    return result;
  }

  /**
   * Get the underlying AxGen instance.
   */
  getGen(): AxGen<IN, OUT> {
    return this.gen;
  }

  /**
   * Get the agent name.
   */
  getName(): string {
    return this.options.name;
  }

  /**
   * Get the storage backend.
   */
  getStorage(): AxStorage {
    return this.options.storage;
  }

  /**
   * Get recent traces for this agent.
   */
  async getTraces(options?: {
    limit?: number;
    since?: Date;
  }): Promise<AxTrace[]> {
    return this.options.storage.getTraces(this.options.name, options);
  }

  /**
   * Get the current instruction.
   */
  getInstruction(): string | undefined {
    return this.gen.getInstruction();
  }

  /**
   * Set a new instruction.
   */
  setInstruction(instruction: string): void {
    this.gen.setInstruction(instruction);
  }

  /**
   * Get the current best score (if available from tuning).
   */
  getCurrentScore(): number | undefined {
    return this.currentScore;
  }

  /**
   * Clone the agent with a new generator.
   */
  clone(name?: string): AxLearnAgent<IN, OUT> {
    return new AxLearnAgent(this.gen.clone(), {
      name: name ?? this.options.name,
      storage: this.options.storage,
      enableTracing: this.options.enableTracing,
      logInputs: this.options.logInputs,
      logOutputs: this.options.logOutputs,
      metadata: this.options.metadata,
      onTrace: this.options.onTrace,
    });
  }

  /**
   * Enable or disable tracing.
   */
  setTracingEnabled(enabled: boolean): void {
    this.options.enableTracing = enabled;
  }

  /**
   * Update metadata for future traces.
   */
  setMetadata(metadata: Record<string, unknown>): void {
    this.options.metadata = metadata;
    this.tracer.setMetadata(metadata);
  }

  /**
   * Add feedback to a trace.
   */
  async addFeedback(
    traceId: string,
    feedback: NonNullable<AxTrace['feedback']>
  ): Promise<void> {
    await this.options.storage.addFeedback(traceId, feedback);
  }
}

/**
 * Factory function to create an AxLearnAgent instance.
 */
export function axLearnAgent<IN extends AxGenIn, OUT extends AxGenOut>(
  gen: AxGen<IN, OUT>,
  options: AxLearnAgentOptions
): AxLearnAgent<IN, OUT> {
  return new AxLearnAgent(gen, options);
}
