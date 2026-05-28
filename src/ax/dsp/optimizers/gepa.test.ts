import { describe, expect, it } from 'vitest';
import type { AxAIService } from '../../ai/types.js';
import { ax } from '../template.js';
import { AxGEPA } from './gepa.js';

const createSingleRootProgram = (
  baseInstruction: string,
  forwardImpl: (instruction: string, example: any) => Promise<any> | any
) => {
  let id = 'root';
  let instruction = baseInstruction;

  const program = {
    getId: () => id,
    setId: (nextId: string) => {
      id = nextId;
    },
    getInstruction: () => instruction,
    setInstruction: (nextInstruction: string) => {
      instruction = nextInstruction;
    },
    getSignature: () => ({
      getDescription: () => baseInstruction,
      toString: () => `\"${baseInstruction}\" question:string -> answer:string`,
    }),
    namedProgramInstances: () => [{ id, program }],
    getOptimizableComponents: () => [
      {
        key: `${id}::instruction`,
        kind: 'instruction',
        current: instruction,
      },
    ],
    applyOptimizedComponents: (updates: Readonly<Record<string, string>>) => {
      const k = `${id}::instruction`;
      if (typeof updates[k] === 'string') instruction = updates[k]!;
    },
    forward: async (_ai: AxAIService, example: any) =>
      await forwardImpl(instruction, example),
    getTraces: () => [],
    setDemos: () => {},
    applyOptimization: () => {},
    getUsage: () => [],
    resetUsage: () => {},
  };

  return program;
};

const createInstructionNode = (id: string, description: string) => {
  let nodeId = id;
  let instruction = '';
  const node = {
    getId: () => nodeId,
    setId: (nextId: string) => {
      nodeId = nextId;
    },
    getInstruction: () => instruction,
    setInstruction: (nextInstruction: string) => {
      instruction = nextInstruction;
    },
    getSignature: () => ({
      getDescription: () => description,
      toString: () => `\"${description}\" input:string -> output:string`,
    }),
    getOptimizableComponents: () => [
      {
        key: `${nodeId}::instruction`,
        kind: 'instruction',
        current: instruction,
      },
    ],
    applyOptimizedComponents: (updates: Readonly<Record<string, string>>) => {
      const k = `${nodeId}::instruction`;
      if (typeof updates[k] === 'string') instruction = updates[k]!;
    },
    getTraces: () => [],
    setDemos: () => {},
    applyOptimization: () => {},
    getUsage: () => [],
    resetUsage: () => {},
  };

  return node;
};

