import type { AxAIService } from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import type { AxProgram } from '../dsp/program.js';
import type {
  AxFieldValue,
  AxForwardable,
  AxGenIn,
  AxGenOut,
  AxProgramForwardOptions,
  AxTunable,
  AxUsable,
} from '../dsp/types.js';
import type {
  AddNodeResult,
  AxFlowDynamicContext,
  AxFlowState,
  AxFlowStepFunction,
  AxFlowSubContext,
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
      AxForwardable<AxGenIn, AxGenOut, string> &
        AxTunable<AxGenIn, AxGenOut> &
        AxUsable
    >
  ) {}

  execute<TAI extends Readonly<AxAIService>>(
    nodeName: string,
    mapping: (state: AxFlowState) => Record<string, AxFieldValue>,
    dynamicContext?: AxFlowDynamicContext<TAI>
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
      // Handle both AxGen and AxProgram types
      let result: any;
      if (
        'forward' in nodeProgram &&
        typeof nodeProgram.forward === 'function'
      ) {
        result = await nodeProgram.forward(ai, nodeInputs, {
          ...options,
          traceLabel,
        });
      } else {
        throw new Error(
          `Node program for '${nodeName}' does not have a forward method`
        );
      }

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
      mainOptions?: AxProgramForwardOptions<string>;
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
      // Handle both AxGen and AxProgram types
      let result: any;
      if (
        'forward' in nodeProgram &&
        typeof nodeProgram.forward === 'function'
      ) {
        result = await nodeProgram.forward(ai, nodeInputs, {
          ...options,
          traceLabel,
        });
      } else {
        throw new Error(
          `Node program for '${nodeName}' does not have a forward method`
        );
      }

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
      mainOptions?: AxProgramForwardOptions<string>;
    }>
  ): Promise<AxFlowState> {
    let currentState: AxFlowState = initialState;

    for (const step of this.steps) {
      currentState = await step(currentState, context);
    }

    return currentState;
  }
}
