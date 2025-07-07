/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import type { AxAIService } from '../ai/types.js'
import { AxProgram } from '../dsp/program.js'
import { AxSignature } from '../dsp/sig.js'

import { AxFlow } from './flow.js'

describe('AxFlow', () => {
  let mockAI: AxMockAIService

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
    })
  })

  describe('constructor', () => {
    it('should create an AxFlow instance with default signature', () => {
      const flow = new AxFlow()
      expect(flow).toBeInstanceOf(AxFlow)
    })

    it('should create an AxFlow instance with custom signature', () => {
      const flow = new AxFlow('customInput:string -> customOutput:string')
      expect(flow).toBeInstanceOf(AxFlow)
    })
  })

  describe('node definition', () => {
    it('should define a node with simple signature', () => {
      const flow = new AxFlow()
      expect(() => {
        flow.node('testNode', 'userInput:string -> responseText:string')
      }).not.toThrow()
    })

    it('should define a node with complex field types', () => {
      const flow = new AxFlow()
      expect(() => {
        flow.node(
          'complexNode',
          'documentText:string -> processedResult:string, confidence:number'
        )
      }).not.toThrow()
    })

    it('should throw error for invalid signature', () => {
      const flow = new AxFlow()
      expect(() => {
        flow.node('badNode', '')
      }).toThrow('Invalid signature for node')
    })

    it('should throw error when executing non-existent node', async () => {
      const flow = new AxFlow()
      // The type system now prevents this at compile time, but we test runtime behavior
      // by casting to bypass type checking
      expect(() => {
        // Type assertion to test runtime behavior when TypeScript types are bypassed
        ;(
          flow as unknown as {
            execute: (name: string, fn: () => unknown) => unknown
          }
        ).execute('nonexistent', () => ({}))
      }).toThrow("Node 'nonexistent' not found")
    })
  })

  describe('fluent interface', () => {
    it('should support method chaining', () => {
      const flow = new AxFlow()
        .node('testNode', 'userInput:string -> responseText:string')
        .map((state) => state)
        .execute('testNode', () => ({ userInput: 'test' }))

      expect(flow).toBeInstanceOf(AxFlow)
    })
  })

  describe('map transformation', () => {
    it('should apply synchronous state transformations', async () => {
      const flow = new AxFlow<{ value: number }, { doubled: number }>().map(
        (state) => ({ ...state, doubled: state.value * 2 })
      )

      const result = await flow.forward(mockAI, { value: 5 })
      expect(result.doubled).toBe(10)
    })
  })

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
      })

      const flow = new AxFlow<
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
        }))

      const result = await flow.forward(mockAI, { userInput: 'test' })

      expect(result.primaryResult).toBe('Mock response')
      expect(result.altResult).toBe('Alt response')
    })

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
      })

      const flow = new AxFlow<{ topic: string }, { summary: string }>(
        'topic:string -> summary:string',
        { autoParallel: false }
      )
        .node('summarizer', 'documentText:string -> summary:string')
        .map((input) => ({ originalText: `Some text about ${input.topic}` }))
        .execute('summarizer', (state) => ({
          documentText: state.originalText,
        }))
        .map((state) => ({ summary: state.summarizerResult.summary }))

      const result = await flow.forward(defaultMockAI, { topic: 'technology' })

      expect(result.summary).toBe('Default summary')
    })
  })

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
      })

      const flow = new AxFlow<{ iterations: number }, { finalCount: number }>(
        'iterations:number -> finalCount:number',
        { autoParallel: false }
      )
        .node('processor', 'iterationCount:number -> processedResult:string')
        .while((state) => state.iterations < 3)
        .map((state) => ({ ...state, iterations: state.iterations + 1 }))
        .execute('processor', (state) => ({ iterationCount: state.iterations }))
        .endWhile()
        .map((state) => ({ finalCount: state.iterations }))

      const result = await flow.forward(loopMockAI, { iterations: 0 })

      expect(result.finalCount).toBe(3)
    })

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
      })

      const flow = new AxFlow<{ counter: number }, { total: number }>(
        'counter:number -> total:number',
        { autoParallel: false }
      )
        .node('checker', 'counterValue:number -> statusCheck:string')
        .while((state) => state.counter < 2)
        .map((state) => ({ ...state, counter: state.counter + 1 }))
        .execute('checker', (state) => ({ counterValue: state.counter }))
        .map((state: Record<string, unknown>) => ({
          ...state,
          total: ((state.total as number) || 0) + (state.counter as number),
        }))
        .endWhile()
        .map((state) => ({ total: state.total || 0 }))

      const result = await flow.forward(nestedMockAI, { counter: 0 })

      expect(result.total).toBe(3) // 1 + 2 = 3
    })

    it('should throw error for unmatched endWhile', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.endWhile()
      }).toThrow('endWhile() called without matching while()')
    })
  })

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
      })

      const flow = new AxFlow<
        { userInput: string },
        { originalInput: string; summary: string; analysis: string }
      >(
        'userInput:string -> originalInput:string, summary:string, analysis:string',
        { autoParallel: false }
      )
        .node('summarizer', 'documentText:string -> summary:string')
        .node('analyzer', 'inputText:string -> analysis:string')
        .execute('summarizer', (state) => ({ documentText: state.userInput }))
        .execute('analyzer', (state) => ({ inputText: state.userInput }))
        .map((state) => ({
          originalInput: state.userInput,
          summary: state.summarizerResult.summary,
          analysis: state.analyzerResult.analysis,
        }))

      const result = await flow.forward(stateMockAI, {
        userInput: 'original input',
      })

      expect(result.originalInput).toBe('original input')
      expect(result.summary).toBe('Generated content')
      expect(result.analysis).toBe('Generated content')
    })

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
      })

      const flow = new AxFlow<
        { dataItems: string[] },
        { results: string[]; count: number }
      >('dataItems:string[] -> results:string[], count:number', {
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
        .map((state) => ({ results: state.results, count: state.count }))

      const result = await flow.forward(complexMockAI, {
        dataItems: ['item1', 'item2'],
      })

      expect(result.results).toEqual(['transformed data', 'transformed data'])
      expect(result.count).toBe(2)
    })
  })

  describe('integration with dspy-ts ecosystem', () => {
    it('should be compatible with AxProgram interface', () => {
      const flow = new AxFlow()

      // Should have all required methods from AxProgram
      expect(typeof flow.forward).toBe('function')
      expect(typeof flow.getSignature).toBe('function')
      expect(typeof flow.setExamples).toBe('function')
      expect(typeof flow.getTraces).toBe('function')
      expect(typeof flow.getUsage).toBe('function')
    })

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
      })

      const flow = new AxFlow<{ userInput: string }, { outputResult: string }>(
        'userInput:string -> outputResult:string',
        { autoParallel: false }
      )
        .node('processor', 'inputText:string -> outputResult:string')
        .execute('processor', (state) => ({ inputText: state.userInput }))
        .map((state) => ({ outputResult: state.processorResult.outputResult }))

      const options = { debug: false, maxRetries: 3 }
      const result = await flow.forward(
        optionsMockAI,
        { userInput: 'test' },
        options
      )

      expect(result.outputResult).toBe('test result')
    })
  })

  describe('error handling', () => {
    it('should handle execution errors gracefully', async () => {
      const flow = new AxFlow()
        .node('processor', 'inputText:string -> outputResult:string')
        .execute('processor', (state) => ({ inputText: state.input }))

      // Mock AI service that throws an error
      const errorAI = new AxMockAIService()
      vi.spyOn(errorAI, 'chat').mockRejectedValue(new Error('AI service error'))

      await expect(flow.forward(errorAI, { input: 'test' })).rejects.toThrow()
    })

    it('should validate node existence before execution', () => {
      const flow = new AxFlow()

      expect(() => {
        // Type assertion to test runtime behavior when TypeScript types are bypassed
        ;(
          flow as unknown as {
            execute: (name: string, fn: (state: unknown) => unknown) => unknown
          }
        ).execute('nonexistent', (state: unknown) => state)
      }).toThrow("Node 'nonexistent' not found")
    })
  })

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
      })

      const flow = new AxFlow<
        { needsComplex: boolean },
        { processedResult: string; strategy: string }
      >('needsComplex:boolean -> processedResult:string, strategy:string', {
        autoParallel: false,
      })
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
        }))

      const complexResult = await flow.forward(branchMockAI, {
        needsComplex: true,
      })
      expect(complexResult.strategy).toBe('complex')
      expect(complexResult.processedResult).toBe('branch result')

      const simpleResult = await flow.forward(branchMockAI, {
        needsComplex: false,
      })
      expect(simpleResult.strategy).toBe('simple')
      expect(simpleResult.processedResult).toBe('branch result')
    })

    it('should handle unmatched branch values gracefully', async () => {
      const flow = new AxFlow<{ testValue: string }, { processed: boolean }>(
        'testValue:string -> processed:boolean',
        { autoParallel: false }
      )
        .branch((state) => state.testValue)
        .when('expected')
        .map((state) => ({ ...state, processed: true }))
        .merge()
        .map((state) => ({ processed: state.processed || false }))

      const result = await flow.forward(mockAI, { testValue: 'unexpected' })
      expect(result.processed).toBe(false)
    })

    it('should throw error for nested branches', () => {
      const flow = new AxFlow()

      expect(() => {
        flow
          .branch(() => true)
          .when(true)
          .branch(() => false) // Nested branch should throw
      }).toThrow('Nested branches are not supported')
    })

    it('should throw error for when() without branch()', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.when(true)
      }).toThrow('when() called without matching branch()')
    })

    it('should throw error for merge() without branch()', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.merge()
      }).toThrow('merge() called without matching branch()')
    })
  })

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
      })

      const flow = new AxFlow<{ query: string }, { combined: string[] }>(
        'query:string -> combined:string[]',
        { autoParallel: false }
      )
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
        ])

      const result = await flow.forward(parallelMockAI, { query: 'test query' })
      expect(result.combined).toEqual([
        'parallel result',
        'parallel result',
        'parallel result',
      ])
    })

    it('should handle parallel execution with different node results', async () => {
      const flow = new AxFlow<
        { requestData: string },
        { processedResults: string[] }
      >('requestData:string -> processedResults:string[]', {
        autoParallel: false,
      })
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
        ])

      const result = await flow.forward(mockAI, { requestData: 'test input' })
      expect(result.processedResults).toEqual([
        'type1: Mock response',
        'type2: Mock response',
      ])
    })
  })

  describe('feedback loops', () => {
    it('should execute feedback loop when condition is met', async () => {
      let callCount = 0
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
      })

      const flow = new AxFlow<
        { userInput: string },
        { processedResult: string; attempts: number }
      >('userInput:string -> processedResult:string, attempts:number', {
        autoParallel: false,
      })
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
          )
        }, 'retry-point')
        .map((state) => ({
          processedResult: state.processorResult.responseText,
          attempts: state.attempts,
        }))

      // Mock evaluator to return low confidence first, then high
      vi.spyOn(feedbackMockAI, 'chat').mockImplementation(async () => {
        callCount++
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
          }
        } else {
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
          }
        }
      })

      const result = await flow.forward(feedbackMockAI, { userInput: 'test' })
      expect(result.attempts).toBeGreaterThan(1) // Should have retried
      expect(result.processedResult).toMatch(/attempt \d+ result/)
    })

    it('should respect maximum iterations limit', async () => {
      const flow = new AxFlow<{ userInput: string }, { attempts: number }>(
        'userInput:string -> attempts:number',
        { autoParallel: false }
      )
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
        .map((state) => ({ attempts: state.attempts }))

      const result = await flow.forward(mockAI, { userInput: 'test' })
      expect(result.attempts).toBe(3) // Should stop at max iterations
    })

    it('should throw error for invalid label', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.feedback(() => true, 'nonexistent-label')
      }).toThrow("Label 'nonexistent-label' not found")
    })

    it('should throw error for labels inside branch blocks', () => {
      const flow = new AxFlow()

      expect(() => {
        flow
          .branch(() => true)
          .when(true)
          .label('invalid-label') // Should throw
      }).toThrow('Cannot create labels inside branch blocks')
    })
  })

  describe('complex combined flows', () => {
    it('should handle branching within loops', async () => {
      let callCount = 0
      const complexMockAI = new AxMockAIService({
        chatResponse: {
          results: [{ index: 0, content: 'processed', finishReason: 'stop' }],
          modelUsage: {
            ai: 'complex',
            model: 'test',
            tokens: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        },
      })

      // Mock different responses for different node types
      vi.spyOn(complexMockAI, 'chat').mockImplementation(async (req) => {
        callCount++
        const isClassifier = req.chatPrompt.some(
          (msg) =>
            (msg.role === 'user' || msg.role === 'system') &&
            typeof msg.content === 'string' &&
            msg.content.includes('Is Complex')
        )

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
          }
        } else {
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
          }
        }
      })

      const flow = new AxFlow<
        { itemList: string[] },
        { processedResults: string[] }
      >('itemList:string[] -> processedResults:string[]', {
        autoParallel: false,
      })
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
        .map((state) => ({ processedResults: state.processedResults }))

      const result = await flow.forward(complexMockAI, {
        itemList: ['item1', 'item2', 'item3'],
      })
      expect(result.processedResults).toHaveLength(3)
      expect(
        result.processedResults.every((r: unknown) => r === 'processed')
      ).toBe(true)
    })
  })

  describe('custom program execution', () => {
    it('should execute custom program logic (not just signature)', async () => {
      class CustomUppercaseProgram extends AxProgram<
        { userInput: string },
        { processedOutput: string }
      > {
        constructor() {
          super('userInput:string -> processedOutput:string')
        }

        override async forward(
          ai: AxAIService,
          values: Readonly<{ userInput: string }>
        ): Promise<{ processedOutput: string }> {
          // Custom logic - this should be executed, not the AI
          return {
            processedOutput: `CUSTOM: ${values.userInput.toUpperCase()}`,
          }
        }
      }

      const flow = new AxFlow<{ topic: string }, { result: string }>()
        .node('custom', CustomUppercaseProgram)
        // @ts-expect-error - testing runtime behavior with custom typing
        .execute('custom', () => ({ userInput: 'hello world' }))
        // @ts-expect-error - testing runtime behavior with custom typing
        .map((state) => ({ result: state.customResult.processedOutput }))

      const result = await flow.forward(mockAI, { topic: 'test' })

      // Verify that our custom logic was executed, not the AI
      expect(result.result).toBe('CUSTOM: HELLO WORLD')
    })
  })
})

