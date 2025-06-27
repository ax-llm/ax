import { ReadableStream } from 'stream/web'

import { describe, expect, it } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import type { AxChatResponse, AxFunction } from '../ai/types.js'

import { AxGen } from './generate.js'

function createStreamingResponse(
    chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
    return new ReadableStream<AxChatResponse>({
        start(controller) {
            let count = 0

            const processChunks = async () => {
                if (count >= chunks.length || controller.desiredSize === null) {
                    if (controller.desiredSize !== null) {
                        controller.close()
                    }
                    return
                }

                const chunk = chunks[count]
                if (!chunk) {
                    return
                }

                const response: AxChatResponse = {
                    results: [chunk],
                    modelUsage: {
                        ai: 'test-ai',
                        model: 'test-model',
                        tokens: {
                            promptTokens: 10 + count,
                            completionTokens: 5 + count,
                            totalTokens: 15 + 2 * count,
                        },
                    },
                }

                if (!controller.desiredSize || controller.desiredSize <= 0) {
                    return
                }

                controller.enqueue(response)
                count++

                if (count < chunks.length) {
                    setTimeout(processChunks, 10)
                } else {
                    if (controller.desiredSize !== null) {
                        controller.close()
                    }
                }
            }

            setTimeout(processChunks, 10)
        },
        cancel() { },
    })
}

describe('AxGen Validation - Missing Required Fields', () => {
    const signature = 'userInput:string -> requiredField:string, optionalField:string'

    it('should throw validation error when required field is completely missing in strict mode', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Optional Field: Some optional content',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { userInput: string },
            { requiredField: string; optionalField: string }
        >(signature)

        await expect(
            gen.forward(
                ai,
                { userInput: 'test input' },
                { strictMode: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })

    it('should handle missing first required field in strict mode', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Optional Field: Some content without first field',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { userInput: string },
            { requiredField: string; optionalField: string }
        >(signature)

        await expect(
            gen.forward(
                ai,
                { userInput: 'test input' },
                { strictMode: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })

    it('should assume first field when no prefix is provided in non-strict mode', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'This content should be assigned to the first field',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { userInput: string },
            { requiredField: string; optionalField: string }
        >(signature)

        const response = await gen.forward(
            ai,
            { userInput: 'test input' },
            { strictMode: false }
        )

        expect(response.requiredField).toBe('This content should be assigned to the first field')
        expect(response.optionalField).toBeUndefined()
    })
})

describe('AxGen Validation - Multiple Output Field Prefix Handling', () => {
    const multiOutputSignature = 'userQuestion:string -> fieldA:string, fieldB:string, fieldC:string'

    it('should handle missing first field prefix in multiple output scenario', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Field B: Content for B\nField C: Content for C',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { fieldA: string; fieldB: string; fieldC: string }
        >(multiOutputSignature)

        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { strictMode: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })

    it('should handle missing prefix in one output field by assuming it belongs to first field', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Content without prefix\nField B: Content for B\nField C: Content for C',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { fieldA: string; fieldB: string; fieldC: string }
        >(multiOutputSignature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.fieldA).toBe('Content without prefix')
        expect(response.fieldB).toBe('Content for B')
        expect(response.fieldC).toBe('Content for C')
    })

    it('should handle partial field prefixes correctly', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Field A: Content for A\nSome content without prefix\nField C: Content for C',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { fieldA: string; fieldB: string; fieldC: string }
        >(multiOutputSignature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.fieldA).toBe('Content for A')
        expect(response.fieldB).toBe('Some content without prefix')
        expect(response.fieldC).toBe('Content for C')
    })
})

describe('AxGen Validation - Empty and Error Responses', () => {
    const signature = 'userQuery:string -> assistantOutput:string'

    it('should handle completely empty response', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: '',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.output).toBe('')
    })

    it('should handle empty response in strict mode', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: '',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { strictMode: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })

    it('should handle whitespace-only response', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: '   \n\t  \n  ',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.output).toBe('   \n\t  \n  ')
    })
})

