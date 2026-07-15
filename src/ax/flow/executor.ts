import type { AxAIService } from '../ai/types.js';
import type {
  AxChatLogEntry,
  AxGenOut,
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramTrace,
  AxProgramUsage,
} from '../dsp/types.js';
import { mergeAbortSignals } from '../util/abort.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';
import { processBatches } from './batchUtil.js';
import { AxFlowExecutionPlanner } from './executionPlanner.js';
import type { AxFlowLoggerFunction } from './logger.js';
import type {
  AxFlowExecutionContext,
  AxFlowStep,
  AxFlowStepKind,
} from './steps.js';
import type { AxFlowState } from './types.js';

export interface AxFlowNodeExecutionRecorder {
  recordUsage(nodeName: string, usage: AxProgramUsage[]): void;
  recordTraces(nodeName: string, traces: AxProgramTrace<any, any>[]): void;
  recordChatLog(nodeName: string, entries: AxChatLogEntry[]): void;
}

export interface AxFlowNodeExecutionArgs {
  nodeName: string;
  nodeProgram: AxProgrammable<any, any, unknown>;
  ai: Readonly<AxAIService>;
  inputs: AxFlowState;
  options?: AxProgramForwardOptions<string>;
  recorder?: AxFlowNodeExecutionRecorder;
}

function flattenUsage(usage: unknown): AxProgramUsage[] {
  if (Array.isArray(usage)) {
    return usage as AxProgramUsage[];
  }
  if (usage && typeof usage === 'object') {
    const maybeSplit = usage as {
      actor?: AxProgramUsage[];
      responder?: AxProgramUsage[];
    };
    return [...(maybeSplit.actor ?? []), ...(maybeSplit.responder ?? [])];
  }
  return [];
}

export async function executeNodeProgram({
  nodeName,
  nodeProgram,
  ai,
  inputs,
  options,
  recorder,
}: AxFlowNodeExecutionArgs): Promise<AxGenOut> {
  if (
    !('forward' in nodeProgram) ||
    typeof nodeProgram.forward !== 'function'
  ) {
    throw new Error(
      `Node program for '${nodeName}' does not have a forward method`
    );
  }

  const traceLabel = options?.traceLabel
    ? `Node:${nodeName} (${options.traceLabel})`
    : `Node:${nodeName}`;

  const result = await nodeProgram.forward(ai, inputs, {
    ...options,
    traceLabel,
  });

  if (recorder && 'getUsage' in nodeProgram) {
    const getUsage = nodeProgram.getUsage;
    if (typeof getUsage === 'function') {
      const flatUsage = flattenUsage(getUsage.call(nodeProgram));
      if (flatUsage.length > 0) {
        recorder.recordUsage(nodeName, flatUsage);
      }
    }
  }

  if (recorder && 'getTraces' in nodeProgram) {
    const getTraces = nodeProgram.getTraces;
    if (typeof getTraces === 'function') {
      const traces = getTraces.call(nodeProgram);
      if (Array.isArray(traces) && traces.length > 0) {
        recorder.recordTraces(nodeName, traces);
      }
    }
  }

  if (recorder && 'getChatLog' in nodeProgram) {
    const getChatLog = nodeProgram.getChatLog;
    if (typeof getChatLog === 'function') {
      const entries = getChatLog.call(nodeProgram);
      if (Array.isArray(entries) && entries.length > 0) {
        recorder.recordChatLog(
          nodeName,
          entries.map((entry: AxChatLogEntry) => ({
            ...entry,
            name: entry.name ? `${nodeName}.${entry.name}` : nodeName,
          }))
        );
      }
    }
  }

  return result as AxGenOut;
}

export interface AxFlowExecuteStepsOptions {
  autoParallel: boolean;
  batchSize?: number;
  logger?: AxFlowLoggerFunction;
}

function logStepStart(
  logger: AxFlowLoggerFunction | undefined,
  step: AxFlowStep,
  stepIndex: number,
  state: AxFlowState
): void {
  logger?.({
    name: 'StepStart',
    timestamp: Date.now(),
    stepIndex,
    stepType: step.kind as AxFlowStepKind,
    nodeName: step.nodeName,
    dependencies: [...step.reads],
    produces: [...step.writes],
    state: { ...state },
  } as any);
}

