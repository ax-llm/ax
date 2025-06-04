import type { AxAIService } from '../ai/types.js'

import type { AxExample, AxMetricFn } from './optimize.js'
import type { AxProgram } from './program.js'
import type { AxGenIn, AxGenOut } from './types.js'
import { updateProgressBar } from './util.js'

export type AxEvaluateArgs<IN extends AxGenIn, OUT extends AxGenOut> = {
  ai: AxAIService
  program: Readonly<AxProgram<IN, OUT>>
  examples: Readonly<AxExample[]>
}

export class AxTestPrompt<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  private ai: AxAIService
  private program: Readonly<AxProgram<IN, OUT>>
  private examples: Readonly<AxExample[]>

  constructor({
    ai,
    program,
    examples = [],
  }: Readonly<AxEvaluateArgs<IN, OUT>>) {
    if (examples.length == 0) {
      throw new Error('No examples found')
    }
    this.ai = ai
    this.program = program
    this.examples = examples
  }

  public async run(metricFn: AxMetricFn) {
    const st = new Date().getTime()
    const total = this.examples.length
    let sumOfScores = 0

    for (let i = 0; i < total; i++) {
      const ex = this.examples[i]
      if (!ex) {
        throw new Error('Invalid example')
      }

      const res = await this.program.forward(this.ai, ex as IN)
      const score = metricFn({ prediction: res, example: ex })
      sumOfScores += score

      const et = new Date().getTime() - st
      // Assuming updateProgressBar's 3rd argument is a count/value that represents progress.
      // If it specifically needs a 'success count', this might need adjustment.
      // For now, using sumOfScores, but it might represent total score, not #successes.
      // If AxMetricFn is always 0 or 1, sumOfScores is equivalent to successCount.
      updateProgressBar(i, total, sumOfScores, et, 'Testing Prompt', 30)
    }

    const averageScore = total > 0 ? sumOfScores / total : 0
    console.log(
      '\nPerformance: ',
      sumOfScores,
      '/',
      total,
      'Average Score: ',
      averageScore,
      '\n'
    )
  }
}