describe('AxGen Validation - Function Call Failures', () => {
    const signature = 'userQuery:string -> assistantOutput:string'

    it('should handle function that throws an error', async () => {
        const failingFunction: AxFunction = {
            name: 'failingFunction',
            description: 'A function that always fails',
            parameters: {
                type: 'object',
                properties: {
                    input: { type: 'string', description: 'Input parameter' }
                },
                required: ['input']
            },
            func: async () => {
                throw new Error('Function execution failed')
            }
        }

        const ai = new AxMockAIService({
            features: { functions: true, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Assistant Output: Function result processed',
                        finishReason: 'stop',
                        functionCalls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'failingFunction', params: { input: 'test' } }
                            }
                        ]
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(signature, {
            functions: [failingFunction]
        })

        await expect(
            gen.forward(ai, { userQuery: 'test input' })
        ).rejects.toThrow(/Generate failed/)
    })

    it('should handle function that returns empty result', async () => {
        const emptyFunction: AxFunction = {
            name: 'emptyFunction',
            description: 'A function that returns empty result',
            parameters: {
                type: 'object',
                properties: {
                    input: { type: 'string', description: 'Input parameter' }
                },
                required: ['input']
            },
            func: async () => {
                return ''
            }
        }

        const ai = new AxMockAIService({
            features: { functions: true, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Output: Function returned empty result',
                        finishReason: 'stop',
                        functionCalls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'emptyFunction', params: { input: 'test' } }
                            }
                        ]
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature, {
            functions: [emptyFunction]
        })

        const response = await gen.forward(ai, { input: 'test input' })
        expect(response.output).toBe('Function returned empty result')
    })

    it('should handle function that returns null or undefined', async () => {
        const nullFunction: AxFunction = {
            name: 'nullFunction',
            description: 'A function that returns null',
            parameters: {
                type: 'object',
                properties: {
                    input: { type: 'string', description: 'Input parameter' }
                },
                required: ['input']
            },
            func: async () => {
                return null
            }
        }

        const ai = new AxMockAIService({
            features: { functions: true, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Output: Function returned null value',
                        finishReason: 'stop',
                        functionCalls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'nullFunction', params: { input: 'test' } }
                            }
                        ]
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature, {
            functions: [nullFunction]
        })

        const response = await gen.forward(ai, { input: 'test input' })
        expect(response.output).toBe('Function returned null value')
    })
})

describe('AxGen Validation - Streaming Edge Cases', () => {
    const signature = 'input:string -> outputA:string, outputB:string'

    it('should handle streaming response with missing field in middle', async () => {
        const chunks: AxChatResponse['results'] = [
            { index: 0, content: 'Output A: First part ' },
            { index: 0, content: 'continued first part\n' },
            { index: 0, content: 'Some content without prefix\n' },
            { index: 0, content: 'Output B: Second part', finishReason: 'stop' },
        ]
        const streamingResponse = createStreamingResponse(chunks)

        const ai = new AxMockAIService({
            features: { functions: false, streaming: true },
            chatResponse: streamingResponse,
        })

        const gen = new AxGen<
            { input: string },
            { outputA: string; outputB: string }
        >(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { stream: true, strictMode: false }
        )

        expect(response.outputA).toBe('First part continued first part')
        expect(response.outputB).toBe('Some content without prefix\nSecond part')
    })

    it('should handle streaming with completely missing required field in strict mode', async () => {
        const chunks: AxChatResponse['results'] = [
            { index: 0, content: 'Output B: Only second field content' },
            { index: 0, content: ' with more content', finishReason: 'stop' },
        ]
        const streamingResponse = createStreamingResponse(chunks)

        const ai = new AxMockAIService({
            features: { functions: false, streaming: true },
            chatResponse: streamingResponse,
        })

        const gen = new AxGen<
            { input: string },
            { outputA: string; outputB: string }
        >(signature)

        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { stream: true, strictMode: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })

    it('should handle empty streaming chunks', async () => {
        const chunks: AxChatResponse['results'] = [
            { index: 0, content: '' },
            { index: 0, content: '' },
            { index: 0, content: 'Output A: Finally some content', finishReason: 'stop' },
        ]
        const streamingResponse = createStreamingResponse(chunks)

        const ai = new AxMockAIService({
            features: { functions: false, streaming: true },
            chatResponse: streamingResponse,
        })

        const gen = new AxGen<
            { input: string },
            { outputA: string; outputB: string }
        >(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { stream: true, strictMode: false }
        )

        expect(response.outputA).toBe('Finally some content')
        expect(response.outputB).toBeUndefined()
    })
})

describe('AxGen Validation - Field Name Case Sensitivity', () => {
    const signature = 'input:string -> CamelCase:string, snake_case:string'

    it('should handle case-insensitive field matching in non-strict mode', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'camelcase: Content with lowercase field name\nSNAKE_CASE: Content with uppercase field name',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { CamelCase: string; snake_case: string }
        >(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.CamelCase).toBe('Content with lowercase field name')
        expect(response.snake_case).toBe('Content with uppercase field name')
    })

    it('should be strict about field name matching in strict mode', async () => {
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'camelcase: Content with wrong case\nsnake_case: Content with correct case',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { CamelCase: string; snake_case: string }
        >(signature)

        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { strictMode: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })
})

describe('AxGen Validation - Complex Field Scenarios', () => {
    it('should handle response with only field separators but no content', async () => {
        const signature = 'input:string -> fieldA:string, fieldB:string'
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Field A:\nField B:',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { fieldA: string; fieldB: string }
        >(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.fieldA).toBe('')
        expect(response.fieldB).toBe('')
    })

    it('should handle malformed field prefixes with extra characters', async () => {
        const signature = 'input:string -> answer:string'
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Answer:: This has extra colon\nAnswer - This has dash instead',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { answer: string }>(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        // Should handle the first valid-looking prefix
        expect(response.answer).toBe('This has extra colon\nAnswer - This has dash instead')
    })

    it('should handle response with field prefix but no colon separator', async () => {
        const signature = 'input:string -> result:string'
        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Result This should be treated as content without proper separator',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { result: string }>(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        // Without proper colon separator, should treat entire content as first field
        expect(response.result).toBe('Result This should be treated as content without proper separator')
    })
})

describe('AxGen Validation - Retry Mechanism Tests', () => {
    it('should exhaust max retries when validation keeps failing', async () => {
        const signature = 'input:string -> output:string'
        let callCount = 0

        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: async () => {
                callCount++
                return {
                    results: [
                        {
                            index: 0,
                            content: '', // Always return empty content to trigger validation error
                            finishReason: 'stop' as const,
                        },
                    ],
                    modelUsage: {
                        ai: 'test-ai',
                        model: 'test-model',
                        tokens: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
                    },
                }
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { strictMode: true, maxRetries: 3 }
            )
        ).rejects.toThrow(/Generate failed/)

        // Should have retried 3 times (plus initial attempt = 4 total)
        expect(callCount).toBe(4)
    })

    it('should succeed on retry when validation passes', async () => {
        const signature = 'input:string -> output:string'
        let callCount = 0

        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: async () => {
                callCount++
                return {
                    results: [
                        {
                            index: 0,
                            content: callCount === 1 ? '' : 'Output: Success on retry',
                            finishReason: 'stop' as const,
                        },
                    ],
                    modelUsage: {
                        ai: 'test-ai',
                        model: 'test-model',
                        tokens: { promptTokens: 10, completionTokens: callCount === 1 ? 0 : 10, totalTokens: callCount === 1 ? 10 : 20 },
                    },
                }
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: true, maxRetries: 3 }
        )

        expect(response.output).toBe('Success on retry')
        expect(callCount).toBe(2) // First call failed, second succeeded
    })
})

