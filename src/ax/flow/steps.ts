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
}

export type AxFlowStepRunner = (
  state: AxFlowState,
  context: AxFlowExecutionContext
) => Promise<AxFlowState> | AxFlowState;

export interface AxFlowStep {
  readonly kind: AxFlowStepKind;
  readonly nodeName?: string;
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  readonly isBarrier: boolean;
  readonly run: AxFlowStepRunner;
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
