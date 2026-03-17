import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxAIService } from '../ai/types.js';
import { AxSignature } from './sig.js';
import { AxLearn } from './learn.js';
import type { AxOptimizationProgress, AxTypedExample } from './common_types.js';
import type { AxProgramForwardOptions, AxProgramUsage } from './types.js';
import type {
  AxCheckpoint,
  AxLearnCheckpointState,
  AxStorage,
  AxTrace,
} from '../mem/storage.js';

type TestInput = { question: string };
type TestOutput = { answer: string };

class TestStorage implements AxStorage {
  public readonly traces: AxTrace[];
  public readonly checkpoints: AxCheckpoint[];

  constructor(args?: {
    traces?: AxTrace[];
    checkpoints?: AxCheckpoint[];
    checkpointDelayMs?: number;
  }) {
    this.traces = [...(args?.traces ?? [])];
    this.checkpoints = [...(args?.checkpoints ?? [])];
    this.checkpointDelayMs = args?.checkpointDelayMs ?? 0;
  }

  private readonly checkpointDelayMs: number;

  async save(_name: string, item: AxTrace | AxCheckpoint): Promise<void> {
    if (item.type === 'trace') {
      const index = this.traces.findIndex((trace) => trace.id === item.id);
      if (index >= 0) {
        this.traces[index] = { ...this.traces[index]!, ...item };
      } else {
        this.traces.push({ ...item });
      }
      return;
    }

    const index = this.checkpoints.findIndex(
      (checkpoint) => checkpoint.version === item.version
    );
    if (index >= 0) {
      this.checkpoints[index] = { ...this.checkpoints[index]!, ...item };
    } else {
      this.checkpoints.push({ ...item });
    }
  }

  async load(
    _name: string,
    query: {
      type: 'trace' | 'checkpoint';
      since?: Date;
      until?: Date;
      limit?: number;
      offset?: number;
      id?: string;
      version?: number;
      hasFeedback?: boolean;
    }
  ): Promise<(AxTrace | AxCheckpoint)[]> {
    if (query.type === 'checkpoint' && this.checkpointDelayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.checkpointDelayMs)
      );
    }

    let items =
      query.type === 'trace' ? [...this.traces] : [...this.checkpoints];

    if (query.type === 'trace') {
      items = items.filter((item) => {
        const trace = item as AxTrace;
        if (query.id && trace.id !== query.id) {
          return false;
        }
        if (query.hasFeedback && !trace.feedback) {
          return false;
        }
        if (query.since && trace.endTime < query.since) {
          return false;
        }
        if (query.until && trace.startTime > query.until) {
          return false;
        }
        return true;
      });
    } else {
      items = items.filter((item) => {
        const checkpoint = item as AxCheckpoint;
        if (
          query.version !== undefined &&
          checkpoint.version !== query.version
        ) {
          return false;
        }
        return true;
      });
    }

    const offset = query.offset ?? 0;
    const limited =
      query.limit !== undefined
        ? items.slice(offset, offset + query.limit)
        : items.slice(offset);

    return limited;
  }
}

class TestProgram {
  private readonly signature: AxSignature<TestInput, TestOutput>;
  private instruction?: string;

  constructor(description = 'Base prompt', instruction?: string) {
    this.signature = new AxSignature<TestInput, TestOutput>(
      `"${description}" question:string -> answer:string`
    );
    this.instruction = instruction;
  }