describe('AxGen Validation - Edge Cases with Special Characters', () => {
    it('should handle field names with special characters in response', async () => {
        const signature = 'input:string -> field_with_underscore:string, field-with-dash:string'

        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Field With Underscore: Content 1\nField-With-Dash: Content 2',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
                },
            },
        })

        const gen = new AxGen<
            { input: string },
            { field_with_underscore: string; 'field-with-dash': string }
        >(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { strictMode: false }
        )

        expect(response.field_with_underscore).toBe('Content 1')
        expect(response['field-with-dash']).toBe('Content 2')
    })

    it('should handle unicode characters in field content', async () => {
        const signature = 'input:string -> output:string'

        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Output: 🚀 Unicode content with émojis and accénts 中文',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        const response = await gen.forward(ai, { input: 'test input' })

        expect(response.output).toBe('🚀 Unicode content with émojis and accénts 中文')
    })
})

describe('AxGen Validation - Multiple Sample Count Scenarios', () => {
    it('should handle validation errors across multiple samples', async () => {
        const signature = 'input:string -> output:string'

        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: '', // Sample 1 - empty
                        finishReason: 'stop',
                    },
                    {
                        index: 1,
                        content: 'Output: Valid content', // Sample 2 - valid
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        // Even with multiple samples, strictMode should still validate each one
        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { strictMode: true, sampleCount: 2 }
            )
        ).rejects.toThrow(/Generate failed/)
    })

    it('should return first valid sample when multiple samples provided', async () => {
        const signature = 'input:string -> output:string'

        const ai = new AxMockAIService({
            features: { functions: false, streaming: false },
            chatResponse: {
                results: [
                    {
                        index: 0,
                        content: 'Output: First sample content',
                        finishReason: 'stop',
                    },
                    {
                        index: 1,
                        content: 'Output: Second sample content',
                        finishReason: 'stop',
                    },
                ],
                modelUsage: {
                    ai: 'test-ai',
                    model: 'test-model',
                    tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
                },
            },
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature)

        const response = await gen.forward(
            ai,
            { input: 'test input' },
            { sampleCount: 2 }
        )

        // Should return the first sample
        expect(response.output).toBe('First sample content')
    })
})

describe('AxGen Validation - Streaming Function Call Failures', () => {
    it('should handle function call failures during streaming', async () => {
        const signature = 'input:string -> output:string'

        const failingFunction: AxFunction = {
            name: 'failingStreamFunction',
            description: 'A function that fails during streaming',
            parameters: {
                type: 'object',
                properties: {
                    input: { type: 'string', description: 'Input parameter' }
                },
                required: ['input']
            },
            func: async () => {
                throw new Error('Streaming function failed')
            }
        }

        const chunks: AxChatResponse['results'] = [
            {
                index: 0,
                content: 'Starting processing...',
                functionCalls: [
                    {
                        id: 'call_1',
                        type: 'function',
                        function: { name: 'failingStreamFunction', params: { input: 'test' } }
                    }
                ]
            },
            { index: 0, content: 'Output: This should not be reached', finishReason: 'stop' },
        ]
        const streamingResponse = createStreamingResponse(chunks)

        const ai = new AxMockAIService({
            features: { functions: true, streaming: true },
            chatResponse: streamingResponse,
        })

        const gen = new AxGen<{ input: string }, { output: string }>(signature, {
            functions: [failingFunction]
        })

        await expect(
            gen.forward(
                ai,
                { input: 'test input' },
                { stream: true }
            )
        ).rejects.toThrow(/Generate failed/)
    })
})