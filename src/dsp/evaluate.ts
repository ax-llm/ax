import { Example, MetricFn } from './optimize.js';
import { GenIn, GenOut, Program } from './program.js';
import { updateProgressBar } from './util.js';

export type EvaluateArgs<IN extends GenIn, OUT extends GenOut> = {
  program: Readonly<Program<IN, OUT>>;
  examples: Readonly<Example[]>;
};

export class TestPrompt<IN extends GenIn = GenIn, OUT extends GenOut = GenOut> {
  private program: Readonly<Program<IN, OUT>>;
  private examples: Readonly<Example[]>;

  constructor({ program, examples = [] }: Readonly<EvaluateArgs<IN, OUT>>) {
    if (examples.length == 0) {
      throw new Error('No examples found');
    }
    this.program = program;
    this.examples = examples;
  }

  public async run(metricFn: MetricFn) {
    const st = new Date().getTime();
    const total = this.examples.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const ex = this.examples[i];

      const res = await this.program.forward(ex as IN);
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
