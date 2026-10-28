import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxAIService } from '../ai/types.js';
import { optimize } from './optimize.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';
import { AxGEPA } from './optimizers/gepa.js';
import { AxProgram } from './program.js';
import { ax } from './template.js';
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
  it('reports the original rendered caller demos with a real AxGen', async () => {
    const prompts: string[] = [];
    const ai = new AxMockAIService({
      features: { structuredOutputs: false },
      chatResponse: async (request) => {
        const prompt = JSON.stringify(request.chatPrompt);
        prompts.push(prompt);
        return {
          results: [
            {
              index: 0,
              content: `answer: ${prompt.includes('original-marker') ? 'baseline' : 'optimized'}`,
              finishReason: 'stop',
            },
          ],
        };
      },
    });
    const program = ax('question:string -> answer:string');
    program.setDemos([
      {
        programId: program.getId(),
        traces: [{ question: 'original-marker', answer: 'caller-demo' }],
      },
    ]);
    const result = await optimize(
      program,
      examples,
      ({ prediction }) => (prediction.answer === 'optimized' ? 1 : 0.25),
      {
        studentAI: ai,
        numTrials: 0,
        validationExamples: [
          { question: 'held-one' },
          { question: 'held-two' },
        ],
        maxMetricCalls: 4,
      }
    );

    expect(result.baselineScore).toBe(0.25);
    expect(result.bestScore).toBe(1);
    expect(
      prompts.slice(0, 2).every((prompt) => prompt.includes('original-marker'))
    ).toBe(true);
    expect(
      prompts.slice(-2).every((prompt) => !prompt.includes('original-marker'))
    ).toBe(true);
  });

  it.each(['optimize', 'GEPA'])(
    'keeps held-out traces out of %s bootstrap demos for conditional children',
    async (mode) => {
      const ai = new AxMockAIService({
        features: { structuredOutputs: false },
        chatResponse: {
          results: [{ index: 0, content: 'answer: ok', finishReason: 'stop' }],
        },
      });
      class ConditionalProgram extends AxProgram<TestIn, TestOut> {
        readonly training = ax('question:string -> answer:string');
        readonly heldOut = ax('question:string -> answer:string');
        constructor() {
          super('question:string -> answer:string');
          this.register(this.training, 'training');
          this.register(this.heldOut, 'heldOut');
        }
        async forward(ai: AxAIService, input: TestIn) {
          return (
            input.question.startsWith('held-') ? this.heldOut : this.training
          ).forward(ai, input);
        }
      }
      const program = new ConditionalProgram();
      const train = [
        { question: 'train-one', answer: 'ok' },
        { question: 'train-two', answer: 'ok' },
      ];
      const options = {
        validationExamples: [
          { question: 'held-one', answer: 'ok' },
          { question: 'held-two', answer: 'ok' },
        ],
        maxMetricCalls: 4,
        bootstrap: true,
      };
      const score = ({ prediction }: { prediction: TestOut }) =>
        prediction.answer === 'ok' ? 1 : 0;
      const result =
        mode === 'GEPA'
          ? await new AxGEPA({ studentAI: ai, numTrials: 0 }).compile(
              program,
              train,
              score,
              options
            )
          : await optimize(program, train, score, {
              ...options,
              studentAI: ai,
              numTrials: 0,
            });

      expect(result.baselineScore).toBe(1);
      expect(result.bestScore).toBe(1);
      const demos = result.demos!.flatMap((demo) => demo.traces);
      expect(demos.length).toBeGreaterThan(0);
      expect(
        demos.every((demo) => String(demo.question).startsWith('train-'))
      ).toBe(true);
      expect(
        result.demos!.some((demo) => demo.programId === program.heldOut.getId())
      ).toBe(false);
    }
  );

  it('fits baseline and bootstrap validation into the implicit budget using the selection cap', async () => {
    const { program } = createProgram();
    const validation = Array.from({ length: 70 }, (_, i) => ({
      question: `held-${i}`,
      answer: `answer-${i}`,
    }));
    const seen: string[] = [];
    const originalForward = program.forward;
    program.forward = async (ai, input, options) => {
      seen.push(input.question);
      return originalForward(ai, input, options);
    };
    const result = await optimize(program, examples, metric, {
      studentAI: mockAI,
      numTrials: 0,
      validationExamples: validation,
    });

    expect(result.baselineScore).toBe(1);
    expect(result.bestScore).toBe(1);
    expect(seen.filter((question) => question.startsWith('held-'))).toEqual([
      ...validation.slice(0, 60).map((example) => example.question),
      ...validation.slice(0, 60).map((example) => example.question),
    ]);
  });

  it('reports the original held-out score before bootstrap changes existing demos', async () => {
    const { program, demosSeenByForward } = createProgram();
    const existingDemos = [
      {
        programId: 'root',
        traces: [{ question: 'original', answer: 'original' }],
      },
    ];
    program.setDemos(existingDemos);
    const originalForward = program.forward;
    program.forward = async (ai, example, options) => {
      await originalForward(ai, example, options);
      const demos = demosSeenByForward.at(-1)!;
      return {
        answer:
          demos[0]?.traces[0]?.answer === 'original' ? 'wrong' : example.answer,
      };
    };
    const validation = [
      { question: 'held-out-1', answer: 'v1' },
      { question: 'held-out-2', answer: 'v2' },
    ];
    const result = await optimize(program, examples, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      validationExamples: validation,
      numTrials: 0,
      maxMetricCalls: 4,
    });

    expect(result.baselineScore).toBe(0);
    expect(result.baselineScores).toEqual({ score: 0 });
    expect(result.bestScore).toBe(1);
    expect(demosSeenByForward.slice(0, 2)).toEqual([
      existingDemos,
      existingDemos,
    ]);
    expect(result.optimizedProgram?.demos?.[0]?.traces.length).toBeGreaterThan(
      0
    );
  });

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
    const { program, setDemosCalls, demosSeenByForward } = createProgram();

    const result = await optimize(program, examples, metric, {
      studentAI: mockAI,
      teacherAI: mockAI,
      numTrials: 0,
      bootstrap: false,
    });

    expect(setDemosCalls).toHaveLength(0);
    expect(demosSeenByForward).toHaveLength(2);
    expect(result.baselineScore).toBe(1);
    expect(result.stats.totalCalls).toBe(2);
  });

  it('charges both original and bootstrapped validation passes to maxMetricCalls', async () => {
    const { program } = createProgram();
    await expect(
      optimize(program, examples, metric, {
        studentAI: mockAI,
        teacherAI: mockAI,
        numTrials: 0,
        maxMetricCalls: 3,
      })
    ).rejects.toThrow(
      'too small for bootstrapped Pareto evaluation; need at least 4 metric calls'
    );
  });

  it('keeps separately bounded bootstrap calls from consuming the GEPA search budget', async () => {
    const { program } = createProgram();
    const originalForward = program.forward;
    program.forward = async (ai, example, options) => {
      await originalForward(ai, example, options);
      return {
        answer:
          program.getOptimizableComponents!()[0]?.current === 'better'
            ? example.answer
            : 'partial',
      };
    };
    const reflection = vi
      .spyOn(AxGEPA.prototype as any, 'reflectTargetInstruction')
      .mockResolvedValue('better');
    try {
      const result = await optimize(
        program,
        examples,
        ({ prediction, example }) =>
          prediction.answer === example.answer ? 1 : 0.5,
        {
          studentAI: mockAI,
          numTrials: 1,
          minibatch: false,
          bootstrap: { maxDemos: 10, maxRounds: 5 },
          maxMetricCalls: 10,
        }
      );
      expect(result.baselineScore).toBe(0.5);
      expect(result.bestScore).toBe(1);
      expect(result.stats.totalCalls).toBe(20);
      expect(result.optimizedProgram?.demos?.[0]?.traces).toHaveLength(10);
    } finally {
      reflection.mockRestore();
    }
  });

  it('rejects an insufficient baseline budget before bootstrap changes the program', async () => {
    const { program, setDemosCalls, demosSeenByForward } = createProgram();
    await expect(
      optimize(program, examples, metric, {
        studentAI: mockAI,
        numTrials: 0,
        maxMetricCalls: 1,
      })
    ).rejects.toThrow('need at least 2 metric calls');
    expect(setDemosCalls).toHaveLength(0);
    expect(demosSeenByForward).toHaveLength(0);
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
