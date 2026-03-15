import { describe, expect, it } from 'vitest';
import { ax } from '../template.js';
import type { AxAIService } from '../../ai/types.js';
import { AxGEPA } from './gepa.js';

const createSingleRootProgram = (
  baseInstruction: string,
  forwardImpl: (instruction: string, example: any) => Promise<any> | any
) => {
  let id = 'root';
  let instruction = '';

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
    getTraces: () => [],
    setDemos: () => {},
    applyOptimization: () => {},
    getUsage: () => [],
    resetUsage: () => {},
  };

  return node;
};

describe('AxGEPA Optimizer', () => {
  describe('getBaseInstruction', () => {
    it('should use the description from the signature when available', async () => {
      // Create a program with a signature that has a description
      const program = ax(
        '"This is my custom task description" question:string -> answer:string'
      );

      // Access the private method via cast
      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
      });

      // Call getBaseInstruction
      const instruction = await (optimizer as any).getBaseInstruction(program);

      // It should return the description from the signature, not the default
      expect(instruction).toBe('This is my custom task description');
      expect(instruction).not.toBe(
        'Follow the task precisely. Be concise, correct, and consistent.'
      );
    });

    it('should fall back to default when signature has no description', async () => {
      // Create a program without a description
      const program = ax('question:string -> answer:string');

      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
      });

      const instruction = await (optimizer as any).getBaseInstruction(program);

      // Should use the default fallback
      expect(instruction).toBe(
        'Follow the task precisely. Be concise, correct, and consistent.'
      );
    });

    it('should use custom instruction when set via setInstruction', async () => {
      const program = ax('question:string -> answer:string');
      program.setInstruction('My explicitly set custom instruction');

      const optimizer = new AxGEPA({
        studentAI: {} as AxAIService,
        teacherAI: {} as AxAIService,
      });

      const instruction = await (optimizer as any).getBaseInstruction(program);

      // Should return the custom instruction
      expect(instruction).toBe('My explicitly set custom instruction');
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
      expect(result.optimizedProgram?.instruction).toBe('task');
      expect(result.optimizedProgram?.instructionMap).toEqual({ root: 'task' });
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
      expect(result.optimizedProgram?.instruction).toBe('task');
      expect(result.optimizedProgram?.instructionMap).toEqual({ root: 'task' });
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

    it('optimizes registered descendant instructions and returns an instructionMap', async () => {
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
        targetId.endsWith('classifier')
          ? 'better-classify'
          : 'better-rationale';

      const result = await optimizer.compile(
        root as any,
        [{ emailText: 'a' }, { emailText: 'b' }],
        async ({ prediction }) => prediction.score,
        { maxMetricCalls: 20, skipPerfectScore: false }
      );

      expect(result.bestScore).toBe(2);
      expect(result.optimizedProgram?.instruction).toBeUndefined();
      expect(result.optimizedProgram?.instructionMap).toEqual({
        'root.classifier': 'better-classify',
        'root.rationale': 'better-rationale',
      });
    });
  });
});