  async forward(
    _ai: AxAIService,
    _values: TestInput,
    _options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<TestOutput> {
    return {
      answer:
        this.instruction ??
        this.signature.getDescription() ??
        'missing-instruction',
    };
  }

  getSignature(): AxSignature<TestInput, TestOutput> {
    return this.signature;
  }

  setInstruction(instruction: string): void {
    this.instruction = instruction;
  }

  getInstruction(): string | undefined {
    return this.instruction;
  }

  setDescription(description: string): void {
    this.signature.setDescription(description);
  }

  applyOptimization(optimizedProgram: {
    instruction?: string;
    applyTo?: (program: TestProgram) => void;
  }): void {
    optimizedProgram.applyTo?.(this);
    if (optimizedProgram.instruction) {
      this.setInstruction(optimizedProgram.instruction);
    }
  }

  getUsage(): AxProgramUsage[] {
    return [];
  }

  resetUsage(): void {}

  addAssert(): void {}

  addStreamingAssert(): void {}

  addFieldProcessor(): void {}

  addStreamingFieldProcessor(): void {}

  updateMeter(): void {}
}

class PromptHarnessLearn extends AxLearn<TestInput, TestOutput> {
  public seenConfig: Readonly<Record<string, unknown>> | undefined;
  public seenBaseline: number | undefined;
  public compileSpy = vi.fn(
    async () =>
      ({
        optimizedProgram: {
          bestScore: 0.8,
          instruction: 'optimized-instruction',
        },
      }) as any
  );

  protected override createPromptOptimizer(
    config: Readonly<Record<string, unknown>>,
    baselineScore: number
  ): any {
    this.seenConfig = config;
    this.seenBaseline = baselineScore;
    const progressHandler = (this as any).createOptimizerProgressHandler(
      baselineScore,
      config.onProgress as
        | ((progress: {
            round: number;
            totalRounds: number;
            score: number;
            improvement: number;
          }) => void)
        | undefined
    ) as ((progress: Readonly<AxOptimizationProgress>) => void) | undefined;

    return {
      compile: async (...args: any[]) => {
        progressHandler?.({
          round: 1,
          totalRounds: 2,
          currentScore: 0.7,
          bestScore: 0.7,
          tokensUsed: 0,
          timeElapsed: 5,
          successfulExamples: 1,
          totalExamples: 2,
        });
        return this.compileSpy(...args);
      },
    };
  }
}

class PlaybookHarnessLearn extends AxLearn<TestInput, TestOutput> {
  public seenConfig: Readonly<Record<string, unknown>> | undefined;
  public seenBaseline: number | undefined;
  public updateSpy = vi.fn(async () => ({
    operations: [
      { type: 'ADD', section: 'rules', content: 'Lead with empathy' },
    ],
  }));
  private readonly playbook = {
    version: 1,
    sections: {
      rules: [
        {
          id: 'rule-1',
          section: 'rules',
          content: 'Lead with empathy',
          helpfulCount: 0,
          harmfulCount: 0,
          createdAt: '2026-03-14T08:00:00.000Z',
          updatedAt: '2026-03-14T08:00:00.000Z',
        },
      ],
    },
    stats: {
      bulletCount: 1,
      helpfulCount: 0,
      harmfulCount: 0,
      tokenEstimate: 12,
    },
    updatedAt: '2026-03-14T08:00:00.000Z',
    description: 'Operational guidance for support replies.',
  };

  private readonly artifact = {
    playbook: this.playbook,
    feedback: [],
    history: [],
  };

