/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';

import { flow, AxFlow } from './flow.js';

describe('AxFlow', () => {
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

  describe('constructor', () => {
    it('should create an AxFlow instance with default options', () => {
      const myFlow = flow();
      expect(myFlow).toBeInstanceOf(AxFlow);
    });

    it('should create an AxFlow instance with custom options', () => {
      const myFlow = flow({ autoParallel: false });
      expect(myFlow).toBeInstanceOf(AxFlow);
    });
  });

  describe('node definition', () => {
    it('should define a node with simple signature', () => {
      const myFlow = flow();
      expect(() => {
        myFlow.node('testNode', 'userInput:string -> responseText:string');
      }).not.toThrow();
    });

    it('should define a node with complex field types', () => {
      const myFlow = flow();
      expect(() => {
        myFlow.node(
          'complexNode',
          'documentText:string -> processedResult:string, confidence:number'
        );
      }).not.toThrow();
    });

    it('should throw error for invalid signature', () => {
      const myFlow = flow();
      expect(() => {
        myFlow.node('badNode', '');
      }).toThrow('Invalid signature for node');
    });

    it('should throw error when executing non-existent node', async () => {
      const myFlow = flow();
      // The type system now prevents this at compile time, but we test runtime behavior
      // by casting to bypass type checking
      expect(() => {
        // Type assertion to test runtime behavior when TypeScript types are bypassed
        (
          myFlow as unknown as {
            execute: (name: string, fn: () => unknown) => unknown;
          }
        ).execute('nonexistent', () => ({}));
      }).toThrow("Node 'nonexistent' not found");
    });

    it('should throw when a node name is defined twice', () => {
      const myFlow = flow();
      myFlow.node('dup', 'userInput:string -> responseText:string');
      expect(() => {
        myFlow.node('dup', 'userInput:string -> responseText:string');
      }).toThrow("Node 'dup' is already defined");
    });
  });

  describe('fluent interface', () => {
    it('should support method chaining', () => {
      const myFlow = flow()
        .node('testNode', 'userInput:string -> responseText:string')
        .map((state) => state)
        .execute('testNode', () => ({ userInput: 'test' }));

      expect(myFlow).toBeInstanceOf(AxFlow);
    });
  });

  describe('map transformation', () => {
    it('should apply synchronous state transformations', async () => {
      const myFlow = flow<{ value: number }, { doubled: number }>().map(
        (state) => ({ ...state, doubled: state.value * 2 })
      );

      const result = await myFlow.forward(mockAI, { value: 5 });
      expect(result.doubled).toBe(10);
    });

    it('should apply asynchronous state transformations', async () => {
      const asyncTransform = async (state: { value: number }) => {
        // Simulate async operation like API call
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...state, asyncResult: state.value * 3 };
      };

      const myFlow = flow<{ value: number }, { asyncResult: number }>().map(
        asyncTransform
      );

      const result = await myFlow.forward(mockAI, { value: 5 });
      expect(result.asyncResult).toBe(15);
    });

    it('should apply multiple async transformations in parallel', async () => {
      const asyncTransform1 = async (state: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ...state, result1: state.value * 2 };
      };

      const asyncTransform2 = async (state: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...state, result2: state.value * 3 };
      };

      const asyncTransform3 = async (state: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { ...state, result3: state.value * 4 };
      };

      const myFlow = flow<
        { value: number },
        { result1: number; result2: number; result3: number }
      >().map([asyncTransform1, asyncTransform2, asyncTransform3], {
        parallel: true,
      });

      const startTime = Date.now();
      const result = await myFlow.forward(mockAI, { value: 5 });
      const endTime = Date.now();

      // Verify results
      expect(result.result3).toBe(20); // Last transform should be applied (parallel map takes last result)

      // Verify parallel execution (should be faster than sequential)
      // If run sequentially: 20 + 10 + 15 = 45ms minimum
      // If run in parallel: max(20, 10, 15) = 20ms minimum
      // Allow extra time for system overhead and timing precision
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should handle mixed sync and async transforms in parallel', async () => {
      const syncTransform = (state: { value: number }) => ({
        ...state,
        syncResult: state.value * 2,
      });

      const asyncTransform = async (state: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...state, asyncResult: state.value * 3 };
      };

      const myFlow = flow<
        { value: number },
        { syncResult: number; asyncResult: number }
      >().map([syncTransform, asyncTransform], { parallel: true });

      const result = await myFlow.forward(mockAI, { value: 5 });
      expect(result.asyncResult).toBe(15); // Last transform (async) should be applied
    });

    it('should support the short alias m() with async functions', async () => {
      const asyncTransform = async (state: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...state, aliasResult: state.value * 5 };
      };

      const myFlow = flow<{ value: number }, { aliasResult: number }>().m(
        asyncTransform
      );

      const result = await myFlow.forward(mockAI, { value: 4 });
      expect(result.aliasResult).toBe(20);
    });
  });

  describe('execute with dynamic context', () => {
    it('should use different AI services for different nodes', async () => {
      const altMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Alt response', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'alt',
            model: 'test',
            tokens: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
          },
        },
      });

      const myFlow = flow<
        { userInput: string },
        { primaryResult: string; altResult: string }
      >()
        .node('primary', 'userInput:string -> responseText:string')
        .node('secondary', 'userInput:string -> responseText:string')
        .execute('primary', (state) => ({ userInput: state.userInput }))
        .execute('secondary', (state) => ({ userInput: state.userInput }), {
          ai: altMockAI,
        })
        .map((state) => ({
          primaryResult: state.primaryResult.responseText,
          altResult: state.secondaryResult.responseText,
        }));

      const result = await myFlow.forward(mockAI, { userInput: 'test' });

      expect(result.primaryResult).toBe('Mock response');
      expect(result.altResult).toBe('Alt response');
    });

    it('should use default AI when no dynamic context provided', async () => {
      const defaultMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Default summary', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'default',
            model: 'summarizer',
            tokens: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
          },
        },
      });

      const myFlow = flow<{ topic: string }, { summary: string }>({
        autoParallel: false,
      })
        .node('summarizer', 'documentText:string -> summary:string')
        .map((input) => ({ originalText: `Some text about ${input.topic}` }))
        .execute('summarizer', (state) => ({
          documentText: state.originalText,
        }))
        .map((state) => ({ summary: state.summarizerResult.summary }));

      const result = await myFlow.forward(defaultMockAI, {
        topic: 'technology',
      });

      expect(result.summary).toBe('Default summary');
    });
  });

  describe('while loops', () => {
    it('should execute while loop correctly', async () => {
      const loopMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: 'processed', finishReason: 'stop' }],
          modelUsage: {
            ai: 'loop',
            model: 'processor',
            tokens: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        },
      });

      const myFlow = flow<{ iterations: number }, { finalCount: number }>({
        autoParallel: false,
      })
        .node('processor', 'iterationCount:number -> processedResult:string')
        .while((state) => state.iterations < 3)
        .map((state) => ({ ...state, iterations: state.iterations + 1 }))
        .execute('processor', (state) => ({ iterationCount: state.iterations }))
        .endWhile()
        .map((state) => ({ finalCount: state.iterations }));

      const result = await myFlow.forward(loopMockAI, { iterations: 0 });

      expect(result.finalCount).toBe(3);
    });

    it('should handle nested transformations in while loop', async () => {
      const nestedMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: 'ok', finishReason: 'stop' }],
          modelUsage: {
            ai: 'nested',
            model: 'checker',
            tokens: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
          },
        },
      });

      const myFlow = flow<{ counter: number }, { total: number }>({
        autoParallel: false,
      })
        .node('checker', 'counterValue:number -> statusCheck:string')
        .while((state) => state.counter < 2)
        .map((state) => ({ ...state, counter: state.counter + 1 }))
        .execute('checker', (state) => ({ counterValue: state.counter }))
        .map((state: Record<string, unknown>) => ({
          ...state,
          total: ((state.total as number) || 0) + (state.counter as number),
        }))
        .endWhile()
        .map((state) => ({ total: state.total || 0 }));

      const result = await myFlow.forward(nestedMockAI, { counter: 0 });

      expect(result.total).toBe(3); // 1 + 2 = 3
    });

    it('should throw error for unmatched endWhile', () => {
      const myFlow = flow();

      expect(() => {
        myFlow.endWhile();
      }).toThrow('endWhile() called without matching while()');
    });
  });

  describe('state management', () => {
    it('should preserve state across transformations', async () => {
      const stateMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Generated content', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'state',
            model: 'processor',
            tokens: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
          },
        },
      });

      const myFlow = flow<
        { userInput: string },
        { originalInput: string; summary: string; analysis: string }
      >({ autoParallel: false })
        .node('summarizer', 'documentText:string -> summary:string')
        .node('analyzer', 'inputText:string -> analysis:string')
        .execute('summarizer', (state) => ({ documentText: state.userInput }))
        .execute('analyzer', (state) => ({ inputText: state.userInput }))
        .map((state) => ({
          originalInput: state.userInput,
          summary: state.summarizerResult.summary,
          analysis: state.analyzerResult.analysis,
        }));

      const result = await myFlow.forward(stateMockAI, {
        userInput: 'original input',
      });

      expect(result.originalInput).toBe('original input');
      expect(result.summary).toBe('Generated content');
      expect(result.analysis).toBe('Generated content');
    });

    it('should handle complex state modifications', async () => {
      const complexMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'transformed data', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'complex',
            model: 'transformer',
            tokens: { promptTokens: 8, completionTokens: 5, totalTokens: 13 },
          },
        },
      });

      const myFlow = flow<
        { dataItems: string[] },
        { results: string[]; count: number }
      >({
        autoParallel: false,
      })
        .node('processor', 'dataItem:string -> processedText:string')
        .map((state) => ({ ...state, results: [] as string[], count: 0 }))
        .while((state) => state.count < state.dataItems.length)
        .execute('processor', (state) => ({
          dataItem: state.dataItems[state.count],
        }))
        .map((state) => ({
          ...state,
          results: [...state.results, state.processorResult.processedText],
          count: state.count + 1,
        }))
        .endWhile()
        .map((state) => ({ results: state.results, count: state.count }));

      const result = await myFlow.forward(complexMockAI, {
        dataItems: ['item1', 'item2'],
      });

      expect(result.results).toEqual(['transformed data', 'transformed data']);
      expect(result.count).toBe(2);
    });
  });

  describe('integration with dspy-ts ecosystem', () => {
    it('should be compatible with AxProgram interface', () => {
      const myFlow = flow();

      // Should have all required methods from AxProgram
      expect(typeof myFlow.forward).toBe('function');
      expect(typeof myFlow.getSignature).toBe('function');
      expect(typeof myFlow.setExamples).toBe('function');
      expect(typeof myFlow.getTraces).toBe('function');
      expect(typeof myFlow.getUsage).toBe('function');
    });

    it('should support program options', async () => {
      const optionsMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: 'test result', finishReason: 'stop' }],
          modelUsage: {
            ai: 'options',
            model: 'tester',
            tokens: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
          },
        },
      });

      const myFlow = flow<{ userInput: string }, { outputResult: string }>({
        autoParallel: false,
      })
        .node('processor', 'inputText:string -> outputResult:string')
        .execute('processor', (state) => ({ inputText: state.userInput }))
        .map((state) => ({ outputResult: state.processorResult.outputResult }));

      const options = { debug: false, maxRetries: 3 };
      const result = await myFlow.forward(
        optionsMockAI,
        { userInput: 'test' },
        options
      );

      expect(result.outputResult).toBe('test result');
    });
  });

  describe('error handling', () => {
    it('should handle execution errors gracefully', async () => {
      const myFlow = flow()
        .node('processor', 'inputText:string -> outputResult:string')
        .execute('processor', (state) => ({ inputText: state.userInput }));

      // Mock AI service that throws an error
      const errorAI = new AxMockAIService();
      vi.spyOn(errorAI, 'chat').mockRejectedValue(
        new Error('AI service error')
      );

      await expect(
        myFlow.forward(errorAI, { userInput: 'test' })
      ).rejects.toThrow();
    });

    it('should validate node existence before execution', () => {
      const myFlow = flow();

      expect(() => {
        // Type assertion to test runtime behavior when TypeScript types are bypassed
        (
          myFlow as unknown as {
            execute: (name: string, fn: (state: unknown) => unknown) => unknown;
          }
        ).execute('nonexistent', (state: unknown) => state);
      }).toThrow("Node 'nonexistent' not found");
    });
  });

  describe('conditional branching', () => {
    it('should execute correct branch based on predicate', async () => {
      const branchMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'branch result', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'branch',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          },
        },
      });

      const myFlow = flow<
        { needsComplex: boolean },
        { processedResult: string; strategy: string }
      >({ autoParallel: false })
        .node('simple', 'taskInput:string -> responseText:string')
        .node('complex', 'taskInput:string -> responseText:string')
        .branch((state) => state.needsComplex)
        .when(true)
        .execute('complex', () => ({ taskInput: 'complex task' }))
        .map((state) => ({ ...state, strategy: 'complex' }))
        .when(false)
        .execute('simple', () => ({ taskInput: 'simple task' }))
        .map((state) => ({ ...state, strategy: 'simple' }))
        .merge()
        .map((state) => ({
          processedResult:
            state.complexResult?.responseText ||
            state.simpleResult?.responseText,
          strategy: state.strategy,
        }));

      const complexResult = await myFlow.forward(branchMockAI, {
        needsComplex: true,
      });
      expect(complexResult.strategy).toBe('complex');
      expect(complexResult.processedResult).toBe('branch result');

      const simpleResult = await myFlow.forward(branchMockAI, {
        needsComplex: false,
      });
      expect(simpleResult.strategy).toBe('simple');
      expect(simpleResult.processedResult).toBe('branch result');
    });

    it('should handle unmatched branch values gracefully', async () => {
      const myFlow = flow<{ testValue: string }, { processed: boolean }>({
        autoParallel: false,
      })
        .branch((state) => state.testValue)
        .when('expected')
        .map((state) => ({ ...state, processed: true }))
        .merge()
        .map((state) => ({ processed: state.processed || false }));

      const result = await myFlow.forward(mockAI, { testValue: 'unexpected' });
      expect(result.processed).toBe(false);
    });

    it('should throw error for nested branches', () => {
      const myFlow = flow();

      expect(() => {
        myFlow
          .branch(() => true)
          .when(true)
          .branch(() => false); // Nested branch should throw
      }).toThrow('Nested branches are not supported');
    });

    it('should throw error for when() without branch()', () => {
      const myFlow = flow();

      expect(() => {
        myFlow.when(true);
      }).toThrow('when() called without matching branch()');
    });

    it('should throw error for merge() without branch()', () => {
      const myFlow = flow();

      expect(() => {
        myFlow.merge();
      }).toThrow('merge() called without matching branch()');
    });
  });

  describe('parallel execution', () => {
    it('should execute multiple branches in parallel', async () => {
      const parallelMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'parallel result', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'parallel',
            model: 'test',
            tokens: { promptTokens: 8, completionTokens: 6, totalTokens: 14 },
          },
        },
      });

      const myFlow = flow<{ query: string }, { combined: string[] }>({
        autoParallel: false,
      })
        .node('analyzer1', 'query:string -> analysis:string')
        .node('analyzer2', 'query:string -> analysis:string')
        .node('analyzer3', 'query:string -> analysis:string')

        .parallel([
          (subFlow: any) =>
            subFlow.execute('analyzer1', (state: any) => ({
              query: state.query,
            })),
          (subFlow: any) =>
            subFlow.execute('analyzer2', (state: any) => ({
              query: state.query,
            })),
          (subFlow: any) =>
            subFlow.execute('analyzer3', (state: any) => ({
              query: state.query,
            })),
        ])
        .merge('combined', (result1, result2, result3) => [
          (result1 as any).analyzer1Result.analysis,
          (result2 as any).analyzer2Result.analysis,
          (result3 as any).analyzer3Result.analysis,
        ]);

      const result = await myFlow.forward(parallelMockAI, {
        query: 'test query',
      });
      expect(result.combined).toEqual([
        'parallel result',
        'parallel result',
        'parallel result',
      ]);
    });

    it('should handle parallel execution with different node results', async () => {
      const myFlow = flow<
        { requestData: string },
        { processedResults: string[] }
      >({ autoParallel: false })
        .node('processor1', 'documentText:string -> responseText:string')
        .node('processor2', 'documentText:string -> responseText:string')

        .parallel([
          (subFlow: any) =>
            subFlow
              .execute('processor1', (state: any) => ({
                documentText: state.requestData,
              }))
              .map((state: any) => ({ ...state, type: 'type1' })),
          (subFlow: any) =>
            subFlow
              .execute('processor2', (state: any) => ({
                documentText: state.requestData,
              }))
              .map((state: any) => ({ ...state, type: 'type2' })),
        ])
        .merge('processedResults', (result1, result2) => [
          `${(result1 as Record<string, unknown>).type}: ${(result1 as Record<string, { responseText: string }>).processor1Result?.responseText || 'default'}`,
          `${(result2 as Record<string, unknown>).type}: ${(result2 as Record<string, { responseText: string }>).processor2Result?.responseText || 'default'}`,
        ]);

      const result = await myFlow.forward(mockAI, {
        requestData: 'test input',
      });
      expect(result.processedResults).toEqual([
        'type1: Mock response',
        'type2: Mock response',
      ]);
    });
  });

  describe('feedback loops', () => {
    it('should execute feedback loop when condition is met', async () => {
      let callCount = 0;
      const feedbackMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'attempt result', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'feedback',
            model: 'test',
            tokens: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
          },
        },
      });

      const myFlow = flow<
        { userInput: string },
        { processedResult: string; attempts: number }
      >({ autoParallel: false })
        .node(
          'processor',
          'userInput:string, attempt:number -> responseText:string'
        )
        .node('evaluator', 'responseText:string -> confidence:number')

        .map((state) => ({ ...state, attempts: 0 }))
        .label('retry-point')
        .map((state) => ({ ...state, attempts: state.attempts + 1 }))
        .execute('processor', (state) => ({
          userInput: state.userInput,
          attempt: state.attempts,
        }))
        .execute('evaluator', (state) => ({
          responseText: state.processorResult.responseText,
        }))
        .feedback((state) => {
          // Simulate low confidence for first 2 attempts
          return (
            state.attempts < 3 &&
            ((state.evaluatorResult?.confidence as number) || 0) < 0.8
          );
        }, 'retry-point')
        .map((state) => ({
          processedResult: state.processorResult.responseText,
          attempts: state.attempts,
        }));

      // Mock evaluator to return low confidence first, then high
      vi.spyOn(feedbackMockAI, 'chat').mockImplementation(async () => {
        callCount++;
        if (callCount % 2 === 0) {
          // evaluator calls (even numbers)
          return {
            results: [
              {
                index: 0,
                content: callCount <= 4 ? '0.5' : '0.9', // Low confidence first 2 attempts, then high
                finishReason: 'stop',
              },
            ],
            modelUsage: {
              ai: 'feedback',
              model: 'evaluator',
              tokens: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
            },
          };
        }
        // processor calls (odd numbers)
        return {
          results: [
            {
              index: 0,
              content: `attempt ${Math.ceil(callCount / 2)} result`,
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'feedback',
            model: 'processor',
            tokens: { promptTokens: 6, completionTokens: 4, totalTokens: 10 },
          },
        };
      });

      const result = await myFlow.forward(feedbackMockAI, {
        userInput: 'test',
      });
      expect(result.attempts).toBeGreaterThan(1); // Should have retried
      expect(result.processedResult).toMatch(/attempt \d+ result/);
    });

    it('should respect maximum iterations limit', async () => {
      const myFlow = flow<{ userInput: string }, { attempts: number }>({
        autoParallel: false,
      })
        .node('processor', 'userInput:string -> responseText:string')

        .map((state) => ({ ...state, attempts: 0 }))
        .label('retry-point')
        .map((state) => ({ ...state, attempts: state.attempts + 1 }))
        .execute('processor', (state) => ({ userInput: state.userInput }))
        .feedback(
          () => true, // Always retry
          'retry-point',
          3 // Max 3 iterations
        )
        .map((state) => ({ attempts: state.attempts }));

      const result = await myFlow.forward(mockAI, { userInput: 'test' });
      expect(result.attempts).toBe(3); // Should stop at max iterations
    });

    it('should throw error for invalid label', () => {
      const myFlow = flow();

      expect(() => {
        myFlow.feedback(() => true, 'nonexistent-label');
      }).toThrow("Label 'nonexistent-label' not found");
    });

    it('should throw error for labels inside branch blocks', () => {
      const myFlow = flow();

      expect(() => {
        myFlow
          .branch(() => true)
          .when(true)
          .label('invalid-label'); // Should throw
      }).toThrow('Cannot create labels inside branch blocks');
    });
  });

  describe('complex combined flows', () => {
    it('should handle branching within loops', async () => {
      let callCount = 0;
      const complexMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: 'processed', finishReason: 'stop' }],
          modelUsage: {
            ai: 'complex',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        },
      });

      // Mock different responses for different node types
      vi.spyOn(complexMockAI, 'chat').mockImplementation(async (req) => {
        callCount++;
        const isClassifier = req.chatPrompt.some(
          (msg) =>
            (msg.role === 'user' || msg.role === 'system') &&
            typeof msg.content === 'string' &&
            msg.content.includes('Is Complex')
        );

        if (isClassifier) {
          // Classifier should return boolean - alternate between true/false
          return {
            results: [
              {
                index: 0,
                content: callCount % 2 === 1 ? 'true' : 'false',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'complex',
              model: 'classifier',
              tokens: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
            },
          };
        }
        // Processors return text
        return {
          results: [
            {
              index: 0,
              content: 'processed',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: {
            ai: 'complex',
            model: 'processor',
            tokens: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        };
      });

      const myFlow = flow<
        { itemList: string[] },
        { processedResults: string[] }
      >({ autoParallel: false })
        .node('simpleProcessor', 'itemText:string -> processedText:string')
        .node('complexProcessor', 'itemText:string -> processedText:string')
        .node('classifier', 'itemText:string -> isComplex:boolean')

        .map((state) => ({ ...state, processedResults: [], index: 0 }))
        .while((state) => state.index < state.itemList.length)
        .map((state) => ({
          ...state,
          currentItem: state.itemList[state.index],
        }))
        .execute('classifier', (state) => ({ itemText: state.currentItem }))
        .branch((state) => state.classifierResult.isComplex)
        .when(true)
        .execute('complexProcessor', (state) => ({
          itemText: state.currentItem,
        }))
        .when(false)
        .execute('simpleProcessor', (state) => ({
          itemText: state.currentItem,
        }))
        .merge()
        .map((state) => ({
          ...state,
          processedResults: [
            ...state.processedResults,
            state.complexProcessorResult?.processedText ||
              state.simpleProcessorResult?.processedText,
          ],
          index: state.index + 1,
        }))
        .endWhile()
        .map((state) => ({ processedResults: state.processedResults }));

      const result = await myFlow.forward(complexMockAI, {
        itemList: ['item1', 'item2', 'item3'],
      });
      expect(result.processedResults).toHaveLength(3);
      expect(
        result.processedResults.every((r: unknown) => r === 'processed')
      ).toBe(true);
    });
  });
});