function logStepComplete(
  logger: AxFlowLoggerFunction | undefined,
  step: AxFlowStep,
  stepIndex: number,
  state: AxFlowState,
  previousFields: string[],
  executionTime: number
): void {
  const currentFields = Object.keys(state);
  const newFields = currentFields.filter(
    (field) => !previousFields.includes(field)
  );
  const resultFieldName = step.nodeName ? `${step.nodeName}Result` : undefined;
  logger?.({
    name: 'StepComplete',
    timestamp: Date.now(),
    stepIndex,
    stepType: step.kind as AxFlowStepKind,
    nodeName: step.nodeName,
    executionTime,
    state: { ...state },
    newFields,
    result: resultFieldName ? state[resultFieldName] : undefined,
  } as any);
}

export async function executeFlowSteps(
  steps: readonly AxFlowStep[],
  initialState: AxFlowState,
  context: AxFlowExecutionContext,
  options: AxFlowExecuteStepsOptions
): Promise<{ finalState: AxFlowState; stepsExecuted: number }> {
  let state = { ...initialState };
  let stepsExecuted = 0;
  const planner = new AxFlowExecutionPlanner(steps);
  const groups = options.autoParallel
    ? planner.getExecutionPlan().groups
    : steps.map((step, index) => ({
        level: index,
        steps: [
          {
            type: step.kind,
            nodeName: step.nodeName,
            dependencies: [...step.reads],
            produces: [...step.writes],
            stepIndex: index,
            isBarrier: true,
          },
        ],
      }));

  for (const group of groups) {
    if (group.steps.length === 0) continue;

    if (group.steps.length === 1) {
      const planStep = group.steps[0];
      const step = steps[planStep.stepIndex];
      if (!step) continue;
      context.checkAbort(`flow-step-${planStep.stepIndex}`);
      const previousFields = Object.keys(state);
      logStepStart(options.logger, step, planStep.stepIndex, state);
      const startedAt = Date.now();
      try {
        state = await step.run(state, context);
        stepsExecuted++;
        logStepComplete(
          options.logger,
          step,
          planStep.stepIndex,
          state,
          previousFields,
          Date.now() - startedAt
        );
      } catch (error) {
        options.logger?.({
          name: 'FlowError',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          stepIndex: planStep.stepIndex,
          stepType: step.kind as AxFlowStepKind,
          nodeName: step.nodeName,
          state: { ...state },
        } as any);
        throw error;
      }
      continue;
    }

    context.checkAbort(`flow-parallel-group-${group.level}`);
    const groupStartState = state;
    const groupAbort = new AbortController();
    const taskSnapshot = context.captureRemoteTasks?.();
    const parallelContext: AxFlowExecutionContext = {
      ...context,
      mainOptions: {
        ...context.mainOptions,
        abortSignal: mergeAbortSignals(
          context.mainOptions?.abortSignal,
          groupAbort.signal
        ),
      },
      checkAbort: (location) => {
        context.checkAbort(location);
        checkAbortSignal(groupAbort.signal, location);
      },
    };
    let results: AxFlowState[];
    try {
      results = await processBatches(
        group.steps,
        async (planStep) => {
          const step = steps[planStep.stepIndex];
          if (!step) return groupStartState;
          const previousFields = Object.keys(groupStartState);
          logStepStart(
            options.logger,
            step,
            planStep.stepIndex,
            groupStartState
          );
          const startedAt = Date.now();
          try {
            const result = await step.run(groupStartState, parallelContext);
            logStepComplete(
              options.logger,
              step,
              planStep.stepIndex,
              result,
              previousFields,
              Date.now() - startedAt
            );
            return result;
          } catch (error) {
            options.logger?.({
              name: 'FlowError',
              timestamp: Date.now(),
              error: error instanceof Error ? error.message : String(error),
              stepIndex: planStep.stepIndex,
              stepType: step.kind as AxFlowStepKind,
              nodeName: step.nodeName,
              state: { ...groupStartState },
            } as any);
            groupAbort.abort(error);
            throw error;
          }
        },
        options.batchSize
      );
    } catch (error) {
      groupAbort.abort(error);
      if (taskSnapshot !== undefined) {
        await context.cancelRemoteTasksSince?.(taskSnapshot);
      }
      throw error;
    }

    for (const result of results) {
      state = { ...state, ...result };
      stepsExecuted++;
    }
  }

  return { finalState: state, stepsExecuted };
}

export function checkAbortSignal(
  abortSignal: AbortSignal | undefined,
  location: string
): void {
  if (abortSignal?.aborted) {
    throw new AxAIServiceAbortedError(
      location,
      abortSignal.reason ?? 'Flow aborted'
    );
  }
}
