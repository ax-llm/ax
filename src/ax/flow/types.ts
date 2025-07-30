import type { AxAIService } from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import type {
  AxFieldValue,
  AxProgramForwardOptions,
  AxProgrammable,
  ParseSignature,
} from '../dsp/types.js';

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
    mainOptions?: AxProgramForwardOptions<string>;
  }>
) => Promise<AxFlowState> | AxFlowState;

// Type for dynamic context overrides
export interface AxFlowDynamicContext<T extends Readonly<AxAIService>> {
  ai?: T;
  options?: AxProgramForwardOptions<
    NonNullable<ReturnType<T['getModelList']>>[number]['key']
  >;
}

// Helper type to extract input type from an AxProgrammable instance (including AxGen)
export type GetGenIn<T extends AxProgrammable<any, any>> =
  T extends AxProgrammable<infer IN, any> ? IN : never;

// Helper type to extract output type from an AxProgrammable instance (including AxGen)
export type GetGenOut<T extends AxProgrammable<any, any>> =
  T extends AxProgrammable<any, infer OUT> ? OUT : never;

// Helper type to create an AxGen type from a signature string
// Uses ParseSignature to extract proper input/output types
export type InferAxGen<TSig extends string> = AxGen<
  ParseSignature<TSig>['inputs'],
  ParseSignature<TSig>['outputs']
>;

// Helper type to create result key name from node name
export type NodeResultKey<TNodeName extends string> = `${TNodeName}Result`;

// Helper type to add node result to state
export type AddNodeResult<
  TState extends AxFlowState,
  TNodeName extends string,
  TNodeOut,
> = TState & { [K in NodeResultKey<TNodeName>]: TNodeOut };

/**
 * Interface for flows that can be tuned, executed, and used in compositions.
 * Provides methods for building and executing complex AI workflows.
 */
export interface AxFlowable<IN, OUT> extends AxProgrammable<IN, OUT> {}

// Type for parallel branch functions with typed context
// NOTE: The `any` here is necessary because we need to support AxProgrammable with any input/output types
export type AxFlowTypedParallelBranch<
  TNodes extends Record<string, AxProgrammable<any, any>>,
  TState extends AxFlowState,
> = (
  subFlow: AxFlowTypedSubContext<TNodes, TState>
) => AxFlowTypedSubContext<TNodes, AxFlowState>;

// Type for typed sub-flow context used in parallel execution
// NOTE: The `any` here is necessary for the same reason as above
export interface AxFlowTypedSubContext<
  TNodes extends Record<string, AxProgrammable<any, any>>,
  TState extends AxFlowState,
> {
  execute<
    TNodeName extends keyof TNodes & string,
    TAI extends Readonly<AxAIService>,
  >(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext<TAI>
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
      mainOptions?: AxProgramForwardOptions<string>;
    }>
  ): Promise<AxFlowState>;
}

// Legacy untyped interfaces for backward compatibility
export type AxFlowParallelBranch = (
  subFlow: AxFlowSubContext
) => AxFlowSubContext;

export interface AxFlowSubContext {
  execute<TAI extends Readonly<AxAIService>>(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext<TAI>
  ): this;
  map(transform: (state: AxFlowState) => AxFlowState): this;
  executeSteps<TAI extends Readonly<AxAIService>>(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: TAI;
      mainOptions?: AxProgramForwardOptions<
        NonNullable<ReturnType<TAI['getModelList']>>[number]['key']
      >;
    }>
  ): Promise<AxFlowState>;
}

// Type for branch context
export interface AxFlowBranchContext {
  predicate: (state: AxFlowState) => unknown;
  branches: Map<unknown, AxFlowStepFunction[]>;
  currentBranchValue?: unknown;
}

// Type for execution step metadata
export interface AxFlowExecutionStep {
  type: 'execute' | 'map' | 'merge' | 'parallel-map' | 'parallel' | 'derive';
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
  batchSize?: number;
}
