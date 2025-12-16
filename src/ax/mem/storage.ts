/**
 * AxStorage - Persistence layer for traces, checkpoints, and agent state.
 *
 * This module provides a pluggable storage interface that works across
 * different environments (browser, Node.js, cloud).
 */

/**
 * Represents a single trace event from an AxGen execution.
 */
/**
 * Represents a single trace event from an AxGen execution.
 */
export interface AxTrace {
  type: 'trace';
  /** Unique identifier for this trace */
  id: string;
  /** Agent or generator name */
  name: string;
  // ... (rest of fields same, but flattened if needed, keeping structure)
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
  type: 'checkpoint';
  /** Agent or generator name */
  name: string;
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
 * Query options for retrieving items.
 */
export interface AxStorageQuery {
  type: 'trace' | 'checkpoint';
  /** Filter traces after this date */
  since?: Date;
  /** Filter traces before this date */
  until?: Date;
  /** Maximum number of items to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by trace ID or checkpoint version */
  id?: string;
  version?: number;
  /** Filter by feedback presence */
  hasFeedback?: boolean;
}

/**
 * Storage interface for AxLearn persistence.
 */
export type AxStorage = {
  save: (name: string, item: AxTrace | AxCheckpoint) => Promise<void>;
  load: (
    name: string,
    query: AxStorageQuery
  ) => Promise<(AxTrace | AxCheckpoint)[]>;
};
