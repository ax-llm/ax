import type { AxAIService } from '../ai/types.js';
import type { AxProgramForwardOptions, AxProgrammable } from '../dsp/types.js';
import { type AxFlowStep, createFlowStep } from './steps.js';
import type {
  AddNodeResult,
  AxFlowDynamicContext,
  AxFlowState,
  AxFlowTypedSubContext,
  GetGenIn,
  GetGenOut,
} from './types.js';

export type AxFlowExecuteStepFactory<
  TNodes extends Record<string, AxProgrammable<any, any>>,
  TState extends AxFlowState,
> = <
  TNodeName extends keyof TNodes & string,
  TAI extends Readonly<AxAIService>,
>(
  nodeName: TNodeName,
  mapping: (state: TState) => GetGenIn<TNodes[TNodeName]>,
  dynamicContext?: AxFlowDynamicContext<TAI>
) => AxFlowStep;

export class AxFlowSubContextImpl<
  TNodes extends Record<string, AxProgrammable<any, any>>,
  TState extends AxFlowState,
> implements AxFlowTypedSubContext<TNodes, TState>
{
  private readonly steps: AxFlowStep[] = [];

  constructor(
    private readonly createExecuteStep: AxFlowExecuteStepFactory<TNodes, TState>
  ) {}

  getSteps(): readonly AxFlowStep[] {
    return this.steps;
  }

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
    this.steps.push(this.createExecuteStep(nodeName, mapping, dynamicContext));
    return this as unknown as AxFlowTypedSubContext<
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >;
  }

  map<TNewState extends AxFlowState>(
    transform: (state: TState) => TNewState
  ): AxFlowTypedSubContext<TNodes, TNewState> {
    this.steps.push(
      createFlowStep({
        kind: 'map',
        isBarrier: true,
        meta: { kind: 'map' },
        run: (state) => transform(state as TState),
      })
    );
    return this as unknown as AxFlowTypedSubContext<TNodes, TNewState>;
  }

  async executeSteps(
    initialState: TState,
    context: Readonly<{
      mainAi: AxAIService;
      mainOptions?: AxProgramForwardOptions<string>;
      executeSteps?: (
        steps: readonly unknown[],
        initialState: AxFlowState
      ) => Promise<AxFlowState>;
    }>
  ): Promise<AxFlowState> {
    if (!context.executeSteps) {
      throw new Error('AxFlow sub-context execution requires a flow executor');
    }
    return await context.executeSteps(this.steps, initialState);
  }
}
