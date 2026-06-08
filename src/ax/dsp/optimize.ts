import type {
  AxCompileOptions,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from './common_types.js';
import {
  type AxBootstrapOptimizerOptions,
  AxOptimizedProgramImpl,
  type AxParetoResult,
} from './optimizer.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';
import { AxGEPA } from './optimizers/gepa.js';
import {
  normalizeGEPAScores,
  scalarizeGEPAScores,
} from './optimizers/gepaEvaluation.js';
import type { AxGenOut, AxProgramDemos, AxProgrammable } from './types.js';

const DEFAULT_OPTIMIZE_MAX_METRIC_CALLS = 100;
const DEFAULT_BOOTSTRAP_EXAMPLE_LIMIT = 8;

export type AxOptimizeOptions = AxOptimizerArgs &
  Omit<AxCompileOptions, 'bootstrap'> & {
    bootstrap?: boolean | AxBootstrapOptimizerOptions;
  };

export async function optimize<IN, OUT extends AxGenOut>(
  program: Readonly<AxProgrammable<IN, OUT>>,
  examples: readonly AxTypedExample<IN>[],
  metricFn: AxMetricFn | AxMultiMetricFn,
  options: Readonly<AxOptimizeOptions>
): Promise<AxParetoResult<OUT>> {
  const { bootstrap, ...restOptions } = options;
  const shouldBootstrap =
    bootstrap ?? examples.length <= DEFAULT_BOOTSTRAP_EXAMPLE_LIMIT;
  const compileOptions: AxCompileOptions = {
    ...restOptions,
    bootstrap: false,
    maxMetricCalls:
      restOptions.maxMetricCalls ?? DEFAULT_OPTIMIZE_MAX_METRIC_CALLS,
  };

  let demos: AxProgramDemos<any, OUT>[] = [];

  if (shouldBootstrap) {
    const bootstrapOptions =
      typeof shouldBootstrap === 'object' ? shouldBootstrap : undefined;
    const bootstrapOptimizer = new AxBootstrapFewShot({
      ...restOptions,
      options: bootstrapOptions,
    });
    const bootstrapMetric: AxMetricFn = async ({ prediction, example }) => {
      const scores = await normalizeGEPAScores(metricFn, prediction, example);
      return scalarizeGEPAScores(scores, compileOptions as any);
    };
    const bootstrapResult = await bootstrapOptimizer.compile(
      program,
      examples,
      bootstrapMetric,
      compileOptions
    );
    demos = (bootstrapResult.demos ?? []) as AxProgramDemos<any, OUT>[];
    if (demos.length > 0) {
      program.setDemos(demos);
    }
  }

  const result = await new AxGEPA(restOptions).compile(
    program,
    examples,
    metricFn,
    compileOptions
  );

  if (demos.length === 0) {
    return result;
  }

  const optimizedProgram = result.optimizedProgram;
  if (optimizedProgram) {
    result.optimizedProgram = new AxOptimizedProgramImpl<OUT>({
      bestScore: optimizedProgram.bestScore,
      stats: optimizedProgram.stats,
      componentMap: optimizedProgram.componentMap,
      selectorState: optimizedProgram.selectorState,
      demos,
      examples: (optimizedProgram as any).examples,
      modelConfig: optimizedProgram.modelConfig,
      optimizerType: (optimizedProgram as any).optimizerType ?? 'GEPA',
      optimizationTime: (optimizedProgram as any).optimizationTime ?? 0,
      totalRounds: (optimizedProgram as any).totalRounds ?? 0,
      converged: (optimizedProgram as any).converged ?? false,
      scoreHistory: (optimizedProgram as any).scoreHistory,
      configurationHistory: (optimizedProgram as any).configurationHistory,
      artifactFormatVersion: (optimizedProgram as any).artifactFormatVersion,
      instructionSchema: (optimizedProgram as any).instructionSchema,
    });
  }

  result.demos = demos;
  result.paretoFront = result.paretoFront.map((point) => ({
    ...point,
    demos,
  }));

  return result;
}
