import { describe, expect, it } from 'vitest'

import type { AxFunction } from '../ai/types.js'

import { AxFunctionProcessor } from './functions.js'

describe('AxFunctionProcessor undefined/null handling', () => {
  it('should convert undefined return value to empty string', async () => {
    const undefinedFunction: AxFunction = {
      name: 'undefinedFunction',
      description: 'A function that returns undefined',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return undefined
      },
    }

    const processor = new AxFunctionProcessor([undefinedFunction])

    const result = await processor.execute({
      id: 'test_id',
      name: 'undefinedFunction',
      args: '{"input": "test"}',
    })

    expect(result).toBe('')
  })

  it('should convert null return value to empty string', async () => {
    const nullFunction: AxFunction = {
      name: 'nullFunction',
      description: 'A function that returns null',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return null
      },
    }

    const processor = new AxFunctionProcessor([nullFunction])

    const result = await processor.execute({
      id: 'test_id',
      name: 'nullFunction',
      args: '{"input": "test"}',
    })

    expect(result).toBe('')
  })

  it('should preserve string return values', async () => {
    const stringFunction: AxFunction = {
      name: 'stringFunction',
      description: 'A function that returns a string',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return 'test result'
      },
    }

    const processor = new AxFunctionProcessor([stringFunction])

    const result = await processor.execute({
      id: 'test_id',
      name: 'stringFunction',
      args: '{"input": "test"}',
    })

    expect(result).toBe('test result')
  })

  it('should convert object return values to JSON string', async () => {
    const objectFunction: AxFunction = {
      name: 'objectFunction',
      description: 'A function that returns an object',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return { success: true, data: 'test' }
      },
    }

    const processor = new AxFunctionProcessor([objectFunction])

    const result = await processor.execute({
      id: 'test_id',
      name: 'objectFunction',
      args: '{"input": "test"}',
    })

    expect(result).toBe('{\n  "success": true,\n  "data": "test"\n}')
  })

  it('should handle functions with no parameters returning undefined', async () => {
    const noParamsFunction: AxFunction = {
      name: 'noParamsFunction',
      description: 'A function with no parameters that returns undefined',
      func: async () => {
        return undefined
      },
    }

    const processor = new AxFunctionProcessor([noParamsFunction])

    const result = await processor.execute({
      id: 'test_id',
      name: 'noParamsFunction',
      args: '',
    })

    expect(result).toBe('')
  })

  it('should handle functions with no parameters returning null', async () => {
    const noParamsFunction: AxFunction = {
      name: 'noParamsFunction',
      description: 'A function with no parameters that returns null',
      func: async () => {
        return null
      },
    }

    const processor = new AxFunctionProcessor([noParamsFunction])

    const result = await processor.execute({
      id: 'test_id',
      name: 'noParamsFunction',
      args: '',
    })

    expect(result).toBe('')
  })
})
