/**
 * AxStorage - Persistence layer for traces, checkpoints, and agent state.
 *
 * This module provides a pluggable storage interface that works across
 * different environments (browser, Node.js, cloud).
 */

/**
 * Represents a single trace event from an AxGen execution.
 */
export interface AxTrace {
  /** Unique identifier for this trace */
  id: string;
  /** Agent or generator identifier */
  agentId: string;
  /** Input values passed to forward() */
  input: Record<string, unknown>;
  /** Output values from forward() */
  output: Record<string, unknown>;
  /** Timestamp when execution started */
  startTime: Date;
  /** Timestamp when execution completed */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Model used for generation */
  model?: string;
  /** Token usage statistics */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** User feedback if provided */
  feedback?: {
    score?: number;
    label?: string;
    comment?: string;
  };
  /** Error message if execution failed */
  error?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a serialized checkpoint of an AxGen configuration.
 */
export interface AxCheckpoint {
  /** Agent or generator identifier */
  agentId: string;
  /** Version number for this checkpoint */
  version: number;
  /** Timestamp when checkpoint was created */
  createdAt: Date;
  /** Serialized instruction string */
  instruction?: string;
  /** Serialized examples/demos */
  examples?: Array<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
  }>;
  /** Optimization score at checkpoint */
  score?: number;
  /** Optimization method used */
  optimizerType?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query options for retrieving traces.
 */
export interface AxTraceQueryOptions {
  /** Filter traces after this date */
  since?: Date;
  /** Filter traces before this date */
  until?: Date;
  /** Maximum number of traces to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by feedback presence */
  hasFeedback?: boolean;
  /** Filter by error presence */
  hasError?: boolean;
}

/**
 * Storage interface for AxLearn persistence.
 */
export interface AxStorage {
  saveTrace(trace: Readonly<AxTrace>): Promise<void>;
  getTraces(agentId: string, options?: AxTraceQueryOptions): Promise<AxTrace[]>;
  getTraceCount(agentId: string): Promise<number>;
  deleteTraces(agentId: string, traceIds?: string[]): Promise<void>;
  addFeedback(
    traceId: string,
    feedback: NonNullable<AxTrace['feedback']>
  ): Promise<void>;
  saveCheckpoint(checkpoint: Readonly<AxCheckpoint>): Promise<void>;
  loadCheckpoint(agentId: string): Promise<AxCheckpoint | null>;
  loadCheckpointVersion(
    agentId: string,
    version: number
  ): Promise<AxCheckpoint | null>;
  listCheckpoints(agentId: string): Promise<AxCheckpoint[]>;
  deleteCheckpoint(agentId: string, version?: number): Promise<void>;
  clear(agentId: string): Promise<void>;
  clearAll(): Promise<void>;
}

/**
 * In-memory storage implementation.
 */
export class AxMemoryStorage implements AxStorage {
  private traces: Map<string, AxTrace[]> = new Map();
  private checkpoints: Map<string, AxCheckpoint[]> = new Map();

  async saveTrace(trace: Readonly<AxTrace>): Promise<void> {
    const traces = this.traces.get(trace.agentId) ?? [];
    traces.push({ ...trace });
    this.traces.set(trace.agentId, traces);
  }

  async getTraces(
    agentId: string,
    options?: AxTraceQueryOptions
  ): Promise<AxTrace[]> {
    let traces = this.traces.get(agentId) ?? [];

    if (options?.since) {
      traces = traces.filter((t) => t.startTime >= options.since!);
    }
    if (options?.until) {
      traces = traces.filter((t) => t.startTime <= options.until!);
    }
    if (options?.hasFeedback !== undefined) {
      traces = traces.filter(
        (t) => (t.feedback !== undefined) === options.hasFeedback
      );
    }
    if (options?.hasError !== undefined) {
      traces = traces.filter(
        (t) => (t.error !== undefined) === options.hasError
      );
    }

    traces = traces.sort(
      (a, b) => b.startTime.getTime() - a.startTime.getTime()
    );

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? traces.length;
    return traces.slice(offset, offset + limit);
  }

  async getTraceCount(agentId: string): Promise<number> {
    return this.traces.get(agentId)?.length ?? 0;
  }

  async deleteTraces(agentId: string, traceIds?: string[]): Promise<void> {
    if (!traceIds) {
      this.traces.delete(agentId);
      return;
    }
    const traces = this.traces.get(agentId) ?? [];
    const idsToDelete = new Set(traceIds);
    this.traces.set(
      agentId,
      traces.filter((t) => !idsToDelete.has(t.id))
    );
  }

  async addFeedback(
    traceId: string,
    feedback: NonNullable<AxTrace['feedback']>
  ): Promise<void> {
    for (const traces of this.traces.values()) {
      const trace = traces.find((t) => t.id === traceId);
      if (trace) {
        trace.feedback = { ...trace.feedback, ...feedback };
        return;
      }
    }
  }

  async saveCheckpoint(checkpoint: Readonly<AxCheckpoint>): Promise<void> {
    const checkpoints = this.checkpoints.get(checkpoint.agentId) ?? [];
    const existingIndex = checkpoints.findIndex(
      (c) => c.version === checkpoint.version
    );
    if (existingIndex >= 0) {
      checkpoints[existingIndex] = { ...checkpoint };
    } else {
      checkpoints.push({ ...checkpoint });
    }
    checkpoints.sort((a, b) => b.version - a.version);
    this.checkpoints.set(checkpoint.agentId, checkpoints);
  }

  async loadCheckpoint(agentId: string): Promise<AxCheckpoint | null> {
    const checkpoints = this.checkpoints.get(agentId) ?? [];
    return checkpoints[0] ?? null;
  }

  async loadCheckpointVersion(
    agentId: string,
    version: number
  ): Promise<AxCheckpoint | null> {
    const checkpoints = this.checkpoints.get(agentId) ?? [];
    return checkpoints.find((c) => c.version === version) ?? null;
  }

  async listCheckpoints(agentId: string): Promise<AxCheckpoint[]> {
    return this.checkpoints.get(agentId) ?? [];
  }

  async deleteCheckpoint(agentId: string, version?: number): Promise<void> {
    if (version === undefined) {
      this.checkpoints.delete(agentId);
      return;
    }
    const checkpoints = this.checkpoints.get(agentId) ?? [];
    this.checkpoints.set(
      agentId,
      checkpoints.filter((c) => c.version !== version)
    );
  }

  async clear(agentId: string): Promise<void> {
    this.traces.delete(agentId);
    this.checkpoints.delete(agentId);
  }

  async clearAll(): Promise<void> {
    this.traces.clear();
    this.checkpoints.clear();
  }
}
