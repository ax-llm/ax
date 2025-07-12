import type { AxAIService } from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import type {
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxProgramForwardOptions,
  AxProgrammable,
} from '../dsp/types.js';

// =============================================================================
// BASIC FLOW TYPES
// =============================================================================

// Type for state object that flows through the pipeline
export type AxFlowState = Record<string, unknown>;

// Type for node definitions in the flow
export interface AxFlowNodeDefinition {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

// Type for flow step functions
export type AxFlowStepFunction = (
  state: AxFlowState,
  context: Readonly<{
    mainAi: AxAIService;
    mainOptions?: AxProgramForwardOptions;
  }>
) => Promise<AxFlowState> | AxFlowState;

// Type for dynamic context overrides
export interface AxFlowDynamicContext {
  ai?: AxAIService;
  options?: AxProgramForwardOptions;
}

// =============================================================================
// ADVANCED TYPE SYSTEM FOR TYPE-SAFE CHAINING
// =============================================================================

// Helper type to extract input type from an AxGen instance
export type GetGenIn<T extends AxGen<AxGenIn, AxGenOut>> = T extends AxGen<
  infer IN,
  AxGenOut
>
  ? IN
  : never;

// Helper type to extract output type from an AxGen instance
export type GetGenOut<T extends AxGen<AxGenIn, AxGenOut>> = T extends AxGen<
  AxGenIn,
  infer OUT
>
  ? OUT
  : never;

// Helper type to create an AxGen type from a signature string
// This is a simplified version - in practice, you'd need more sophisticated parsing
export type InferAxGen<TSig extends string> = TSig extends string
  ? AxGen<AxGenIn, AxGenOut>
  : never;

// Helper type to create result key name from node name
export type NodeResultKey<TNodeName extends string> = `${TNodeName}Result`;

// Helper type to add node result to state
export type AddNodeResult<
  TState extends AxFlowState,
  TNodeName extends string,
  TNodeOut extends AxGenOut,
> = TState & { [K in NodeResultKey<TNodeName>]: TNodeOut };

// =============================================================================
// AXFLOWABLE INTERFACE
// =============================================================================

/**
 * Interface for flows that can be tuned, executed, and used in compositions.
 * Provides methods for building and executing complex AI workflows.
 */
export interface AxFlowable<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgrammable<IN, OUT> {}

// =============================================================================
// TYPED SUB-CONTEXT INTERFACES
// =============================================================================

// Type for parallel branch functions with typed context
// NOTE: The `any` here is necessary because we need to support AxGen with any input/output types
export type AxFlowTypedParallelBranch<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> = (
  subFlow: AxFlowTypedSubContext<TNodes, TState>
) => AxFlowTypedSubContext<TNodes, AxFlowState>;

// Type for typed sub-flow context used in parallel execution
// NOTE: The `any` here is necessary for the same reason as above
export interface AxFlowTypedSubContext<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> {
  execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlowTypedSubContext<
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  >;

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState>;

  executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState>;
}

// Legacy untyped interfaces for backward compatibility
export type AxFlowParallelBranch = (
  subFlow: AxFlowSubContext
) => AxFlowSubContext;

export interface AxFlowSubContext {
  execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this;
  map(transform: (state: AxFlowState) => AxFlowState): this;
  executeSteps(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState>;
}

// Type for branch context
export interface AxFlowBranchContext {
  predicate: (state: AxFlowState) => unknown;
  branches: Map<unknown, AxFlowStepFunction[]>;
  currentBranchValue?: unknown;
}

// =============================================================================
// AUTOMATIC DEPENDENCY ANALYSIS AND PARALLELIZATION
// =============================================================================

// Type for execution step metadata
export interface AxFlowExecutionStep {
  type: 'execute' | 'map' | 'merge' | 'other';
  nodeName?: string;
  dependencies: string[];
  produces: string[];
  stepFunction: AxFlowStepFunction;
  stepIndex: number;
}

// Type for parallel execution groups
export interface AxFlowParallelGroup {
  level: number;
  steps: AxFlowExecutionStep[];
}

// Configuration for automatic parallelization
export interface AxFlowAutoParallelConfig {
  enabled: boolean;
}
