/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';

import { AxFlow } from './flow.js';

describe('AxFlow Parallel Execution and Merge', () => {
  let mockAI: AxMockAIService;

  beforeEach(() => {
    mockAI = new AxMockAIService({
      chatResponse: {
        results: [{ index: 0, content: 'Mock response', finishReason: 'stop' }],
        modelUsage: {
          ai: 'mock',
          model: 'test',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    });
  });

  describe('parallel execution with merge', () => {
    it('should handle parallel execution with merge correctly (regression test)', async () => {
      const flow = new AxFlow<{ paperText: string }, { finalScore: number }>()
        .node('scorer1', 'documentText:string -> qualityScore:number')
        .node('scorer2', 'documentText:string -> qualityScore:number')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('scorer1', (state: any) => ({
              documentText: state.paperText,
            })),
          (subFlow: any) =>
            subFlow.execute('scorer2', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('finalScore', (result1, result2) => {
          const score1 = (result1 as any).scorer1Result?.qualityScore || 0;
          const score2 = (result2 as any).scorer2Result?.qualityScore || 0;
          return (score1 + score2) / 2;
        });

      // Mock AI that returns numeric scores
      const scoreMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: '8', finishReason: 'stop' }],
          modelUsage: {
            ai: 'score',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
          },
        },
      });

      const result = await flow.forward(scoreMockAI, { paperText: 'test' });
      expect(result.finalScore).toBeDefined();
      expect(typeof result.finalScore).toBe('number');
      expect(result.finalScore).toBe(8); // Mock AI returns 8
    });

    it('should preserve _parallelResults field during execution', async () => {
      let capturedState: any = null;
      const flow = new AxFlow<
        { userInput: string },
        { processedResult: string }
      >()
        .node('processor', 'documentText:string -> processedOutput:string')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('processor', (state: any) => ({
              documentText: state.userInput,
            })),
        ])
        .merge('processedResult', (result1) => {
          capturedState = result1;
          return (result1 as any).processorResult?.processedOutput || 'default';
        });

      const result = await flow.forward(mockAI, { userInput: 'test' });
      expect(result.processedResult).toBe('Mock response');
      expect(capturedState).toBeDefined();
    });

    it('should handle complex parallel merge with multiple branches', async () => {
      const flow = new AxFlow<
        { data: string },
        { combined: { scores: number[]; average: number } }
      >()
        .node('evaluator1', 'content:string -> rating:number')
        .node('evaluator2', 'content:string -> rating:number')
        .node('evaluator3', 'content:string -> rating:number')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('evaluator1', (state: any) => ({
              content: state.data,
            })),
          (subFlow: any) =>
            subFlow.execute('evaluator2', (state: any) => ({
              content: state.data,
            })),
          (subFlow: any) =>
            subFlow.execute('evaluator3', (state: any) => ({
              content: state.data,
            })),
        ])
        .merge('combined', (r1, r2, r3) => {
          const scores = [
            (r1 as any).evaluator1Result?.rating || 0,
            (r2 as any).evaluator2Result?.rating || 0,
            (r3 as any).evaluator3Result?.rating || 0,
          ];
          return {
            scores,
            average: scores.reduce((a, b) => a + b, 0) / scores.length,
          };
        });

      // Mock AI that returns numeric ratings
      const ratingMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: '7', finishReason: 'stop' }],
          modelUsage: {
            ai: 'rating',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
          },
        },
      });

      const result = await flow.forward(ratingMockAI, { data: 'test content' });
      expect(result.combined.scores).toEqual([7, 7, 7]);
      expect(result.combined.average).toBe(7);
    });

    it('should handle parallel execution with custom merge functions', async () => {
      const flow = new AxFlow<{ userInput: string }, { customMerge: string }>()
        .node('transformer1', 'documentText:string -> transformedResult:string')
        .node('transformer2', 'documentText:string -> transformedResult:string')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('transformer1', (state: any) => ({
              documentText: state.userInput,
            })),
          (subFlow: any) =>
            subFlow.execute('transformer2', (state: any) => ({
              documentText: state.userInput,
            })),
        ])
        .merge('customMerge', (result1, result2) => {
          const r1 =
            (result1 as any).transformer1Result?.transformedResult || '';
          const r2 =
            (result2 as any).transformer2Result?.transformedResult || '';
          return `Combined: ${r1} + ${r2}`;
        });

      const result = await flow.forward(mockAI, { userInput: 'test' });
      expect(result.customMerge).toBe(
        'Combined: Mock response + Mock response'
      );
    });

    it('should handle merge with empty results gracefully', async () => {
      const flow = new AxFlow<
        { userInput: string },
        { processedResult: string }
      >()
        .node('processor', 'documentText:string -> processedOutput:string')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('processor', (state: any) => ({
              documentText: state.userInput,
            })),
        ])
        .merge('processedResult', (result1) => {
          return (
            (result1 as any).processorResult?.processedOutput || 'fallback'
          );
        });

      // Mock AI that returns empty response
      const emptyMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: '', finishReason: 'stop' }],
          modelUsage: {
            ai: 'empty',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
          },
        },
      });

      const result = await flow.forward(emptyMockAI, { userInput: 'test' });
      expect(result.processedResult).toBe('fallback');
    });
  });

  describe('autoParallel behavior', () => {
    it('should work with autoParallel: true (default)', async () => {
      const flow = new AxFlow<{ paperText: string }, { qualityScore: number }>()
        .node('scorer', 'documentText:string -> qualityScore:number')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('scorer', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('qualityScore', (result1) => {
          return (result1 as any).scorerResult?.qualityScore || 0;
        });

      const scoreMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: '9', finishReason: 'stop' }],
          modelUsage: {
            ai: 'score',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
          },
        },
      });

      const result = await flow.forward(scoreMockAI, { paperText: 'test' });
      expect(result.qualityScore).toBe(9);
    });

    it('should work with autoParallel: false', async () => {
      const flow = new AxFlow<{ paperText: string }, { qualityScore: number }>({
        autoParallel: false,
      })
        .node('scorer', 'documentText:string -> qualityScore:number')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('scorer', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('qualityScore', (result1) => {
          return (result1 as any).scorerResult?.qualityScore || 0;
        });

      const scoreMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: '9', finishReason: 'stop' }],
          modelUsage: {
            ai: 'score',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
          },
        },
      });

      const result = await flow.forward(scoreMockAI, { paperText: 'test' });
      expect(result.qualityScore).toBe(9);
    });

    it('should handle autoParallel override in forward options', async () => {
      const flow = new AxFlow<{ paperText: string }, { qualityScore: number }>({
        autoParallel: true,
      })
        .node('scorer', 'documentText:string -> qualityScore:number')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('scorer', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('qualityScore', (result1) => {
          return (result1 as any).scorerResult?.qualityScore || 0;
        });

      const scoreMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: '9', finishReason: 'stop' }],
          modelUsage: {
            ai: 'score',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
          },
        },
      });

      // Test with autoParallel: false override
      const result = await flow.forward(
        scoreMockAI,
        { paperText: 'test' },
        { autoParallel: false }
      );
      expect(result.qualityScore).toBe(9);
    });

    it('should provide execution plan information', async () => {
      const flow = new AxFlow<{ paperText: string }, { qualityScore: number }>()
        .node('scorer1', 'documentText:string -> qualityScore:number')
        .node('scorer2', 'documentText:string -> qualityScore:number')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('scorer1', (state: any) => ({
              documentText: state.paperText,
            })),
          (subFlow: any) =>
            subFlow.execute('scorer2', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('qualityScore', (result1, result2) => {
          const score1 = (result1 as any).scorer1Result?.qualityScore || 0;
          const score2 = (result2 as any).scorer2Result?.qualityScore || 0;
          return (score1 + score2) / 2;
        });

      const planInfo = flow.getExecutionPlan();
      expect(planInfo.autoParallelEnabled).toBe(true);
      expect(planInfo.totalSteps).toBeGreaterThan(0);
      expect(planInfo.parallelGroups).toBeGreaterThanOrEqual(0);
      expect(planInfo.maxParallelism).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling in parallel execution', () => {
    it('should handle errors in parallel branches gracefully', async () => {
      const flow = new AxFlow<
        { paperText: string },
        { processedResult: string }
      >()
        .node('processor', 'documentText:string -> processedOutput:string')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('processor', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('processedResult', (result1) => {
          if (!result1) {
            throw new Error('No parallel results found for merge');
          }
          return (
            (result1 as any).processorResult?.processedOutput || 'fallback'
          );
        });

      // This should not throw the "No parallel results found for merge" error
      const result = await flow.forward(mockAI, { paperText: 'test' });
      expect(result.processedResult).toBe('Mock response');
    });

    it('should handle merge function errors', async () => {
      const flow = new AxFlow<
        { paperText: string },
        { processedResult: string }
      >()
        .node('processor', 'documentText:string -> processedOutput:string')
        .parallel([
          (subFlow: any) =>
            subFlow.execute('processor', (state: any) => ({
              documentText: state.paperText,
            })),
        ])
        .merge('processedResult', () => {
          throw new Error('Merge function error');
        });

      await expect(flow.forward(mockAI, { paperText: 'test' })).rejects.toThrow(
        'Merge function error'
      );
    });
  });
});