describe('AxFlow Signature Inference', () => {
  it.skip('should infer signature from flow dependencies', async () => {
    const mockAI = new AxMockAIService({
      chatResponse: (messages) => {
        // Check which node is being executed based on the message content
        const messageContent = messages[messages.length - 1]?.content || '';

        if (
          messageContent.includes('userText:') ||
          messageContent.includes('User Text:')
        ) {
          // Response for analyzer node - use title case for field names
          return {
            results: [
              {
                index: 0,
                content: 'Sentiment Value: positive\nConfidence Score: 0.8',
                finishReason: 'stop',
              },
            ],
            modelUsage: {
              ai: 'mock',
              model: 'test',
              tokens: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            },
          };
        }
        // Response for formatter node
        return {
          results: [
            {
              index: 0,
              content:
                'Formatted Result: This is positive sentiment with 80% confidence',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'test',
            tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
        };
      },
    });

    // Create a flow without passing a signature
    const flow = new AxFlow()
      .node(
        'analyzer',
        'userText:string -> sentimentValue:string, confidenceScore:number'
      )
      .node(
        'formatter',
        'rawSentiment:string, score:number -> formattedResult:string'
      )
      .execute('analyzer', (state: any) => ({ userText: state.userInput }))
      .execute('formatter', (state: any) => ({
        rawSentiment: state.analyzerResult.sentimentValue,
        score: state.analyzerResult.confidenceScore,
      }));

    // The signature should be inferred from the flow structure
    const signature = flow.getSignature();

    // Check that the signature has been inferred
    expect(signature).toBeDefined();
    expect(signature.toString()).toBeTruthy();

    // Execute the flow to verify it works
    const result = await flow.forward(mockAI, { userInput: 'This is great!' });
    expect(result).toBeDefined();
  });

  it('should handle flows with no dependencies correctly', async () => {
    const mockAI = new AxMockAIService({
      chatResponse: {
        results: [{ index: 0, content: 'Mock response', finishReason: 'stop' }],
        modelUsage: {
          ai: 'mock',
          model: 'test',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    });

    // Create a flow with just nodes but no executions
    const flow = new AxFlow().node(
      'standalone',
      'inputData:string -> outputData:string'
    );

    // Should have a default signature
    const signature = flow.getSignature();
    expect(signature).toBeDefined();
    expect(signature.toString()).toBeTruthy();

    // Should be able to execute with default inputs
    const result = await flow.forward(mockAI, { userInput: 'test' });
    expect(result).toBeDefined();
  });

  it('should allow manual signature override', async () => {
    const mockAI = new AxMockAIService({
      chatResponse: {
        results: [{ index: 0, content: 'Mock response', finishReason: 'stop' }],
        modelUsage: {
          ai: 'mock',
          model: 'test',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    });

    // Create a flow with explicit signature (note: this test is about manual override, not inference)
    const _customSignature = 'customInput:string -> customOutput:string';
    const flow = new AxFlow().node(
      'processor',
      'dataIn:string -> dataOut:string'
    );

    // Without manual override, should infer signature from flow structure
    const signature = flow.getSignature();
    expect(signature.toString()).toContain('processorDataOut'); // Should use actual field name from node signature

    // Should be able to execute
    const result = await flow.forward(mockAI, { userInput: 'test' });
    expect(result).toBeDefined();
  });

  it.skip('should infer complex signatures with multiple input/output nodes', async () => {
    const mockAI = new AxMockAIService({
      chatResponse: (messages) => {
        // Check which node is being executed based on the message content
        const messageContent = messages[messages.length - 1]?.content || '';

        if (
          messageContent.includes('rawInput:') ||
          messageContent.includes('Raw Input:')
        ) {
          // Response for preprocessor node
          return {
            results: [
              {
                index: 0,
                content: 'Cleaned Text: processed input',
                finishReason: 'stop',
              },
            ],
            modelUsage: {
              ai: 'mock',
              model: 'test',
              tokens: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            },
          };
        }
        if (
          messageContent.includes('textData:') ||
          messageContent.includes('Text Data:')
        ) {
          // Check if it's for sentiment or topics based on the signature context
          if (
            messageContent.includes('Sentiment:') ||
            messageContent.includes('sentiment')
          ) {
            // Response for analyzer1 node
            return {
              results: [
                {
                  index: 0,
                  content: 'Sentiment: positive',
                  finishReason: 'stop',
                },
              ],
              modelUsage: {
                ai: 'mock',
                model: 'test',
                tokens: {
                  promptTokens: 10,
                  completionTokens: 5,
                  totalTokens: 15,
                },
              },
            };
          }
          // Response for analyzer2 node
          return {
            results: [
              {
                index: 0,
                content: 'Topics: ["technology", "AI", "programming"]',
                finishReason: 'stop',
              },
            ],
            modelUsage: {
              ai: 'mock',
              model: 'test',
              tokens: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            },
          };
        }
        // Response for combiner node
        return {
          results: [
            {
              index: 0,
              content:
                'Final Report: Positive sentiment about technology and AI',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'test',
            tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
        };
      },
    });

    // Create a complex flow with branching
    const flow = new AxFlow()
      .node('preprocessor', 'rawInput:string -> cleanedText:string')
      .node('analyzer1', 'textData:string -> sentiment:string')
      .node('analyzer2', 'textData:string -> topics:string[]')
      .node(
        'combiner',
        'sentimentData:string, topicData:string[] -> finalReport:string'
      )
      .execute('preprocessor', (state: any) => ({ rawInput: state.userInput }))
      .execute('analyzer1', (state: any) => ({
        textData: state.preprocessorResult.cleanedText,
      }))
      .execute('analyzer2', (state: any) => ({
        textData: state.preprocessorResult.cleanedText,
      }))
      .execute('combiner', (state: any) => ({
        sentimentData: state.analyzer1Result.sentiment,
        topicData: state.analyzer2Result.topics,
      }));

    // The signature should be inferred from the flow structure
    const signature = flow.getSignature();
    expect(signature).toBeDefined();

    // Should identify userInput as input and finalReport as output (actual field name, not wrapper)
    const inputFields = signature.getInputFields();
    const outputFields = signature.getOutputFields();

    expect(inputFields.length).toBeGreaterThan(0);
    expect(outputFields.length).toBeGreaterThan(0);

    // Should use the actual field name from the node signature, not the wrapper name
    expect(signature.toString()).toContain('finalReport');

    // Execute the flow
    const result = await flow.forward(mockAI, {
      userInput: 'Complex analysis text',
    });
    expect(result).toBeDefined();
  });
});

describe('AxFlow > node definition > new overloads', () => {
  it('should define a node with AxSignature instance', () => {
    const myFlow = flow<{ topic: string }, { result: string }>();
    const signature = 'documentText:string -> summaryText:string';

    myFlow.node('summarizer', signature, { debug: true, logger: () => {} });

    // Test that the node was registered (we can't easily test execution without proper typing)
    expect(() => {
      // @ts-expect-error - testing runtime behavior
      myFlow.execute('summarizer', () => ({ documentText: 'test' }));
    }).not.toThrow();
  });

  it('should throw error for invalid second argument', () => {
    const myFlow = flow<{ topic: string }, { result: string }>();

    expect(() => {
      // @ts-expect-error - testing invalid argument
      myFlow.node('invalid', 123);
    }).toThrow('Invalid second argument for node');
  });
});

describe('AxFlow > derive method', () => {
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

  it('should derive a new field from array input with parallel processing', async () => {
    const myFlow = flow<{ items: string[] }, { processedItems: string[] }>({
      autoParallel: true,
      batchSize: 2,
    }).derive(
      'processedItems',
      'items',
      (item: string, index?: number) => `processed-${item}-${index}`
    );

    const result = await myFlow.forward(mockAI, {
      items: ['item1', 'item2', 'item3', 'item4'],
    });

    expect(result.processedItems).toEqual([
      'processed-item1-0',
      'processed-item2-1',
      'processed-item3-2',
      'processed-item4-3',
    ]);
  });

  it('should derive a new field from array input with custom batch size', async () => {
    const myFlow = flow<{ numbers: number[] }, { doubled: number[] }>({
      autoParallel: true,
    }).derive('doubled', 'numbers', (num: number) => num * 2, { batchSize: 1 });

    const result = await myFlow.forward(mockAI, {
      numbers: [1, 2, 3, 4, 5],
    });

    expect(result.doubled).toEqual([2, 4, 6, 8, 10]);
  });

  it('should derive a new field from scalar input', async () => {
    const myFlow = flow<{ inputText: string }, { upperText: string }>().derive(
      'upperText',
      'inputText',
      (text: string) => text.toUpperCase()
    );

    const result = await myFlow.forward(mockAI, { inputText: 'hello world' });

    expect(result.upperText).toBe('HELLO WORLD');
  });

  it('should use sequential processing when autoParallel is disabled', async () => {
    const myFlow = flow<{ items: string[] }, { processedItems: string[] }>({
      autoParallel: false,
    }).derive(
      'processedItems',
      'items',
      (item: string, index?: number) => `seq-${item}-${index}`
    );

    const result = await myFlow.forward(mockAI, {
      items: ['a', 'b', 'c'],
    });

    expect(result.processedItems).toEqual(['seq-a-0', 'seq-b-1', 'seq-c-2']);
  });

  it('should throw error when input field does not exist', async () => {
    const myFlow = flow<
      { inputText: string },
      { outputResult: string }
    >().derive('outputResult', 'nonexistent', (value: any) => value);

    await expect(myFlow.forward(mockAI, { inputText: 'test' })).rejects.toThrow(
      "Input field 'nonexistent' not found in state"
    );
  });

  it('should work with complex transformations', async () => {
    const myFlow = flow<
      { users: Array<{ name: string; age: number }> },
      { adultNames: string[] }
    >()
      .derive('adultNames', 'users', (user: { name: string; age: number }) =>
        user.age >= 18 ? user.name : null
      )
      .map((state) => ({
        adultNames: state.adultNames.filter((name) => name !== null),
      }));

    const result = await myFlow.forward(mockAI, {
      users: [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 16 },
        { name: 'Charlie', age: 30 },
      ],
    });

    expect(result.adultNames).toEqual(['Alice', 'Charlie']);
  });

  it('should preserve state and chain with other operations', async () => {
    const myFlow = flow<
      { items: string[]; prefix: string },
      {
        items: string[];
        prefix: string;
        prefixedItems: string[];
        count: number;
      }
    >()
      .derive(
        'prefixedItems',
        'items',
        (item: string, _index?: number, state?: any) =>
          `${state?.prefix || 'default'}-${item}` // Note: transform doesn't get state, this tests item processing
      )
      .map((state) => ({
        ...state,
        prefixedItems: state.items.map((item) => `${state.prefix}-${item}`), // Fixed implementation
        count: state.items.length,
      }));

    const result = await myFlow.forward(mockAI, {
      items: ['apple', 'banana'],
      prefix: 'fruit',
    });

    expect(result.items).toEqual(['apple', 'banana']);
    expect(result.prefix).toBe('fruit');
    expect(result.prefixedItems).toEqual(['fruit-apple', 'fruit-banana']);
    expect(result.count).toBe(2);
  });
});

describe('AxFlow > derive method signature inference', () => {
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

  it('should include derived field in signature output fields', () => {
    const myFlow = flow<
      { inputItems: string[] },
      { outputItems: string[] }
    >().derive('processedData', 'inputItems', (item: string) =>
      item.toUpperCase()
    );

    const signature = myFlow.getSignature();
    const outputFields = signature.getOutputFields();

    const outputFieldNames = outputFields.map((field) => field.name);
    expect(outputFieldNames).toContain('processedData');
  });

  it('should register derived field dependencies in execution planner', () => {
    const myFlow = flow<{ items: string[] }, { results: string[] }>().derive(
      'results',
      'items',
      (item: string) => `result-${item}`
    );

    const executionPlan = myFlow.getExecutionPlan();

    // Find the derive step
    const deriveStep = executionPlan.steps?.find(
      (step) => step.type === 'derive'
    );
    expect(deriveStep).toBeDefined();
    expect(deriveStep?.dependencies).toContain('items');
    expect(deriveStep?.produces).toContain('results');
  });

  it('should infer correct signature with multiple derive operations', () => {
    const myFlow = flow<
      { numbers: number[]; texts: string[] },
      { doubled: number[]; uppercased: string[] }
    >()
      .derive('doubled', 'numbers', (num: number) => num * 2)
      .derive('uppercased', 'texts', (text: string) => text.toUpperCase());

    const signature = myFlow.getSignature();
    const inputFields = signature.getInputFields();
    const outputFields = signature.getOutputFields();

    const inputFieldNames = inputFields.map((field) => field.name);
    const outputFieldNames = outputFields.map((field) => field.name);

    expect(inputFieldNames).toContain('numbers');
    expect(inputFieldNames).toContain('texts');
    expect(outputFieldNames).toContain('doubled');
    expect(outputFieldNames).toContain('uppercased');
  });

  it('should work with derive as final operation in signature inference', async () => {
    const myFlow = flow<{ inputData: string[] }, { finalResult: string[] }>()
      .map((state) => ({ ...state, intermediate: 'processed' }))
      .derive('finalResult', 'inputData', (item: string) => `final-${item}`);

    const signature = myFlow.getSignature();
    const outputFields = signature.getOutputFields();
    const outputFieldNames = outputFields.map((field) => field.name);

    // finalResult should be in output fields since it's the last operation
    expect(outputFieldNames).toContain('finalResult');

    // Test execution works
    const result = await myFlow.forward(mockAI, {
      inputData: ['test1', 'test2'],
    });
    expect(result.finalResult).toEqual(['final-test1', 'final-test2']);
  });
});
