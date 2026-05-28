import { describe, expect, it } from 'vitest';

import type { AxAIService } from '../ai/types.js';

import type { AxOptimizer } from './optimizer.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';

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

  it('bootstrap optimizer has a compatible compile method signature', () => {
    const bootstrap = new AxBootstrapFewShot({
      studentAI: mockAI,
      examples: mockExamples,
    });

    const optimizers: AxOptimizer[] = [bootstrap];

    expect(optimizers).toHaveLength(1);
    expect(typeof bootstrap.compile).toBe('function');
    expect(bootstrap.compile).toHaveLength(4);
  });

  it('bootstrap optimizer supports getStats', () => {
    const bootstrap = new AxBootstrapFewShot({
      studentAI: mockAI,
      examples: mockExamples,
    });

    const bootstrapStats = bootstrap.getStats();

    expect(bootstrapStats !== null).toBe(true);
  });
});
