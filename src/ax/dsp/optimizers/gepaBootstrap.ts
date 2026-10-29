import type { AxAIService } from '../../ai/types.js';
import type {
  AxExample,
  AxGEPABootstrapOptions,
  AxMetricFn,
  AxMultiMetricFn,
  AxTypedExample,
} from '../common_types.js';
import type {
  AxGenOut,
  AxProgramDemos,
  AxProgrammable,
  AxProgramTrace,
} from '../types.js';
import {
  freshBootstrapTraces,
  snapshotBootstrapTraces,
} from './bootstrapTraces.js';
import {
  type AxGEPAEvaluationState,
  normalizeGEPAScores,
  scalarizeGEPAScores,
} from './gepaEvaluation.js';

type AxGEPABootstrapResult<OUT> = {
  demos: AxProgramDemos<any, OUT>[];
  successfulRuns: number;
  metricCalls: number;
};

const defaultBootstrapMetricCalls = (exampleCount: number) =>
  Math.max(1, Math.min(exampleCount, 8));

const groupTracesByProgramId = <IN, OUT extends AxGenOut>(
  traces: readonly AxProgramTrace<IN, OUT>[]
): AxProgramDemos<any, OUT>[] => {
  const grouped = new Map<string, Record<string, unknown>[]>();

  for (const trace of traces) {
    const existing = grouped.get(trace.programId);
    if (existing) {
      existing.push(trace.trace as Record<string, unknown>);
    } else {
      grouped.set(trace.programId, [trace.trace as Record<string, unknown>]);
    }
  }

  return [...grouped.entries()].map(([programId, programTraces]) => ({
    programId,
    traces: programTraces as OUT[],
  }));
};

export const resolveBootstrapOptions = (
  bootstrap: boolean | AxGEPABootstrapOptions | undefined,
  exampleCount: number
): Required<AxGEPABootstrapOptions> | undefined => {
  if (!bootstrap) return undefined;

  const options = bootstrap === true ? {} : bootstrap;
  return {
    scoreThreshold: options.scoreThreshold ?? 0.8,
    maxBootstrapDemos: Math.max(1, Math.floor(options.maxBootstrapDemos ?? 4)),
    maxBootstrapMetricCalls: Math.max(
      1,
      Math.floor(
        options.maxBootstrapMetricCalls ??
          defaultBootstrapMetricCalls(exampleCount)
      )
    ),
  };
};

export async function bootstrapGEPADemos<IN, OUT extends AxGenOut>(args: {
  program: Readonly<AxProgrammable<IN, OUT>>;
  ai: AxAIService;
  examples: readonly AxTypedExample<IN>[];
  metricFn: AxMetricFn | AxMultiMetricFn;
  cfg: Readonly<Record<string, string>>;
  applyConfig: (cfg: Readonly<Record<string, string>>) => void;
  options: Required<AxGEPABootstrapOptions>;
  state: AxGEPAEvaluationState;
  sampleCount: number;
}): Promise<AxGEPABootstrapResult<OUT>> {
  const collected: AxProgramTrace<IN, OUT>[] = [];
  let successfulRuns = 0;
  let metricCalls = 0;

  for (const example of args.examples) {
    if (metricCalls >= args.options.maxBootstrapMetricCalls) break;
    if (collected.length >= args.options.maxBootstrapDemos) break;

    args.applyConfig(args.cfg);

    try {
      const previousTraces = snapshotBootstrapTraces(args.program.getTraces());
      const prediction = await args.program.forward(
        args.ai,
        example as IN,
        {
          sampleCount: args.sampleCount,
        } as any
      );
      const scores = await normalizeGEPAScores(
        args.metricFn,
        prediction,
        example as AxExample
      );
      for (const key of Object.keys(scores))
        args.state.observedScoreKeys.add(key);
      const scalar = scalarizeGEPAScores(scores);

      metricCalls += 1;

      if (scalar < args.options.scoreThreshold) {
        continue;
      }

      successfulRuns += 1;
      const runTraces = freshBootstrapTraces(
        previousTraces,
        args.program.getTraces()
      );
      for (const trace of runTraces) {
        if (collected.length >= args.options.maxBootstrapDemos) break;
        collected.push(trace);
      }
    } catch {
      metricCalls += 1;
    }
  }

  return {
    demos: groupTracesByProgramId(collected),
    successfulRuns,
    metricCalls,
  };
}
