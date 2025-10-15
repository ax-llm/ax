import type { AxExample } from '../common_types.js';

/**
 * Individual playbook bullet with metadata used for incremental updates.
 * Mirrors the structure described in the ACE paper (Section 3.1).
 */
export interface AxACEBullet extends Record<string, unknown> {
  id: string;
  section: string;
  content: string;
  helpfulCount: number;
  harmfulCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated ACE playbook structure grouped by sections.
 */
export interface AxACEPlaybook {
  version: number;
  sections: Record<string, AxACEBullet[]>;
  stats: {
    bulletCount: number;
    helpfulCount: number;
    harmfulCount: number;
    tokenEstimate: number;
  };
  updatedAt: string;
  description?: string;
}

/**
 * Generator output format (Appendix B of the paper) distilled to core fields.
 */
export interface AxACEGeneratorOutput extends Record<string, unknown> {
  reasoning: string;
  answer: unknown;
  bulletIds: string[];
  trajectory?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Reflection payload, mapping to the Reflector JSON schema in the paper.
 */
export interface AxACEReflectionOutput extends Record<string, unknown> {
  reasoning: string;
  errorIdentification: string;
  rootCauseAnalysis: string;
  correctApproach: string;
  keyInsight: string;
  bulletTags: { id: string; tag: 'helpful' | 'harmful' | 'neutral' }[];
  metadata?: Record<string, unknown>;
}

/**
 * Curator operations emitted as deltas (Section 3.1).
 */
export type AxACECuratorOperationType = 'ADD' | 'UPDATE' | 'REMOVE';

export interface AxACECuratorOperation {
  type: AxACECuratorOperationType;
  section: string;
  bulletId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface AxACECuratorOutput extends Record<string, unknown> {
  reasoning: string;
  operations: AxACECuratorOperation[];
  metadata?: Record<string, unknown>;
}

/**
 * Runtime feedback captured after each generator rollout for online updates.
 */
export interface AxACEFeedbackEvent {
  example: AxExample;
  prediction: unknown;
  score: number;
  generatorOutput: AxACEGeneratorOutput;
  reflection?: AxACEReflectionOutput;
  curator?: AxACECuratorOutput;
  timestamp: string;
}

/**
 * Configuration options specific to ACE inside Ax.
 */
export interface AxACEOptions {
  /**
   * Maximum number of epochs for offline adaptation.
   */
  maxEpochs?: number;
  /**
   * Maximum reflector refinement rounds (paper uses up to 5).
   */
  maxReflectorRounds?: number;
  /**
   * Maximum bullets allowed in any section before triggering pruning.
   */
  maxSectionSize?: number;
  /**
   * Optional similarity threshold used by the semantic deduper.
   */
  similarityThreshold?: number;
  /**
   * Whether to automatically create sections when curator emits new ones.
   */
  allowDynamicSections?: boolean;
  /**
   * Initial playbook supplied by the caller.
   */
  initialPlaybook?: AxACEPlaybook;
}

/**
 * Serialized artifact saved after optimization for future reuse.
 */
export interface AxACEOptimizationArtifact {
  playbook: AxACEPlaybook;
  feedback: AxACEFeedbackEvent[];
  history: {
    epoch: number;
    exampleIndex: number;
    operations: AxACECuratorOperation[];
  }[];
}
