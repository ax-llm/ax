import type { AxAIService } from '../ai/types.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';
import type { AxFlowExecutionPlanStep, AxFlowState } from './types.js';

export type AxFlowStepKind =
  | 'execute'
  | 'map'
  | 'returns'
  | 'branch'
  | 'while'
  | 'feedback'
  | 'parallel'
  | 'parallelMerge'
  | 'derive';

export interface AxFlowExecutionContext {
  mainAi: AxAIService;
  mainOptions?: AxProgramForwardOptions<string>;
  autoParallel: boolean;
  batchSize?: number;
  executeSteps: (
    steps: readonly AxFlowStep[],
    initialState: AxFlowState
  ) => Promise<AxFlowState>;
  checkAbort: (location: string) => void;
  captureRemoteTasks?: () => unknown;
  cancelRemoteTasksSince?: (snapshot: unknown) => Promise<void>;
}

export type AxFlowStepRunner = (
  state: AxFlowState,
  context: AxFlowExecutionContext
) => Promise<AxFlowState> | AxFlowState;

// Which node output field decides a branch/feedback, and (for feedback) the
// option value that keeps the loop running. Set by flow.fromMermaid() so
// toMermaid() can render exact diamonds and edge labels without sniffing.
export type AxFlowStepDecision = {
  readonly nodeName: string;
  readonly field: string;
  readonly value?: unknown;
};

// Build-time metadata describing what a control step contains. The executor
// ignores this entirely — it exists so introspection (toMermaid, debugging)
// can see inside steps whose bodies are otherwise closure-captured.
export type AxFlowStepMeta =
  | {
      readonly kind: 'branch';
      readonly predicate: (state: AxFlowState) => unknown;
      readonly branches: ReadonlyArray<
        readonly [unknown, readonly AxFlowStep[]]
      >;
      readonly decision?: AxFlowStepDecision;
    }
  | {
      readonly kind: 'while';
      readonly bodySteps: readonly AxFlowStep[];
      readonly condition: (state: AxFlowState) => boolean;
      readonly maxIterations: number;
      readonly conditionName?: string;
    }
  | {
      readonly kind: 'feedback';
      // These alias steps already present in the parent list (feedback loops
      // back over previously-added steps).
      readonly bodySteps: readonly AxFlowStep[];
      readonly targetLabel: string;
      readonly condition: (state: AxFlowState) => boolean;
      readonly maxIterations: number;
      readonly decision?: AxFlowStepDecision;
      readonly conditionName?: string;
    }
  | {
      readonly kind: 'parallel';
      readonly branchFns: ReadonlyArray<(subContext: unknown) => unknown>;
    }
  | { readonly kind: 'parallelMerge'; readonly resultKey: string }
  | { readonly kind: 'map'; readonly name?: string }
  | {
      readonly kind: 'returns';
      // Synthetic returns are added by flow.fromMermaid() to project terminal
      // node outputs; toMermaid() omits them instead of drawing a node.
      readonly synthetic?: boolean;
    };

export interface AxFlowStep {
  readonly kind: AxFlowStepKind;
  readonly nodeName?: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly isBarrier: boolean;
  readonly run: AxFlowStepRunner;
  readonly meta?: AxFlowStepMeta;
}

export interface AxFlowBlockLabel {
  readonly steps: AxFlowStep[];
  readonly index: number;
}

export function createFlowStep(
  step: Omit<AxFlowStep, 'reads' | 'writes' | 'isBarrier'> &
    Partial<Pick<AxFlowStep, 'reads' | 'writes' | 'isBarrier'>>
): AxFlowStep {
  return {
    reads: [],
    writes: [],
    isBarrier: false,
    ...step,
  };
}

export function toPlanStep(
  step: AxFlowStep,
  stepIndex: number
): AxFlowExecutionPlanStep {
  return {
    type: step.kind,
    nodeName: step.nodeName,
    dependencies: [...step.reads],
    produces: [...step.writes],
    stepIndex,
    isBarrier: step.isBarrier,
  };
}
