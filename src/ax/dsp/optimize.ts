import type {
  AxCompileOptions,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from './common_types.js';
import type {
  AxBootstrapOptimizerOptions,
  AxParetoResult,
} from './optimizer.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';
import { AxGEPA } from './optimizers/gepa.js';
import {
  getGEPAParetoSetSize,
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

/**
 * Optimize a program, measuring baselineScore and baselineScores before any
 * bootstrap demos or component changes. Existing caller-supplied demos remain
 * part of the baseline. Bootstrap runs need two validation passes within
 * maxMetricCalls; runs without bootstrap reuse the seed evaluation.
 * The implicit budget is at least 100 and fits the required validation passes.
 * An explicit maxMetricCalls is always respected.
 */
export async function optimize<IN, OUT extends AxGenOut>(
  program: Readonly<AxProgrammable<IN, OUT>>,
  examples: readonly AxTypedExample<IN>[],
  metricFn: AxMetricFn | AxMultiMetricFn,
  options: Readonly<AxOptimizeOptions>
): Promise<AxParetoResult<OUT>> {
  const { bootstrap, ...restOptions } = options;
  const shouldBootstrap =
    bootstrap ?? examples.length <= DEFAULT_BOOTSTRAP_EXAMPLE_LIMIT;
  const validationCount = Math.min(
    restOptions.validationExamples?.length || examples.length,
    getGEPAParetoSetSize(restOptions)
  );
  const compileOptions: AxCompileOptions = {
    ...restOptions,
    bootstrap: false,
    maxMetricCalls:
      restOptions.maxMetricCalls ??
      Math.max(
        DEFAULT_OPTIMIZE_MAX_METRIC_CALLS,
        validationCount * (shouldBootstrap ? 2 : 1)
      ),
  };

  class BootstrapGEPA extends AxGEPA {
    protected override async bootstrapProgram<TIn, TOut extends AxGenOut>(
      bootstrapProgram: Readonly<AxProgrammable<TIn, TOut>>,
      bootstrapExamples: readonly AxTypedExample<TIn>[],
      bootstrapMetricFn: AxMetricFn | AxMultiMetricFn,
      bootstrapCompileOptions: AxCompileOptions | undefined
    ): Promise<{ demos: AxProgramDemos<any, TOut>[]; metricCalls: number }> {
      const bootstrapOptimizer = new AxBootstrapFewShot({
        ...restOptions,
        options:
          typeof shouldBootstrap === 'object' ? shouldBootstrap : undefined,
      });
      const bootstrapMetric: AxMetricFn = async ({ prediction, example }) => {
        const scores = await normalizeGEPAScores(
          bootstrapMetricFn,
          prediction,
          example
        );
        return scalarizeGEPAScores(scores, bootstrapCompileOptions as any);
      };
      const bootstrapResult = await bootstrapOptimizer.compile(
        bootstrapProgram,
        bootstrapExamples,
        bootstrapMetric,
        bootstrapCompileOptions
      );
      return {
        demos: bootstrapResult.demos ?? [],
        metricCalls: bootstrapResult.stats.totalCalls,
      };
    }
  }

  const optimizer = shouldBootstrap
    ? new BootstrapGEPA(restOptions)
    : new AxGEPA(restOptions);
  return optimizer.compile(program, examples, metricFn, compileOptions);
}