describe('AxGEPA Optimizer', () => {
  describe('discovery', () => {
    it('exposes the program’s description and instruction as components', () => {
      const program = ax(
        '"This is my custom task description" question:string -> answer:string'
      );
      const components = program.getOptimizableComponents();
      const byKind = (kind: string) =>
        components.find((c) => c.kind === kind)?.current;
      expect(byKind('description')).toBe('This is my custom task description');
      expect(byKind('instruction') ?? '').toBe('');
    });

    it('reflects setInstruction in the instruction component', () => {
      const program = ax('question:string -> answer:string');
      program.setInstruction('My explicitly set custom instruction');
      const components = program.getOptimizableComponents();
      expect(components.find((c) => c.kind === 'instruction')?.current).toBe(
        'My explicitly set custom instruction'
      );
    });
  });

  describe('compile', () => {
    it('supports scalar metric functions by normalizing them to score vectors', async () => {
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 0,
      });
      const program = createSingleRootProgram(
        'task',
        async (_instruction, ex) => ({
          answer: ex.answer,
        })
      );

      const result = await optimizer.compile(
        program as any,
        [
          { question: 'q1', answer: 'a1' },
          { question: 'q2', answer: 'a2' },
        ],
        async ({ prediction, example }) =>
          prediction.answer === example.answer ? 1 : 0,
        { maxMetricCalls: 2 }
      );

      expect(result.bestScore).toBe(1);
      expect(result.paretoFront[0]?.scores).toEqual({ score: 1 });
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root::instruction': 'task',
      });
    });

    it('treats forward failures as zero-score rows instead of aborting the optimization', async () => {
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 0,
      });
      const program = createSingleRootProgram(
        'task',
        async (_instruction, ex) => {
          if (ex.question === 'q1') {
            throw new Error('model repeated itself until token exhaustion');
          }

          return {
            answer: ex.answer,
          };
        }
      );

      const result = await optimizer.compile(
        program as any,
        [
          { question: 'q1', answer: 'a1' },
          { question: 'q2', answer: 'a2' },
        ],
        async ({ prediction, example }) =>
          (prediction as any).answer === example.answer ? 1 : 0,
        { maxMetricCalls: 2 }
      );

      expect(result.bestScore).toBe(0.5);
      expect(result.paretoFront[0]?.scores).toEqual({ score: 0.5 });
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root::instruction': 'task',
      });
    });

    it('bootstraps successful traces into demos and saves them on the optimized artifact', async () => {
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 0,
      });

      let id = 'root';
      let instruction = 'task';
      let latestTraces: Array<{ trace: any; programId: string }> = [];
      let appliedDemos: any[] = [];
      const program = {
        getId: () => id,
        setId: (nextId: string) => {
          id = nextId;
        },
        getSignature: () => ({
          getDescription: () => 'task',
          toString: () => '"task" question:string -> answer:string',
        }),
        getOptimizableComponents: () => [
          {
            key: `${id}::instruction`,
            kind: 'instruction',
            current: instruction,
          },
        ],
        applyOptimizedComponents: (
          updates: Readonly<Record<string, string>>
        ) => {
          const key = `${id}::instruction`;
          if (typeof updates[key] === 'string') instruction = updates[key]!;
        },
        forward: async (_ai: AxAIService, example: any) => {
          latestTraces = [
            {
              programId: 'root',
              trace: {
                question: example.question,
                answer: example.answer,
              },
            },
          ];
          return { answer: example.answer };
        },
        getTraces: () => latestTraces,
        setDemos: (demos: any[]) => {
          appliedDemos = demos;
        },
        applyOptimization: () => {},
        getUsage: () => [],
        resetUsage: () => {},
      };

      const result = await optimizer.compile(
        program as any,
        [
          { question: 'q1', answer: 'a1' },
          { question: 'q2', answer: 'a2' },
        ],
        async ({ prediction, example }) =>
          (prediction as any).answer === (example as any).answer ? 1 : 0,
        {
          bootstrap: true,
          maxMetricCalls: 2,
        }
      );

      expect(appliedDemos).toHaveLength(1);
      expect(appliedDemos[0]).toEqual({
        programId: 'root',
        traces: [
          { question: 'q1', answer: 'a1' },
          { question: 'q2', answer: 'a2' },
        ],
      });
      expect(result.optimizedProgram?.demos).toEqual(appliedDemos);
    });

    it('throws before spending calls when maxMetricCalls cannot cover the initial Pareto set', async () => {
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 0,
      });
      const program = createSingleRootProgram(
        'task',
        async (_instruction, ex) => ({
          answer: ex.answer,
        })
      );

      await expect(
        optimizer.compile(
          program as any,
          [
            { question: 'q1', answer: 'a1' },
            { question: 'q2', answer: 'a2' },
          ],
          async ({ prediction, example }) =>
            prediction.answer === example.answer ? 1 : 0,
          { maxMetricCalls: 1 }
        )
      ).rejects.toThrow(/need at least 2 metric calls/);
    });

    it('applies minImprovementThreshold to acceptance decisions', async () => {
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 1,
        minibatch: false,
        earlyStoppingTrials: 5,
        minImprovementThreshold: 0.5,
      });
      const program = createSingleRootProgram('task', async (instruction) => ({
        score: instruction === 'better' ? 0.1 : 0,
      }));
      (optimizer as any).reflectTargetInstruction = async () => 'better';

      const result = await optimizer.compile(
        program as any,
        [{ question: 'q1' }, { question: 'q2' }],
        async ({ prediction }) => prediction.score,
        { maxMetricCalls: 20 }
      );

      expect(result.bestScore).toBe(0);
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root::instruction': 'task',
      });
    });

    it('does not score feedback-only examples that are outside the training pool', async () => {
      const seenQuestions: string[] = [];
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 1,
        minibatch: true,
        minibatchSize: 1,
        seed: 1,
      });
      const program = createSingleRootProgram(
        'task',
        async (_instruction, ex) => ({
          answer: ex.answer ?? 'answer',
        })
      );
      (optimizer as any).reflectTargetInstruction = async () => 'task';

      await optimizer.compile(
        program as any,
        [
          { question: 'q1', answer: 'a1' },
          { question: 'q2', answer: 'a2' },
        ],
        async ({ example }) => {
          seenQuestions.push((example as any).question);
          return 0;
        },
        {
          maxMetricCalls: 20,
          feedbackExamples: [{ question: 'update', answer: 'bad' }] as any,
          feedbackNotes: ['Observed output: bad'] as any,
        } as any
      );

      expect(seenQuestions).not.toContain('update');
    });

    it('optimizes registered descendant components and returns a componentMap', async () => {
      const classifier = createInstructionNode(
        'root.classifier',
        'base-classify'
      );
      const rationale = createInstructionNode(
        'root.rationale',
        'base-rationale'
      );
      const root = {
        getId: () => 'root',
        setId: () => {},
        getSignature: () => ({
          getDescription: () => 'root flow',
          toString: () =>
            'emailText:string -> priority:string, rationale:string',
        }),
        namedProgramInstances: () => [
          { id: classifier.getId(), program: classifier },
          { id: rationale.getId(), program: rationale },
        ],
        getOptimizableComponents: () => [
          ...classifier.getOptimizableComponents(),
          ...rationale.getOptimizableComponents(),
        ],
        applyOptimizedComponents: (
          updates: Readonly<Record<string, string>>
        ) => {
          classifier.applyOptimizedComponents(updates);
          rationale.applyOptimizedComponents(updates);
        },
        forward: async () => ({
          score:
            (classifier.getInstruction() === 'better-classify' ? 1 : 0) +
            (rationale.getInstruction() === 'better-rationale' ? 1 : 0),
        }),
        getTraces: () => [],
        setDemos: () => {},
        applyOptimization: () => {},
        getUsage: () => [],
        resetUsage: () => {},
      };
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 2,
        minibatch: false,
        earlyStoppingTrials: 5,
        minImprovementThreshold: 0,
        seed: 1,
      });
      (optimizer as any).reflectTargetInstruction = async (targetId: string) =>
        targetId.includes('classifier')
          ? 'better-classify'
          : 'better-rationale';

      const result = await optimizer.compile(
        root as any,
        [{ emailText: 'a' }, { emailText: 'b' }],
        async ({ prediction }) => prediction.score,
        { maxMetricCalls: 20, skipPerfectScore: false }
      );

      expect(result.bestScore).toBe(2);
      expect(result.optimizedProgram?.componentMap).toEqual({
        'root.classifier::instruction': 'better-classify',
        'root.rationale::instruction': 'better-rationale',
      });
    });

    it('passes componentId to feedback functions during target reflection', async () => {
      const seenComponentIds: string[] = [];
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
        numTrials: 0,
      });
      const program = createSingleRootProgram(
        'task',
        async (_instruction, ex) => ({
          answer: ex.answer ?? 'answer',
        })
      );

      await (optimizer as any).reflectTargetInstruction(
        'root.actor.root',
        'current instruction',
        program,
        () => {},
        { 'root.actor.root': 'current instruction' },
        [{ question: 'q1', answer: 'a1' }],
        async () => 0.5,
        {
          feedbackFn: ({ componentId }: { componentId?: string }) => {
            if (componentId) {
              seenComponentIds.push(componentId);
            }
            return 'Prefer direct answers when recursion is unnecessary.';
          },
        }
      );

      expect(seenComponentIds).toEqual(['root.actor.root']);
    });

    it('renders nested trace values as JSON in reflective datasets', async () => {
      let capturedPrompt = '';
      const reflectionAI = {
        chat: async (request: { chatPrompt: { content?: unknown }[] }) => {
          capturedPrompt = String(request.chatPrompt[0]?.content ?? '');
          return {
            results: [
              {
                index: 0,
                content: '```improved instruction```',
                finishReason: 'stop',
              },
            ],
          };
        },
      } as AxAIService;

      const optimizer = new AxGEPA({
        studentAI: reflectionAI,
        teacherAI: reflectionAI,
        numTrials: 0,
      });
      const program = createSingleRootProgram('task', async () => ({
        answer: 'ok',
        recursiveTrace: {
          root: {
            children: [{ taskDigest: 'branch-a' }],
          },
        },
      }));

      await (optimizer as any).reflectInstruction(
        'current instruction',
        program,
        [{ question: 'q1', extra: { nested: ['value'] } }],
        async () => 0.25,
        {
          feedbackFn: ({ componentId }: { componentId?: string }) =>
            componentId ? `component=${componentId}` : undefined,
        }
      );

      expect(capturedPrompt).toContain('"taskDigest": "branch-a"');
      expect(capturedPrompt).toContain('"nested": [');
      expect(capturedPrompt).toContain('component=root');
      expect(capturedPrompt).not.toContain('[object Object]');
    });
  });
});
