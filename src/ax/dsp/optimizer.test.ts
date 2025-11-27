import { describe, expect, it } from 'vitest';

import type { AxAIService } from '../ai/types.js';

import type { AxOptimizer } from './optimizer.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';
import { AxACE } from './optimizers/ace.js';
import { AxMiPRO } from './optimizers/miproV2.js';
import { f } from './sig.js';
import { ax } from './template.js';

// Mock dependencies
const mockAI = {
  name: 'mock',
  chat: async () => ({
    results: [
      {
        index: 0,
        content: JSON.stringify({
          answer: 'mock student response',
        }),
      },
    ],
  }),
  getOptions: () => ({ tracer: undefined }),
  getLogger: () => undefined,
} as unknown as AxAIService;

const mockExamples = [
  { input: 'test input', output: 'test output' },
  { input: 'test input 2', output: 'test output 2' },
];

describe('AxACE Optimizer', () => {
  it('should distinguish between input and output fields in playbook generation', async () => {
    const mockTeacherAI = {
      name: 'mockTeacher',
      chat: async (chatMessages) => {
        const lastMessage = chatMessages[chatMessages.length - 1];
        if (typeof lastMessage?.content !== 'string') {
          throw new Error('Invalid message content');
        }

        const messageData = JSON.parse(lastMessage.content as string);

        // Curator mock
        if (messageData.question_context) {
          const questionContext = JSON.parse(messageData.question_context);

          expect(questionContext).toHaveProperty('question');
          expect(questionContext).not.toHaveProperty('answer');
          expect(questionContext.question).toBe('This is a test');

          return {
            results: [
              {
                index: 0,
                content: JSON.stringify({
                  reasoning: 'mock curator reasoning',
                  operations: [
                    {
                      type: 'ADD',
                      section: 'Guidelines',
                      content: 'mock guideline',
                    },
                  ],
                }),
              },
            ],
          };
        }

        // Reflector mock
        if (messageData.question && messageData.generator_answer) {
          return {
            results: [
              {
                index: 0,
                content: JSON.stringify({
                  reasoning: 'mock reflector reasoning',
                  errorIdentification: 'mock error',
                  rootCauseAnalysis: 'mock cause',
                  correctApproach: 'mock approach',
                  keyInsight: 'mock insight',
                  bulletTags: [],
                }),
              },
            ],
          };
        }

        throw new Error('Unknown mock AI call');
      },
      getOptions: () => ({ tracer: undefined }),
      getLogger: () => undefined,
    } as unknown as AxAIService;

    const program = ax(
      f()
        .input('question', f.string('A question to be answered'))
        .output('answer', f.string('The answer to the question'))
        .build()
    );

    const examples = [
      { question: 'This is a test', answer: 'This is a test' },
      { question: 'This is a test', answer: 'This is a test' },
    ];
    const metricFn = () => 1;

    const ace = new AxACE({
      studentAI: mockAI,
      teacherAI: mockTeacherAI,
      examples,
    });

    const result = await ace.compile(program, examples, metricFn, {
      aceOptions: { maxEpochs: 1, maxReflectorRounds: 1 },
    });

    expect(result.playbook).toBeDefined();
    expect(result.playbook.sections['Guidelines']).toBeDefined();
    expect(result.playbook.sections['Guidelines']![0]!.content).toBe(
      'mock guideline'
    );
  });
});

describe('Optimizer Interface', () => {
  it('AxBootstrapFewShot implements AxOptimizer interface', () => {
    const optimizer = new AxBootstrapFewShot({
      studentAI: mockAI,
      examples: mockExamples,
    });

    // TypeScript check - this should compile without errors
    const typedOptimizer: AxOptimizer = optimizer;

    expect(typedOptimizer).toBeDefined();
    expect(typeof typedOptimizer.compile).toBe('function');
    expect(typeof typedOptimizer.getStats).toBe('function');
  });

  it('AxMiPRO implements AxOptimizer interface', () => {
    const optimizer = new AxMiPRO({
      studentAI: mockAI,
      examples: mockExamples,
    });

    // TypeScript check - this should compile without errors
    const typedOptimizer: AxOptimizer = optimizer;

    expect(typedOptimizer).toBeDefined();
    expect(typeof typedOptimizer.compile).toBe('function');
    expect(typeof typedOptimizer.getStats).toBe('function');
  });

  it('Both optimizers have compatible compile method signatures', () => {
    const bootstrap = new AxBootstrapFewShot({
      studentAI: mockAI,
      examples: mockExamples,
    });

    const mipro = new AxMiPRO({
      studentAI: mockAI,
      examples: mockExamples,
    });

    // Type check: both should be assignable to the common interface
    const optimizers: AxOptimizer[] = [bootstrap, mipro];

    expect(optimizers).toHaveLength(2);

    // Both should have the same compile method signature
    for (const optimizer of optimizers) {
      expect(typeof optimizer.compile).toBe('function');
      expect(optimizer.compile).toHaveLength(4); // program, examples, metricFn and options
    }
  });

  it('Both optimizers support getStats method', () => {
    const bootstrap = new AxBootstrapFewShot({
      studentAI: mockAI,
      examples: mockExamples,
    });

    const mipro = new AxMiPRO({
      studentAI: mockAI,
      examples: mockExamples,
    });

    // getStats should be available (may return undefined before compilation)
    const bootstrapStats = bootstrap.getStats();
    const miproStats = mipro.getStats();

    // Stats can be undefined before compilation, but method should exist
    expect(bootstrapStats !== null).toBe(true);
    expect(miproStats !== null).toBe(true);
  });
});