  protected override createPlaybookOptimizer(
    config: Readonly<Record<string, unknown>>,
    baselineScore: number
  ): any {
    this.seenConfig = config;
    this.seenBaseline = baselineScore;
    return {
      compile: async () => ({
        bestScore: 0.9,
        playbook: this.playbook,
        artifact: this.artifact,
        optimizedProgram: {
          applyTo: (program: TestProgram) => {
            program.setDescription(renderedPlaybookInstruction);
          },
        },
      }),
      hydrate: vi.fn(),
      applyOnlineUpdate: this.updateSpy,
      applyCurrentState: (program: TestProgram) => {
        program.setDescription(renderedPlaybookInstruction);
      },
      getArtifact: () => ({
        playbook: this.playbook,
        feedback: [],
        history: [
          {
            epoch: 0,
            exampleIndex: 0,
            operations: [
              { type: 'ADD', section: 'rules', content: 'Lead with empathy' },
            ],
          },
        ],
      }),
      getPlaybook: () => this.playbook,
      getBaseInstruction: () => 'Base prompt',
    };
  }
}

const teacherAI = new AxMockAIService({ name: 'teacher-ai' });
const runtimeAI = new AxMockAIService({ name: 'runtime-ai' });

const exampleA: AxTypedExample<TestInput> = { question: 'a', answer: 'A' };
const exampleB: AxTypedExample<TestInput> = { question: 'b', answer: 'B' };
const renderedPlaybookInstruction = [
  'Base prompt',
  '',
  '## Context Playbook',
  'Operational guidance for support replies.',
  '',
  '### rules',
  '- [rule-1] Lead with empathy',
].join('\n');

const createTrace = (args: {
  id: string;
  question: string;
  answer?: string;
  feedback?: NonNullable<AxTrace['feedback']>;
  error?: string;
  endTime?: Date;
}): AxTrace => ({
  type: 'trace',
  id: args.id,
  name: 'learn-test',
  input: { question: args.question },
  output: args.answer ? { answer: args.answer } : {},
  startTime: args.endTime ?? new Date('2026-03-14T08:00:00.000Z'),
  endTime: args.endTime ?? new Date('2026-03-14T08:00:00.000Z'),
  durationMs: 10,
  feedback: args.feedback,
  error: args.error,
});

const createCheckpoint = (args: {
  version: number;
  createdAt: string;
  instruction?: string;
  score?: number;
  learnState?: AxLearnCheckpointState;
}): AxCheckpoint => ({
  type: 'checkpoint',
  name: 'learn-test',
  version: args.version,
  createdAt: new Date(args.createdAt),
  instruction: args.instruction,
  score: args.score,
  learnState: args.learnState,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AxLearn', () => {
  it('requires runtimeAI for optimize()', async () => {
    const storage = new TestStorage();
    const program = new TestProgram();
    const agent = new AxLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    await expect(
      agent.optimize({
        metric: async () => 1,
      })
    ).rejects.toThrow(/runtimeAI is required/);
  });

  it('uses runtimeAI for prompt optimization and reports improvement as a delta', async () => {
    const storage = new TestStorage({
      checkpoints: [
        createCheckpoint({
          version: 1,
          createdAt: '2026-03-14T08:00:00.000Z',
          instruction: 'baseline-instruction',
          score: 0.4,
        }),
      ],
    });
    const program = new TestProgram('Base prompt');
    const agent = new PromptHarnessLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    const result = await agent.optimize({
      metric: async () => 1,
    });

    expect(agent.seenConfig?.runtimeAI).toBe(runtimeAI);
    expect(agent.seenConfig?.teacher).toBe(teacherAI);
    expect(agent.seenBaseline).toBe(0.4);
    expect(result.score).toBe(0.8);
    expect(result.improvement).toBeCloseTo(0.4);
    expect(program.getInstruction()).toBe('optimized-instruction');
    expect(storage.checkpoints.at(-1)?.score).toBe(0.8);
  });

  it('filters bad traces and forwards feedback-bearing examples into prompt optimization', async () => {
    const storage = new TestStorage({
      traces: [
        createTrace({
          id: 'feedback-trace',
          question: 'good',
          answer: 'A',
          feedback: {
            score: 1,
            label: 'good',
            comment: 'Helpful and specific',
          },
          endTime: new Date('2026-03-14T09:00:00.000Z'),
        }),
        createTrace({
          id: 'plain-trace',
          question: 'plain',
          answer: 'P',
          endTime: new Date('2026-03-14T08:30:00.000Z'),
        }),
        createTrace({
          id: 'error-trace',
          question: 'broken',
          answer: 'X',
          error: 'boom',
          endTime: new Date('2026-03-14T08:15:00.000Z'),
        }),
        createTrace({
          id: 'empty-trace',
          question: 'empty',
          endTime: new Date('2026-03-14T08:05:00.000Z'),
        }),
      ],
    });
    const program = new TestProgram();
    const agent = new PromptHarnessLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      mode: 'continuous',
      generateExamples: false,
      useTraces: true,
      continuousOptions: {
        feedbackWindowSize: 5,
        maxRecentTraces: 10,
      },
    });

    await agent.optimize({
      metric: async () => 1,
    });

    const [, trainingExamples, _metric, options] =
      agent.compileSpy.mock.calls[0]!;
    const combined = [
      ...(trainingExamples as AxTypedExample<TestInput>[]),
      ...((options?.validationExamples as AxTypedExample<TestInput>[]) ?? []),
    ];

    expect(combined).toEqual(
      expect.arrayContaining([
        { question: 'good', answer: 'A' },
        { question: 'plain', answer: 'P' },
      ])
    );
    expect(combined).not.toEqual(
      expect.arrayContaining([
        { question: 'broken', answer: 'X' },
        { question: 'empty' },
      ])
    );
    expect(trainingExamples).toEqual(
      expect.arrayContaining([{ question: 'good', answer: 'A' }])
    );
    expect(
      (options?.validationExamples as AxTypedExample<TestInput>[]) ?? []
    ).toEqual(expect.arrayContaining([{ question: 'plain', answer: 'P' }]));
    expect(
      (options?.validationExamples as AxTypedExample<TestInput>[]) ?? []
    ).not.toEqual(expect.arrayContaining([{ question: 'good', answer: 'A' }]));
    expect(options.feedbackExamples).toEqual([
      { question: 'good', answer: 'A' },
    ]);
    expect(
      options.feedbackFn({
        prediction: {},
        example: { question: 'good', answer: 'A' },
      })
    ).toContain('Helpful and specific');
  });