describe('AxFlow > node definition > new overloads', () => {
  it('should define a node with AxSignature instance', () => {
    const flow = new AxFlow<{ topic: string }, { result: string }>()
    const signature = new AxSignature(
      'documentText:string -> summaryText:string'
    )

    flow.node('summarizer', signature, { debug: true })

    // Test that the node was registered (we can't easily test execution without proper typing)
    expect(() => {
      // @ts-expect-error - testing runtime behavior
      flow.execute('summarizer', () => ({ documentText: 'test' }))
    }).not.toThrow()
  })

  it('should define a node with program class extending AxProgram', () => {
    class CustomProgram extends AxProgram<
      { userInput: string },
      { processedOutput: string }
    > {
      constructor() {
        super('userInput:string -> processedOutput:string')
      }

      override async forward(
        ai: AxAIService,
        values: Readonly<{ userInput: string }>
      ): Promise<{ processedOutput: string }> {
        return { processedOutput: values.userInput.toUpperCase() }
      }
    }

    const flow = new AxFlow<{ topic: string }, { result: string }>()

    flow.node('custom', CustomProgram)

    // Test that the node was registered (we can't easily test execution without proper typing)
    expect(() => {
      // @ts-expect-error - testing runtime behavior
      flow.execute('custom', () => ({ userInput: 'test' }))
    }).not.toThrow()
  })

  it('should support n alias with AxSignature instance', () => {
    const flow = new AxFlow<{ topic: string }, { result: string }>()
    const signature = new AxSignature(
      'documentText:string -> summaryText:string'
    )

    flow.n('summarizer', signature, { debug: true })

    // Test that the node was registered (we can't easily test execution without proper typing)
    expect(() => {
      // @ts-expect-error - testing runtime behavior
      flow.execute('summarizer', () => ({ documentText: 'test' }))
    }).not.toThrow()
  })

  it('should support n alias with program class', () => {
    class CustomProgram extends AxProgram<
      { userInput: string },
      { processedOutput: string }
    > {
      constructor() {
        super('userInput:string -> processedOutput:string')
      }

      override async forward(
        ai: AxAIService,
        values: Readonly<{ userInput: string }>
      ): Promise<{ processedOutput: string }> {
        return { processedOutput: values.userInput.toUpperCase() }
      }
    }

    const flow = new AxFlow<{ topic: string }, { result: string }>()

    flow.n('custom', CustomProgram)

    // Test that the node was registered (we can't easily test execution without proper typing)
    expect(() => {
      // @ts-expect-error - testing runtime behavior
      flow.execute('custom', () => ({ userInput: 'test' }))
    }).not.toThrow()
  })

  it('should throw error for invalid second argument', () => {
    const flow = new AxFlow<{ topic: string }, { result: string }>()

    expect(() => {
      // @ts-expect-error - testing invalid argument
      flow.node('invalid', 123)
    }).toThrow('Invalid second argument for node')
  })
})
