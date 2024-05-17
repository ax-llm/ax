import { writeFileSync } from 'fs';

import type {
  GenIn,
  GenOut,
  Program,
  ProgramDemos,
  ProgramTrace,
  Value
} from './program.js';
import { updateProgressBar } from './util.js';

export type Example = Record<string, Value>;

export type MetricFn = <T extends GenOut = GenOut>(
  arg0: Readonly<{ prediction: T; example: Example }>
) => boolean;

export type MetricFnArgs = Parameters<MetricFn>[0];

export type OptimizerArgs<IN extends GenIn, OUT extends GenOut> = {
  program: Readonly<Program<IN, OUT>>;
  examples: Readonly<Example[]>;
  options?: { maxRounds?: number; maxExamples?: number; maxDemos?: number };
};

export class BootstrapFewShot<
  IN extends GenIn = GenIn,
  OUT extends GenOut = GenOut
> {
  private program: Readonly<Program<IN, OUT>>;
  private examples: Readonly<Example[]>;
  private maxRounds: number;
  private maxDemos: number;
  private maxExamples: number;
  private traces: ProgramTrace[] = [];

  constructor({
    program,
    examples = [],
    options
  }: Readonly<OptimizerArgs<IN, OUT>>) {
    if (examples.length == 0) {
      throw new Error('No examples found');
    }
    this.maxRounds = options?.maxRounds ?? 3;
    this.maxDemos = options?.maxDemos ?? 4;
    this.maxExamples = options?.maxExamples ?? 16;

    this.program = program;
    this.examples = examples;
  }

  private async compileRound(
    roundIndex: number,
    metricFn: MetricFn,
    options?: Readonly<OptimizerArgs<IN, OUT>['options']>
  ) {
    const st = new Date().getTime();
    const maxDemos = options?.maxDemos ?? this.maxDemos;
    const aiOpt = { modelConfig: { temperature: 0.7 } };
    const examples = randomSample(this.examples, this.maxExamples);

    for (let i = 0; i < examples.length; i++) {
      if (i > 0) {
        aiOpt.modelConfig.temperature = 0.7 + 0.001 * i;
      }

      const ex = examples[i];
      if (!ex) {
        throw new Error('Invalid example');
      }
      const exList = [...examples.slice(0, i), ...examples.slice(i + 1)];
      this.program.setExamples(exList);

      const res = await this.program.forward(ex as IN, aiOpt);
      const success = metricFn({ prediction: res, example: ex });
      if (success) {
        this.traces = [...this.traces, ...this.program.getTraces()];
      }

      const current = i + examples.length * roundIndex;
      const total = examples.length * this.maxRounds;
      const et = new Date().getTime() - st;
      updateProgressBar(
        current,
        total,
        this.traces.length,
        et,
        30,
        'Tuning Prompt'
      );

      if (this.traces.length > maxDemos) {
        return;
      }
    }
  }

  public async compile(
    metricFn: MetricFn,
    options?: Readonly<
      OptimizerArgs<IN, OUT>['options'] & { filename?: string }
    >
  ) {
    const maxRounds = options?.maxRounds ?? this.maxRounds;
    this.traces = [];

    for (let i = 0; i < maxRounds; i++) {
      await this.compileRound(i, metricFn, options);
    }

    if (this.traces.length === 0) {
      throw new Error(
        'No demonstrations found. Either provider more examples or improve the existing ones.'
      );
    }

    const demos: ProgramDemos[] = groupTracesByKeys(this.traces);

    if (options?.filename) {
      writeFileSync(options.filename, JSON.stringify(demos, null, 2));
    }

    console.log('\n');
    return demos;
  }
}

function groupTracesByKeys(
  programTraces: readonly ProgramTrace[]
): ProgramDemos[] {
  const groupedTraces = new Map<string, Record<string, Value>[]>();

  // Group all traces by their keys
  for (const programTrace of programTraces) {
    if (groupedTraces.has(programTrace.key)) {
      groupedTraces.get(programTrace.key)!.push(programTrace.trace);
    } else {
      groupedTraces.set(programTrace.key, [programTrace.trace]);
    }
  }

  // Convert the Map into an array of ProgramDemos
  const programDemosArray: ProgramDemos[] = [];
  groupedTraces.forEach((traces, key) => {
    programDemosArray.push({ traces, key });
  });

  return programDemosArray;
}

const randomSample = <T>(array: readonly T[], n: number): T[] => {
  // Clone the array to avoid modifying the original array
  const clonedArray = [...array];
  // Shuffle the cloned array
  for (let i = clonedArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const ca_i = clonedArray[i];
    const ca_j = clonedArray[j];

    if (!ca_i || !ca_j) {
      throw new Error('Invalid array elements');
    }

    [clonedArray[i], clonedArray[j]] = [ca_j, ca_i];
  }
  // Return the first `n` items of the shuffled array
  return clonedArray.slice(0, n);
};