  it('waits for restore before async use and picks the latest checkpoint from unsorted storage', async () => {
    const storage = new TestStorage({
      checkpointDelayMs: 25,
      checkpoints: [
        createCheckpoint({
          version: 2,
          createdAt: '2026-03-14T08:00:00.000Z',
          instruction: 'older-v2',
          score: 0.2,
        }),
        createCheckpoint({
          version: 3,
          createdAt: '2026-03-14T08:05:00.000Z',
          instruction: 'older-v3',
          score: 0.3,
        }),
        createCheckpoint({
          version: 3,
          createdAt: '2026-03-14T08:10:00.000Z',
          instruction: 'newest-v3',
          score: 0.35,
        }),
      ],
    });
    const program = new TestProgram('Base prompt', 'initial-instruction');
    const agent = new AxLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    const result = await agent.forward(runtimeAI, { question: 'hello' });

    expect(result.answer).toBe('newest-v3');
    expect(program.getInstruction()).toBe('newest-v3');
  });

  it('returns the base playbook prompt before state is populated', async () => {
    const storage = new TestStorage();
    const program = new TestProgram('Base prompt');
    const agent = new AxLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      mode: 'playbook',
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    await agent.ready();

    expect(agent.getInstruction()).toBe('Base prompt');
  });

  it('uses continuous update budgets, persists state, and forwards progress updates', async () => {
    const storage = new TestStorage();
    const program = new TestProgram();
    const onProgress = vi.fn();
    const agent = new PromptHarnessLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      mode: 'continuous',
      examples: [exampleA, exampleB],
      generateExamples: false,
      onProgress,
      continuousOptions: {
        updateBudget: 3,
      },
    });

    const result = await agent.applyUpdate(
      {
        example: { question: 'live-question' },
        prediction: { answer: 'live-answer' },
        feedback: {
          score: 0,
          label: 'bad',
          comment: 'Needs empathy',
        },
      },
      {
        metric: async () => 1,
      }
    );

    const [, trainingExamples, _metric, options] =
      agent.compileSpy.mock.calls[0]!;
    const combined = [
      ...(trainingExamples as AxTypedExample<TestInput>[]),
      ...((options?.validationExamples as AxTypedExample<TestInput>[]) ?? []),
    ];

