import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import { f } from '../dsp/template.js'

import { AxFlow } from './flow.js'

describe('AxFlow', () => {
  let mockAI: AxMockAIService

  beforeEach(() => {
    mockAI = new AxMockAIService()
  })

  describe('constructor', () => {
    it('should create an AxFlow instance with default signature', () => {
      const flow = new AxFlow()
      expect(flow).toBeInstanceOf(AxFlow)
      expect(flow.getSignature()).toBeDefined()
    })

    it('should create an AxFlow instance with custom signature', () => {
      const flow = new AxFlow<{ topic: string }, { summaryText: string }>(
        'topic:string -> summaryText:string'
      )
      expect(flow).toBeInstanceOf(AxFlow)
      expect(flow.getSignature().getInputFields()).toHaveLength(1)
      expect(flow.getSignature().getOutputFields()).toHaveLength(1)
    })
  })

  describe('node definition', () => {
    it('should define a node with simple signature', () => {
      const flow = new AxFlow()

      const result = flow.node('summarizer', {
        'documentText:string': { summary: f.string() },
      })

      expect(result).toBe(flow) // Should return this for chaining
    })

    it('should define a node with complex field types', () => {
      const flow = new AxFlow()

      flow.node('analyzer', {
        'inputText:string': {
          sentiment: f.class(
            ['positive', 'negative', 'neutral'],
            'Sentiment classification'
          ),
          confidence: f.number('Confidence score 0-1'),
          tags: f.array(f.string('Tag name')),
          isOptional: f.optional(f.string('Optional field')),
          isInternal: f.internal(f.string('Internal reasoning')),
        },
      })

      // Should not throw and should return flow for chaining
      expect(flow).toBeInstanceOf(AxFlow)
    })

    it('should throw error for invalid signature', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.node('invalid', {})
      }).toThrow(
        "Invalid signature for node 'invalid': signature must have at least one input->output mapping"
      )
    })

    it('should throw error when executing non-existent node', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.execute('nonexistent', (state) => state)
      }).toThrow(
        "Node 'nonexistent' not found. Make sure to define it with .node() first."
      )
    })
  })

  describe('fluent interface', () => {
    it('should support method chaining', () => {
      const flow = new AxFlow<
        { topic: string },
        { summary: string; analysis: string }
      >()
        .node('summarizer', { 'documentText:string': { summary: f.string() } })
        .node('analyzer', { 'inputText:string': { analysis: f.string() } })
        .map((input) => ({ originalText: `Some text about ${input.topic}` }))
        .execute('summarizer', (state) => ({
          documentText: state.originalText,
        }))
        .execute('analyzer', (state) => ({ inputText: state.originalText }))
        .map((state) => ({
          summary: state.summarizerResult.summary,
          analysis: state.analyzerResult.analysis,
        }))

      expect(flow).toBeInstanceOf(AxFlow)
    })
  })

  describe('map transformation', () => {
    it('should apply synchronous state transformations', async () => {
      // Create a mock AI service with predictable results
      const testMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Mock summary', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'test',
            tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
        },
      })

      const flow = new AxFlow<
        { topic: string },
        { processedText: string; summary: string }
      >()
        .node('summarizer', { 'documentText:string': { summary: f.string() } })
        .map((input) => ({ processedText: `Processed: ${input.topic}` }))
        .execute('summarizer', (state) => ({
          documentText: state.processedText,
        }))
        .map((state) => ({
          processedText: state.processedText,
          summary: state.summarizerResult.summary,
        }))

      const result = await flow.forward(testMockAI, { topic: 'AI technology' })

      expect(result.processedText).toBe('Processed: AI technology')
      expect(result.summary).toBe('Mock summary')
    })
  })

  describe('execute with dynamic context', () => {
    it('should use different AI services for different nodes', async () => {
      const cheapAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Cheap summary', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'cheap',
            model: 'fast',
            tokens: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        },
      })
      const powerfulAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Powerful analysis', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'powerful',
            model: 'advanced',
            tokens: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
          },
        },
      })

      const flow = new AxFlow<
        { topic: string },
        { summary: string; analysis: string }
      >()
        .node('summarizer', { 'documentText:string': { summary: f.string() } })
        .node('analyzer', { 'inputText:string': { analysis: f.string() } })
        .map((input) => ({ originalText: `Some text about ${input.topic}` }))
        .execute(
          'summarizer',
          (state) => ({ documentText: state.originalText }),
          { ai: cheapAI }
        )
        .execute('analyzer', (state) => ({ inputText: state.originalText }), {
          ai: powerfulAI,
        })
        .map((state) => ({
          summary: state.summarizerResult.summary,
          analysis: state.analyzerResult.analysis,
        }))

      const result = await flow.forward(mockAI, { topic: 'the future of AI' })

      expect(result.summary).toBe('Cheap summary')
      expect(result.analysis).toBe('Powerful analysis')
    })

    it('should use default AI when no dynamic context provided', async () => {
      const defaultMockAI = new AxMockAIService({
        chatResponse: {
          results: [
            { index: 0, content: 'Default summary', finishReason: 'stop' },
          ],
          modelUsage: {
            ai: 'default',
            model: 'standard',
            tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
        },
      })

      const flow = new AxFlow<{ topic: string }, { summary: string }>()
        .node('summarizer', { 'documentText:string': { summary: f.string() } })
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

      const flow = new AxFlow<{ iterations: number }, { finalCount: number }>()
        .node('processor', {
          'iterationCount:number': { processedResult: f.string() },
        })
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

      const flow = new AxFlow<{ counter: number }, { total: number }>()
        .node('checker', { 'counterValue:number': { statusCheck: f.string() } })
        .while((state) => state.counter < 2)
        .map((state) => ({ ...state, counter: state.counter + 1 }))
        .execute('checker', (state) => ({ counterValue: state.counter }))
        .map((state) => ({
          ...state,
          total: (state.total || 0) + state.counter,
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
        { input: string },
        { input: string; summary: string; analysis: string }
      >()
        .node('summarizer', { 'documentText:string': { summary: f.string() } })
        .node('analyzer', { 'inputText:string': { analysis: f.string() } })
        .execute('summarizer', (state) => ({ documentText: state.input }))
        .execute('analyzer', (state) => ({ inputText: state.input }))
        .map((state) => ({
          input: state.input,
          summary: state.summarizerResult.summary,
          analysis: state.analyzerResult.analysis,
        }))

      const result = await flow.forward(stateMockAI, {
        input: 'original input',
      })

      expect(result.input).toBe('original input')
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
        { data: string[] },
        { results: string[]; count: number }
      >()
        .node('processor', { 'dataItem:string': { processedText: f.string() } })
        .map((state) => ({ ...state, results: [] as string[], count: 0 }))
        .while((state) => state.count < state.data.length)
        .execute('processor', (state) => ({
          dataItem: state.data[state.count],
        }))
        .map((state) => ({
          ...state,
          results: [...state.results, state.processorResult.processedText],
          count: state.count + 1,
        }))
        .endWhile()
        .map((state) => ({ results: state.results, count: state.count }))

      const result = await flow.forward(complexMockAI, {
        data: ['item1', 'item2'],
      })

      expect(result.results).toEqual(['transformed data', 'transformed data'])
      expect(result.count).toBe(2)
    })
  })

  describe('integration with dspy-ts ecosystem', () => {
    it('should be compatible with AxProgramWithSignature interface', () => {
      const flow = new AxFlow()

      // Should have all required methods from AxProgramWithSignature
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

      const flow = new AxFlow<{ input: string }, { result: string }>()
        .node('processor', { 'inputText:string': { outputResult: f.string() } })
        .execute('processor', (state) => ({ inputText: state.input }))
        .map((state) => ({ result: state.processorResult.outputResult }))

      const options = { debug: true, maxRetries: 3 }
      const result = await flow.forward(
        optionsMockAI,
        { input: 'test' },
        options
      )

      expect(result.result).toBe('test result')
    })
  })

  describe('error handling', () => {
    it('should handle execution errors gracefully', async () => {
      const flow = new AxFlow()
        .node('processor', { 'inputText:string': { outputResult: f.string() } })
        .execute('processor', (state) => ({ inputText: state.input }))

      // Mock AI service that throws an error
      const errorAI = new AxMockAIService()
      vi.spyOn(errorAI, 'chat').mockRejectedValue(new Error('AI service error'))

      await expect(flow.forward(errorAI, { input: 'test' })).rejects.toThrow()
    })

    it('should validate node existence before execution', () => {
      const flow = new AxFlow()

      expect(() => {
        flow.execute('nonexistent', (state) => state)
      }).toThrow("Node 'nonexistent' not found")
    })
  })
})
