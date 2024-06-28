import type {
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxProgram,
  AxProgramDemos,
  AxProgramTrace
} from './program.js';
import { updateProgressBar } from './util.js';

export type AxExample = Record<string, AxFieldValue>;

export type AxMetricFn = <T extends AxGenOut = AxGenOut>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => boolean;

export type AxMetricFnArgs = Parameters<AxMetricFn>[0];

export type AxOptimizerArgs<IN extends AxGenIn, OUT extends AxGenOut> = {
  program: Readonly<AxProgram<IN, OUT>>;
  examples: Readonly<AxExample[]>;
  options?: { maxRounds?: number; maxExamples?: number; maxDemos?: number };
};

export class AxBootstrapFewShot<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut
> {
  private program: Readonly<AxProgram<IN, OUT>>;
  private examples: Readonly<AxExample[]>;
  private maxRounds: number;
  private maxDemos: number;
  private maxExamples: number;
  private traces: AxProgramTrace[] = [];

  constructor({
    program,
    examples = [],
    options
  }: Readonly<AxOptimizerArgs<IN, OUT>>) {
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
    metricFn: AxMetricFn,
    options?: Readonly<AxOptimizerArgs<IN, OUT>['options']>
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
    metricFn: AxMetricFn,
    options?: Readonly<AxOptimizerArgs<IN, OUT>['options']>
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

    const demos: AxProgramDemos[] = groupTracesByKeys(this.traces);
    return demos;
  }
}

function groupTracesByKeys(
  programTraces: readonly AxProgramTrace[]
): AxProgramDemos[] {
  const groupedTraces = new Map<string, Record<string, AxFieldValue>[]>();

  // Group all traces by their keys
  for (const programTrace of programTraces) {
    if (groupedTraces.has(programTrace.programId)) {
      groupedTraces.get(programTrace.programId)!.push(programTrace.trace);
    } else {
      groupedTraces.set(programTrace.programId, [programTrace.trace]);
    }
  }

  // Convert the Map into an array of ProgramDemos
  const programDemosArray: AxProgramDemos[] = [];
  groupedTraces.forEach((traces, programId) => {
    programDemosArray.push({ traces, programId });
  });

  return programDemosArray;
}

const randomSample = <T>(array: readonly T[], n: number): T[] => {
  // Clone the array to avoid modifying the original array
  const clonedArray = [...array];
  // Shuffle the cloned array
  for (let i = clonedArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const caI = clonedArray[i];
    const caJ = clonedArray[j];

    if (!caI || !caJ) {
      throw new Error('Invalid array elements');
    }

    [clonedArray[i], clonedArray[j]] = [caJ, caI];
  }
  // Return the first `n` items of the shuffled array
  return clonedArray.slice(0, n);
};