    expect(agent.seenConfig?.budget).toBe(3);
    expect(onProgress).toHaveBeenCalled();
    expect(result.mode).toBe('continuous');
    expect(result.state?.continuous?.lastUpdateAt).toBeDefined();
    expect(storage.checkpoints.at(-1)?.learnState?.mode).toBe('continuous');
    expect(combined).not.toEqual(
      expect.arrayContaining([
        { question: 'live-question' },
        { question: 'live-question', answer: 'live-answer' },
      ])
    );
    expect(options.feedbackExamples).toEqual(
      expect.arrayContaining([
        { question: 'live-question', answer: 'live-answer' },
      ])
    );
    expect(
      options.feedbackFn({
        prediction: { answer: 'live-answer' },
        example: { question: 'live-question', answer: 'live-answer' },
      })
    ).toContain('Needs empathy');
    expect(options.feedbackNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Observed output: {"answer":"live-answer"}'),
      ])
    );
  });

  it('keeps expected-output update rows scorable while preserving observed prediction feedback context', async () => {
    const storage = new TestStorage();
    const program = new TestProgram();
    const agent = new PromptHarnessLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      mode: 'continuous',
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    await agent.applyUpdate(
      {
        example: { question: 'expected-question', answer: 'ideal-answer' },
        prediction: { answer: 'actual-answer' },
        feedback: 'Wrong answer',
      },
      {
        metric: async () => 1,
      }
    );

    const [, trainingExamples, _metric, options] =
      agent.compileSpy.mock.calls[0]!;
    const combined = [
      ...(trainingExamples as AxTypedExample<TestInput>[]),
      ...((options?.validationExamples as AxTypedExample<TestInput>[]) ?? []),
    ];

    expect(combined).toEqual(
      expect.arrayContaining([
        { question: 'expected-question', answer: 'ideal-answer' },
      ])
    );
    expect(trainingExamples).toEqual(
      expect.arrayContaining([
        { question: 'expected-question', answer: 'ideal-answer' },
      ])
    );
    expect(combined).not.toEqual(
      expect.arrayContaining([
        { question: 'expected-question', answer: 'actual-answer' },
      ])
    );
    expect(options.feedbackExamples).toEqual(
      expect.arrayContaining([
        { question: 'expected-question', answer: 'actual-answer' },
      ])
    );
    expect(
      options.feedbackFn({
        prediction: { answer: 'actual-answer' },
        example: { question: 'expected-question', answer: 'actual-answer' },
      })
    ).toContain('Wrong answer');
  });

  it('saves playbook checkpoints, restores them, and supports online playbook updates', async () => {
    const storage = new TestStorage();
    const program = new TestProgram('Base prompt');
    const agent = new PlaybookHarnessLearn(program as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      mode: 'playbook',
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    const optimizeResult = await agent.optimize({
      metric: async () => 1,
    });

    expect(optimizeResult.mode).toBe('playbook');
    expect(storage.checkpoints.at(-1)?.learnState?.mode).toBe('playbook');
    expect(storage.checkpoints.at(-1)?.learnState?.playbook).toBeDefined();
    expect(program.getSignature().getDescription()).toContain(
      'Lead with empathy'
    );
    expect(agent.getInstruction()).toBe(renderedPlaybookInstruction);

    const restoredProgram = new TestProgram('Base prompt');
    const restoredAgent = new AxLearn(restoredProgram as any, {
      name: 'learn-test',
      storage,
      teacher: teacherAI,
      runtimeAI,
      mode: 'playbook',
      examples: [exampleA, exampleB],
      generateExamples: false,
    });

    await restoredAgent.ready();
    expect(restoredProgram.getSignature().getDescription()).toContain(
      '## Context Playbook'
    );
    expect(restoredProgram.getSignature().getDescription()).toContain(
      'Lead with empathy'
    );
    expect(restoredAgent.getInstruction()).toBe(renderedPlaybookInstruction);

    const updateResult = await agent.applyUpdate(
      {
        example: { question: 'live-question', answer: 'ideal-answer' },
        prediction: { answer: 'actual-answer' },
        feedback: 'Lead with empathy',
      },
      {
        metric: async () => 1,
      }
    );

    expect(agent.updateSpy).toHaveBeenCalled();
    expect(updateResult.mode).toBe('playbook');
    expect(updateResult.artifact?.playbook).toBeDefined();
    expect(storage.checkpoints.at(-1)?.learnState?.mode).toBe('playbook');
    expect(updateResult.artifact?.playbookSummary).toEqual(
      storage.checkpoints.at(-1)?.learnState?.artifactSummary
    );
  });
});
