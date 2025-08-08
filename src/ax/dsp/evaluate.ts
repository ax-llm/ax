import type { AxAIService } from '../ai/types.js';
import type { AxExample, AxMetricFn } from './common_types.js';
import type { AxGen } from './generate.js';
import type { AxGenIn, AxGenOut } from './types.js';

export type AxEvaluateArgs<IN extends AxGenIn, OUT extends AxGenOut> = {
  ai: AxAIService;
  program: Readonly<AxGen<IN, OUT>>;
  examples: Readonly<AxExample[]>;
};

export class AxTestPrompt<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  private ai: AxAIService;
  private program: Readonly<AxGen<IN, OUT>>;
  private examples: Readonly<AxExample[]>;

  constructor({
    ai,
    program,
    examples = [],
  }: Readonly<AxEvaluateArgs<IN, OUT>>) {
    if (examples.length === 0) {
      throw new Error('No examples found');
    }
    this.ai = ai;
    this.program = program;
    this.examples = examples;
  }

  public async run(metricFn: AxMetricFn) {
    const _st = Date.now();
    const total = this.examples.length;
    let sumOfScores = 0;

    for (let i = 0; i < total; i++) {
      const ex = this.examples[i];
      if (!ex) {
        throw new Error('Invalid example');
      }

      try {
        const res = await this.program.forward(this.ai, ex as IN, {
          maxRetries: 1,
        });
        const score = await metricFn({ prediction: res, example: ex });
        sumOfScores += score;
      } catch (error) {
        console.warn(
          `Program evaluation failed for example ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        // Continue with next example - score remains 0 for this example
      }

      // Setting updateProgressBar's 3rd argument is a count/value that represents progress.
      // If it specifically needs a 'success count', this might need adjustment.
      // For now, using sumOfScores, but it might represent total score, not #successes.
      // If AxMetricFn is always 0 or 1, sumOfScores is equivalent to successCount.
      // const et = Date.now() - st;
      // updateProgressBar(i, total, sumOfScores, et, 'Testing Prompt', 30);
    }

    const averageScore = total > 0 ? sumOfScores / total : 0;
    console.log(
      '\nPerformance: ',
      sumOfScores,
      '/',
      total,
      'Average Score: ',
      averageScore,
      '\n'
    );
  }
}
