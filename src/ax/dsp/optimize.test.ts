import { describe, expect, it } from 'vitest';

import type { AxAIService } from '../ai/types.js';
import { optimize } from './optimize.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';
import type { AxProgramDemos, AxProgrammable } from './types.js';

const mockAI = {} as AxAIService;

type TestIn = { question: string; answer: string };
type TestOut = { answer: string };

const createProgram = () => {
  let id = 'root';
  let instruction = 'Answer the question.';
  let latestTraces: Array<{
    programId: string;
    trace: Record<string, unknown>;
  }> = [];
  let currentDemos: AxProgramDemos<any, TestOut>[] = [];
  let applyOptimizationCalls = 0;
  const setDemosCalls: AxProgramDemos<any, TestOut>[][] = [];
  const demosSeenByForward: AxProgramDemos<any, TestOut>[][] = [];

  const program: AxProgrammable<TestIn, TestOut> = {
    getId: () => id,
    setId: (nextId: string) => {
      id = nextId;
    },
    getSignature: () =>
      ({
        getDescription: () => 'test program',
        toString: () => '"test program" question:string -> answer:string',
      }) as any,
    getOptimizableComponents: () => [
      {
        key: `${id}::instruction`,
        kind: 'instruction',
        current: instruction,
      },
    ],
    applyOptimizedComponents: (updates: Readonly<Record<string, string>>) => {
      const key = `${id}::instruction`;
      if (typeof updates[key] === 'string') instruction = updates[key]!;
    },
    forward: async (_ai, example) => {
      demosSeenByForward.push(currentDemos);
      latestTraces = [
        {
          programId: id,
          trace: {
            question: example.question,
            answer: example.answer,
            bootstrapped: true,
          },
        },
      ];
      return { answer: example.answer };
    },
    getTraces: () => latestTraces as any,
    setDemos: (demos) => {
      currentDemos = [...demos] as AxProgramDemos<any, TestOut>[];
      setDemosCalls.push(currentDemos);
    },
    applyOptimization: () => {
      applyOptimizationCalls += 1;
    },
    getUsage: () => [],
    getChatLog: () => [],
    resetUsage: () => {},
  };

  return {
    program,
    setDemosCalls,
    demosSeenByForward,
    get applyOptimizationCalls() {
      return applyOptimizationCalls;
    },
  };
};

const examples = [
  { question: 'q1', answer: 'a1' },
  { question: 'q2', answer: 'a2' },
];

const metric = ({ prediction, example }: { prediction: any; example: any }) =>
  prediction.answer === example.answer ? 1 : 0;

describe('optimize', () => {
  it('bootstraps small training sets before GEPA by default', async () => {
    const { program, demosSeenByForward } = createProgram();

    const result = await optimize(program, examples, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
    });

    expect(result.optimizedProgram?.demos).toHaveLength(1);
    expect(result.optimizedProgram?.demos?.[0]?.traces.length).toBeGreaterThan(
      0
    );
    expect(
      demosSeenByForward.some((demos) =>
        demos.some((demo) =>
          demo.traces.some((trace: any) => trace.bootstrapped === true)
        )
      )
    ).toBe(true);
  });

  it('skips default bootstrap for larger training sets', async () => {
    const { program, setDemosCalls } = createProgram();
    const largerSet = Array.from({ length: 9 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));

    const result = await optimize(program, largerSet, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
    });

    expect(setDemosCalls).toHaveLength(0);
    expect(result.optimizedProgram?.demos).toEqual([]);
  });

  it('respects bootstrap false for small training sets', async () => {
    const { program, setDemosCalls } = createProgram();

    await optimize(program, examples, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
      bootstrap: false,
    });

    expect(setDemosCalls).toHaveLength(0);
  });

  it('respects explicit bootstrap true for larger training sets', async () => {
    const { program } = createProgram();
    const largerSet = Array.from({ length: 9 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));

    const result = await optimize(program, largerSet, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
      bootstrap: true,
    });

    expect(result.optimizedProgram?.demos?.[0]?.traces.length).toBeGreaterThan(
      0
    );
  });

  it('does not apply the final optimized program implicitly', async () => {
    const testProgram = createProgram();

    await optimize(testProgram.program, examples, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
    });

    expect(testProgram.applyOptimizationCalls).toBe(0);
  });

  it('scalarizes multi-objective metrics for BootstrapFewShot', async () => {
    const { program } = createProgram();

    const result = await optimize(
      program,
      examples,
      () => ({ accuracy: 1, brevity: 0 }),
      {
        studentAI: mockAI,
        teacherAI: mockAI,
        numTrials: 0,
      }
    );

    expect(result.optimizedProgram?.demos?.[0]?.traces.length).toBeGreaterThan(
      0
    );
  });

  it('uses maxMetricCalls 100 by default and preserves explicit values', async () => {
    const defaultProgram = createProgram();
    const explicitProgram = createProgram();

    await optimize(defaultProgram.program, examples, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
      bootstrap: false,
    });
    await expect(
      optimize(explicitProgram.program, examples, metric, {
        studentAI: mockAI,
        teacherAI: mockAI,
        numTrials: 0,
        bootstrap: false,
        maxMetricCalls: 1,
      })
    ).rejects.toThrow('maxMetricCalls=1');
  });
});

describe('AxBootstrapFewShot', () => {
  it('honors qualityThreshold while remaining directly usable', async () => {
    const rejected = createProgram();
    const accepted = createProgram();

    const highThreshold = new AxBootstrapFewShot({
      studentAI: mockAI,
      options: { maxRounds: 1, qualityThreshold: 0.75, verboseMode: false },
    });
    const defaultThreshold = new AxBootstrapFewShot({
      studentAI: mockAI,
      options: { maxRounds: 1, qualityThreshold: 0.5, verboseMode: false },
    });
    const partialMetric = () => 0.6;

    await expect(
      highThreshold.compile(rejected.program, examples, partialMetric)
    ).rejects.toThrow('No demonstrations found');

    const result = await defaultThreshold.compile(
      accepted.program,
      examples,
      partialMetric
    );
    expect(result.demos?.[0]?.traces.length).toBeGreaterThan(0);
  });
});
