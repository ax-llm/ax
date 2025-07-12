import type { AxAIService } from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import type { AxProgram, AxProgramForwardOptions } from '../dsp/program.js';
import type { AxFieldValue, AxGenIn, AxGenOut } from '../dsp/types.js';
import type {
  AddNodeResult,
  AxFlowDynamicContext,
  AxFlowParallelBranch,
  AxFlowState,
  AxFlowStepFunction,
  AxFlowSubContext,
  AxFlowTypedParallelBranch,
  AxFlowTypedSubContext,
  GetGenIn,
  GetGenOut,
} from './types.js';

/**
 * Implementation of the sub-context for parallel execution
 */
export class AxFlowSubContextImpl implements AxFlowSubContext {
  private readonly steps: AxFlowStepFunction[] = [];

  constructor(
    private readonly nodeGenerators: Map<
      string,
      AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
    >
  ) {}

  execute(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext
  ): this {
    const nodeProgram = this.nodeGenerators.get(nodeName);
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`);
    }

    this.steps.push(async (state, context) => {
      const ai = dynamicContext?.ai ?? context.mainAi;
      const options = dynamicContext?.options ?? context.mainOptions;
      const nodeInputs = mapping(state);

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`;

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      });

      return {
        ...state,
        [`${nodeName}Result`]: result,
      };
    });

    return this;
  }

  map(transform: (state: AxFlowState) => AxFlowState): this {
    this.steps.push((state) => transform(state));
    return this;
  }

  async executeSteps(
    initialState: AxFlowState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState> {
    let currentState = initialState;

    for (const step of this.steps) {
      currentState = await step(currentState, context);
    }

    return currentState;
  }
}

/**
 * Typed implementation of the sub-context for parallel execution with full type safety
 */
// This class is used by the type system but not directly instantiated in this file
// NOTE: The `any` here is necessary for the same reason as in the interfaces above
export class AxFlowTypedSubContextImpl<
  TNodes extends Record<string, AxGen<any, any>>,
  TState extends AxFlowState,
> implements AxFlowTypedSubContext<TNodes, TState>
{
  private readonly steps: AxFlowStepFunction[] = [];

  constructor(
    private readonly nodeGenerators: Map<
      string,
      AxGen<AxGenIn, AxGenOut> | AxProgram<AxGenIn, AxGenOut>
    >
  ) {}

  execute<TNodeName extends keyof TNodes & string>(
    nodeName: TNodeName,
    mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext
  ): AxFlowTypedSubContext<
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    const nodeProgram = this.nodeGenerators.get(nodeName);
    if (!nodeProgram) {
      throw new Error(`Node program for '${nodeName}' not found.`);
    }

    this.steps.push(async (state, context) => {
      const ai = dynamicContext?.ai ?? context.mainAi;
      const options = dynamicContext?.options ?? context.mainOptions;
      const nodeInputs = mapping(state as TState);

      // Create trace label for the node execution
      const traceLabel = options?.traceLabel
        ? `Node:${nodeName} (${options.traceLabel})`
        : `Node:${nodeName}`;

      // Execute the node with updated trace label
      const result = await nodeProgram.forward(ai, nodeInputs, {
        ...options,
        traceLabel,
      });

      return {
        ...state,
        [`${nodeName}Result`]: result,
      };
    });

    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as AxFlowTypedSubContext<
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >;
  }

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState> {
    this.steps.push((state) => transform(state as TState));
    // NOTE: This type assertion is necessary for the type-level programming pattern
    return this as unknown as AxFlowTypedSubContext<TNodes, TNewState>;
  }

  async executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions;
    }>
  ): Promise<AxFlowState> {
    let currentState: AxFlowState = initialState;

    for (const step of this.steps) {
      currentState = await step(currentState, context);
    }

    return currentState;
  }
}

// Type exports for parallel branch functions
export type { AxFlowParallelBranch, AxFlowTypedParallelBranch };
