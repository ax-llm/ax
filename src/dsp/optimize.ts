import fs from 'node:fs';

import {
  GenIn,
  GenOut,
  Program,
  ProgramDemos,
  ProgramTrace,
  Value
} from './program.js';

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

    this.program = program;
    this.examples = examples.slice(0, options?.maxExamples ?? 16);
  }

  public async compileRound(
    metricFn: MetricFn,
    options?: Readonly<OptimizerArgs<IN, OUT>['options']>
  ) {
    const maxDemos = options?.maxDemos ?? this.maxDemos;
    const aiOpt = { modelConfig: { temperature: 0.7 } };

    let traces: ProgramTrace[] = [];

    for (let i = 0; i < this.examples.length; i++) {
      if (i > 0) {
        aiOpt.modelConfig.temperature = 0.7 + 0.001 * i;
      }

      const ex = this.examples[i];
      const exList = [
        ...this.examples.slice(0, i),
        ...this.examples.slice(i + 1)
      ];
      this.program.setExamples(exList);

      const res = await this.program.forward(ex as IN, aiOpt);
      const success = metricFn({ prediction: res, example: ex });
      if (success) {
        traces = [...traces, ...this.program.getTraces()];
      }

      if (traces.length > maxDemos) {
        return traces;
      }
    }

    return traces;
  }

  public async compile(
    metricFn: MetricFn,
    options?: Readonly<
      OptimizerArgs<IN, OUT>['options'] & { filename?: string }
    >
  ) {
    const maxRounds = options?.maxRounds ?? this.maxRounds;
    let traces: ProgramTrace[] = [];

    for (let i = 0; i < maxRounds; i++) {
      const _traces = await this.compileRound(metricFn, options);
      traces = [...traces, ..._traces];
    }

    if (traces.length === 0) {
      throw new Error(
        'No demonstrations found. Either provider more examples or improve the existing ones.'
      );
    }

    const demos: ProgramDemos[] = groupTracesByKeys(traces);

    if (options?.filename) {
      fs.writeFileSync(options.filename, JSON.stringify(demos, null, 2));
    }

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
