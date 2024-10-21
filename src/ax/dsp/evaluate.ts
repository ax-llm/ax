import type { AxAIService } from '../ai/types.js';

import type { AxExample, AxMetricFn } from './optimize.js';
import type { AxGenIn, AxGenOut, AxProgram } from './program.js';
import { updateProgressBar } from './util.js';

export type AxEvaluateArgs<IN extends AxGenIn, OUT extends AxGenOut> = {
  ai: AxAIService;
  program: Readonly<AxProgram<IN, OUT>>;
  examples: Readonly<AxExample[]>;
};

export class AxTestPrompt<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut
> {
  private ai: AxAIService;
  private program: Readonly<AxProgram<IN, OUT>>;
  private examples: Readonly<AxExample[]>;

  constructor({
    ai,
    program,
    examples = []
  }: Readonly<AxEvaluateArgs<IN, OUT>>) {
    if (examples.length == 0) {
      throw new Error('No examples found');
    }
    this.ai = ai;
    this.program = program;
    this.examples = examples;
  }

  public async run(metricFn: AxMetricFn) {
    const st = new Date().getTime();
    const total = this.examples.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const ex = this.examples[i];
      if (!ex) {
        throw new Error('Invalid example');
      }

      const res = await this.program.forward(this.ai, ex as IN);
      const success = metricFn({ prediction: res, example: ex });
      if (success) {
        successCount++;
      }

      const et = new Date().getTime() - st;
      updateProgressBar(i, total, successCount, et, 30, 'Testing Prompt');
    }

    console.log(
      '\nPerformance: ',
      successCount,
      '/',
      total,
      'Accuracy: ',
      successCount / total,
      '\n'
    );
  }
}
