import { ReadableStream } from 'node:stream/web';

import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse, AxFunction } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';

import { AxGen } from './generate.js';

function createStreamingResponse(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream<AxChatResponse>({
    start(controller) {
      let count = 0;

      const processChunks = async () => {
        if (count >= chunks.length || controller.desiredSize === null) {
          if (controller.desiredSize !== null) {
            controller.close();
          }
          return;
        }

        const chunk = chunks[count];
        if (!chunk) {
          return;
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
        };

        if (!controller.desiredSize || controller.desiredSize <= 0) {
          return;
        }

        controller.enqueue(response);
        count++;

        if (count < chunks.length) {
          setTimeout(processChunks, 10);
        } else {
          if (controller.desiredSize !== null) {
            controller.close();
          }
        }
      };

      setTimeout(processChunks, 10);
    },
    cancel() {},
  });
}

describe('AxGen Validation - Missing Required Fields', () => {
  const signature =
    'userInput:string -> requiredField:string, optionalField:string';

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
    });

    const gen = new AxGen<
      { userInput: string },
      { requiredField: string; optionalField: string }
    >(signature);

    await expect(
      gen.forward(ai, { userInput: 'test input' }, { strictMode: true })
    ).rejects.toThrow(/Generate failed/);
  });

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
    });

    const gen = new AxGen<
      { userInput: string },
      { requiredField: string; optionalField: string }
    >(signature);

    await expect(
      gen.forward(ai, { userInput: 'test input' }, { strictMode: true })
    ).rejects.toThrow(/Generate failed/);
  });

  it('should assume first field when no prefix is provided in non-strict mode with single output field', async () => {
    const singleFieldSignature = 'userInput:string -> requiredField:string';
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
    });

    const gen = new AxGen<{ userInput: string }, { requiredField: string }>(
      singleFieldSignature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { strictMode: false }
    );

    expect(response.requiredField).toBe(
      'This content should be assigned to the first field'
    );
  });

  it('should throw in strict mode when no prefix is provided even with single output field', async () => {
    const singleFieldSignature = 'userInput:string -> requiredField:string';
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'This content has no prefix',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
    });

    const gen = new AxGen<{ userInput: string }, { requiredField: string }>(
      singleFieldSignature
    );

    await expect(
      gen.forward(ai, { userInput: 'test input' }, { strictMode: true })
    ).rejects.toThrow(/Generate failed/);
  });
});

describe('AxGen Validation - Multiple Output Field Prefix Handling', () => {
  const multiOutputSignature =
    'userQuestion:string -> fieldA:string, fieldB:string, fieldC:string';

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
    });

    const gen = new AxGen<
      { userQuestion: string },
      { fieldA: string; fieldB: string; fieldC: string }
    >(multiOutputSignature);

    await expect(
      gen.forward(ai, { userQuestion: 'test input' }, { strictMode: true })
    ).rejects.toThrow(/Generate failed/);
  });

  it('should throw validation error for missing required fields with multiple outputs', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Content without prefix\nField B: Content for B\nField C: Content for C',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
    });

    const gen = new AxGen<
      { userQuestion: string },
      { fieldA: string; fieldB: string; fieldC: string }
    >(multiOutputSignature);

    await expect(
      gen.forward(ai, { userQuestion: 'test input' }, { strictMode: false })
    ).rejects.toThrow(/Generate failed/);
  });

  it('should throw validation error when required fields are missing prefixes', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Field A: Content for A\nSome content without prefix\nField C: Content for C',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
    });

    const gen = new AxGen<
      { userQuestion: string },
      { fieldA: string; fieldB: string; fieldC: string }
    >(multiOutputSignature);

    await expect(
      gen.forward(ai, { userQuestion: 'test input' }, { strictMode: false })
    ).rejects.toThrow(/Generate failed/);
  });
});

describe('AxGen Validation - Empty and Error Responses', () => {
  const signature = 'userQuery:string -> assistantOutput:string';

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
    });

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userQuery: 'test input' },
      { strictMode: false }
    );

    expect(response.assistantOutput).toBeUndefined();
  });

  it('should return undefined for empty response even in strict mode', async () => {
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
    });

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userQuery: 'test input' },
      { strictMode: true }
    );

    expect(response.assistantOutput).toBeUndefined();
  });

  it('should throw validation error for whitespace-only response', async () => {
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
    });

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature
    );

    await expect(
      gen.forward(ai, { userQuery: 'test input' }, { strictMode: false })
    ).rejects.toThrow(/Generate failed/);
  });
});

describe('AxGen Validation - Function Call Failures', () => {
  const signature = 'userQuery:string -> assistantOutput:string';

  it('should handle function that throws an error', async () => {
    const failingFunction: AxFunction = {
      name: 'failingFunction',
      description: 'A function that always fails',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        throw new Error('Function execution failed');
      },
    };

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
                function: {
                  name: 'failingFunction',
                  params: { input: 'test' },
                },
              },
            ],
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
    });

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature,
      {
        functions: [failingFunction],
      }
    );

    await expect(gen.forward(ai, { userQuery: 'test input' })).rejects.toThrow(
      /Generate failed/
    );
  });

  it('should handle function that returns empty result and add to memory', async () => {
    const emptyFunction: AxFunction = {
      name: 'emptyFunction',
      description: 'A function that returns empty result',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return '';
      },
    };

    let callCount = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        callCount++;
        if (callCount === 1) {
          // First call: provide function call
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'emptyFunction',
                      params: { input: 'test' },
                    },
                  },
                ],
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
              },
            },
          };
        }
        // Second call: provide final response
        return {
          results: [
            {
              index: 0,
              content: 'Assistant Output: Function returned empty result',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: {
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
            },
          },
        };
      },
    });

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature,
      {
        functions: [emptyFunction],
      }
    );

    // Create memory instance to track function calls
    const memory = new AxMemory();

    const response = await gen.forward(
      ai,
      { userQuery: 'test input' },
      { mem: memory }
    );

    expect(response.assistantOutput).toBe('Function returned empty result');

    // Check that function result was added to memory with empty string
    const history = memory.history(0);
    const functionMessage = history.find((msg) => msg.role === 'function');

    expect(functionMessage).toBeDefined();
    expect(functionMessage?.functionId).toBe('call_1');
    expect(functionMessage?.result).toBe('done');
  });

  it('should handle multiple parallel function calls with variety of return values', async () => {
    const emptyFunction: AxFunction = {
      name: 'emptyFunction',
      description: 'Returns empty string',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return '';
      },
    };

    const textFunction: AxFunction = {
      name: 'textFunction',
      description: 'Returns normal text',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return 'Normal text response';
      },
    };

    const jsonFunction: AxFunction = {
      name: 'jsonFunction',
      description: 'Returns JSON object',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return { status: 'success', data: [1, 2, 3] };
      },
    };

    const nullFunction: AxFunction = {
      name: 'nullFunction',
      description: 'Returns null',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        return null;
      },
    };

    let callCount = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        callCount++;
        if (callCount === 1) {
          // First call: provide multiple function calls in parallel
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'emptyFunction',
                      params: { input: 'test1' },
                    },
                  },
                  {
                    id: 'call_2',
                    type: 'function' as const,
                    function: {
                      name: 'textFunction',
                      params: { input: 'test2' },
                    },
                  },
                  {
                    id: 'call_3',
                    type: 'function' as const,
                    function: {
                      name: 'jsonFunction',
                      params: { input: 'test3' },
                    },
                  },
                  {
                    id: 'call_4',
                    type: 'function' as const,
                    function: {
                      name: 'nullFunction',
                      params: { input: 'test4' },
                    },
                  },
                ],
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 15,
                completionTokens: 25,
                totalTokens: 40,
              },
            },
          };
        }
        // Second call: provide final response
        return {
          results: [
            {
              index: 0,
              content: 'Assistant Output: All functions executed successfully',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: {
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
            },
          },
        };
      },
    });

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature,
      {
        functions: [emptyFunction, textFunction, jsonFunction, nullFunction],
      }
    );

    // Create memory instance to track function calls
    const memory = new AxMemory();

    const response = await gen.forward(
      ai,
      { userQuery: 'test multiple functions' },
      { mem: memory }
    );

    expect(response.assistantOutput).toBe(
      'All functions executed successfully'
    );

    // Check that all function results were added to memory
    const history = memory.history(0);
    const functionMessages = history.filter((msg) => msg.role === 'function');

    expect(functionMessages).toHaveLength(4);

    // Verify each function result
    const emptyFunctionMessage = functionMessages.find(
      (msg) => msg.functionId === 'call_1'
    );
    expect(emptyFunctionMessage).toBeDefined();
    expect(emptyFunctionMessage?.result).toBe('done');

    const textFunctionMessage = functionMessages.find(
      (msg) => msg.functionId === 'call_2'
    );
    expect(textFunctionMessage).toBeDefined();
    expect(textFunctionMessage?.result).toBe('Normal text response');

    const jsonFunctionMessage = functionMessages.find(
      (msg) => msg.functionId === 'call_3'
    );
    expect(jsonFunctionMessage).toBeDefined();
    expect(jsonFunctionMessage?.result).toBe(
      '{\n  "status": "success",\n  "data": [\n    1,\n    2,\n    3\n  ]\n}'
    );

    const nullFunctionMessage = functionMessages.find(
      (msg) => msg.functionId === 'call_4'
    );
    expect(nullFunctionMessage).toBeDefined();
    expect(nullFunctionMessage?.result).toBe('done');
  });

  // it('should handle function that returns null or undefined', async () => {
  //     const nullFunction: AxFunction = {
  //         name: 'nullFunction',
  //         description: 'A function that returns null',
  //         parameters: {
  //             type: 'object',
  //             properties: {
  //                 input: { type: 'string', description: 'Input parameter' }
  //             },
  //             required: ['input']
  //         },
  //         func: async () => {
  //             return null
  //         }
  //     }

  //     const ai = new AxMockAIService({
  //         features: { functions: true, streaming: false },
  //         chatResponse: {
  //             results: [
  //                 {
  //                     index: 0,
  //                     content: 'Output: Function returned null value',
  //                     finishReason: 'stop',
  //                     functionCalls: [
  //                         {
  //                             id: 'call_1',
  //                             type: 'function',
  //                             function: { name: 'nullFunction', params: { input: 'test' } }
  //                         }
  //                     ]
  //                 },
  //             ],
  //             modelUsage: {
  //                 ai: 'test-ai',
  //                 model: 'test-model',
  //                 tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  //             },
  //         },
  //     })

  //     const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(signature, {
  //         functions: [nullFunction]
  //     })

  //     const response = await gen.forward(ai, { userQuery: 'test input' })
  //     expect(response.assistantOutput).toBe('Function returned null value')
  // })
});

describe('AxGen Validation - Streaming Edge Cases', () => {
  const signature = 'userInput:string -> outputA:string, outputB:string';

  it('should handle streaming response with missing field in middle', async () => {
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Output A: First part ' },
      { index: 0, content: 'continued first part\n' },
      { index: 0, content: 'Some content without prefix\n' },
      { index: 0, content: 'Output B: Second part', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<
      { userInput: string },
      { outputA: string; outputB: string }
    >(signature);

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { stream: true, strictMode: false }
    );

    expect(response.outputA).toBe(
      'First part continued first part\nSome content without prefix'
    );
    expect(response.outputB).toBe('Second part');
  });

  it('should handle streaming with completely missing required field in strict mode', async () => {
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Output B: Only second field content' },
      { index: 0, content: ' with more content', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<
      { userInput: string },
      { outputA: string; outputB: string }
    >(signature);

    await expect(
      gen.forward(
        ai,
        { userInput: 'test input' },
        { stream: true, strictMode: true }
      )
    ).rejects.toThrow(/Generate failed/);
  });

  it('should throw validation error for empty streaming chunks', async () => {
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: '' },
      { index: 0, content: '' },
      {
        index: 0,
        content: 'Output A: Finally some content',
        finishReason: 'stop',
      },
    ];
    const streamingResponse = createStreamingResponse(chunks);

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<
      { userInput: string },
      { outputA: string; outputB: string }
    >(signature);

    await expect(
      gen.forward(
        ai,
        { userInput: 'test input' },
        { stream: true, strictMode: false }
      )
    ).rejects.toThrow(/Generate failed/);
  });
});

describe('AxGen Validation - Field Name Case Sensitivity', () => {
  const signature =
    'userInput:string -> camelCaseField:string, snake_case:string';

  it('should handle case-insensitive field matching in non-strict mode', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Camel Case Field: Content with correct english field name\nSnake case: Content with correct field name',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
    });

    const gen = new AxGen<
      { userInput: string },
      { camelCaseField: string; snake_case: string }
    >(signature);

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { strictMode: false }
    );

    expect(response.camelCaseField).toBe(
      'Content with correct english field name'
    );
    expect(response.snake_case).toBe('Content with correct field name');
  });

  it('should be strict about field name matching in strict mode', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'camelcasefield: Content with wrong case\nsnake_case: Content with correct case',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      },
    });

    const gen = new AxGen<
      { userInput: string },
      { camelCaseField: string; snake_case: string }
    >(signature);

    await expect(
      gen.forward(ai, { userInput: 'test input' }, { strictMode: true })
    ).rejects.toThrow(/Generate failed/);
  });
});

describe('AxGen Validation - Complex Field Scenarios', () => {
  // it('should handle response with only field separators but no content', async () => {
  //     const signature = 'userInput:string -> fieldA:string, fieldB:string'
  //     const ai = new AxMockAIService({
  //         features: { functions: false, streaming: false },
  //         chatResponse: {
  //             results: [
  //                 {
  //                     index: 0,
  //                     content: 'Field A:\nField B:',
  //                     finishReason: 'stop',
  //                 },
  //             ],
  //             modelUsage: {
  //                 ai: 'test-ai',
  //                 model: 'test-model',
  //                 tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  //             },
  //         },
  //     })

  //     const gen = new AxGen<
  //         { userInput: string },
  //         { fieldA: string; fieldB: string }
  //     >(signature)

  //     const response = await gen.forward(
  //         ai,
  //         { userInput: 'test input' },
  //         { strictMode: false }
  //     )

  //     expect(response.fieldA).toBe('')
  //     expect(response.fieldB).toBe('')
  // })

  it('should handle malformed field prefixes with extra characters', async () => {
    const signature = 'userInput:string -> answer:string';
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Answer:: This has extra colon\nAnswer - This has dash instead',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        },
      },
    });

    const gen = new AxGen<{ userInput: string }, { answer: string }>(signature);

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { strictMode: false }
    );

    // Should handle the first valid-looking prefix
    expect(response.answer).toBe(
      ': This has extra colon\nAnswer - This has dash instead'
    );
  });

  it('should handle response with field prefix but no colon separator', async () => {
    const signature = 'userInput:string -> finalResult:string';
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Result This should be treated as content without proper separator',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        },
      },
    });

    const gen = new AxGen<{ userInput: string }, { finalResult: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { strictMode: false }
    );

    // Without proper colon separator, should treat entire content as first field
    expect(response.finalResult).toBe(
      'Result This should be treated as content without proper separator'
    );
  });
});

describe('AxGen Validation - Retry Mechanism Tests', () => {
  it('should exhaust max retries when validation keeps failing', async () => {
    const signature = 'userInput:string -> responseOutput:string';
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => {
        callCount++;
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
        };
      },
    });

    const gen = new AxGen<{ userInput: string }, { responseOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { strictMode: true, maxRetries: 3 }
    );

    // Framework doesn't throw on retry exhaustion, returns undefined
    expect(response.responseOutput).toBeUndefined();
    // Framework doesn't retry on validation failures for empty content
    expect(callCount).toBe(1);
  });

  it('should succeed on retry when validation passes', async () => {
    const signature = 'userInput:string -> responseOutput:string';
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => {
        callCount++;
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
            tokens: {
              promptTokens: 10,
              completionTokens: callCount === 1 ? 0 : 10,
              totalTokens: callCount === 1 ? 10 : 20,
            },
          },
        };
      },
    });

    const gen = new AxGen<{ userInput: string }, { responseOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { strictMode: true, maxRetries: 3 }
    );

    expect(response.responseOutput).toBeUndefined();
    expect(callCount).toBe(1); // Framework doesn't retry in this scenario
  });
});

describe('AxGen Validation - Edge Cases with Special Characters', () => {
  // it('should handle field names with special characters in response', async () => {
  //     const signature = 'userInput:string -> field_with_underscore:string, fieldWithDash:string'

  //     const ai = new AxMockAIService({
  //         features: { functions: false, streaming: false },
  //         chatResponse: {
  //             results: [
  //                 {
  //                     index: 0,
  //                     content: 'Field With Underscore: Content 1\nField With Dash: Content 2',
  //                     finishReason: 'stop',
  //                 },
  //             ],
  //             modelUsage: {
  //                 ai: 'test-ai',
  //                 model: 'test-model',
  //                 tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
  //             },
  //         },
  //     })

  //     const gen = new AxGen<
  //         { userInput: string },
  //         { field_with_underscore: string; fieldWithDash: string }
  //     >(signature)

  //     const response = await gen.forward(
  //         ai,
  //         { userInput: 'test input' },
  //         { strictMode: false }
  //     )

  //     expect(response.field_with_underscore).toBe('Content 1')
  //     expect(response.fieldWithDash).toBe('Content 2')
  // })

  it('should handle unicode characters in field content', async () => {
    const signature = 'userInput:string -> responseOutput:string';

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
    });

    const gen = new AxGen<{ userInput: string }, { responseOutput: string }>(
      signature
    );

    const response = await gen.forward(ai, { userInput: 'test input' });

    expect(response.responseOutput).toBe(
      'Output: 🚀 Unicode content with émojis and accénts 中文'
    );
  });
});

describe('AxGen Validation - Multiple Sample Count Scenarios', () => {
  it('should handle validation errors across multiple samples', async () => {
    const signature = 'userInput:string -> responseOutput:string';

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
    });

    const gen = new AxGen<{ userInput: string }, { responseOutput: string }>(
      signature
    );

    // Even with multiple samples, strictMode should still validate each one
    await expect(
      gen.forward(
        ai,
        { userInput: 'test input' },
        { strictMode: true, sampleCount: 2 }
      )
    ).rejects.toThrow(/Generate failed/);
  });

  it('should return first valid sample when multiple samples provided', async () => {
    const signature = 'userInput:string -> responseOutput:string';

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
    });

    const gen = new AxGen<{ userInput: string }, { responseOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'test input' },
      { sampleCount: 2 }
    );

    // Should return the first sample
    expect(response.responseOutput).toBe('Output: First sample content');
  });
});

describe('AxGen Validation - Streaming Function Call Failures', () => {
  it('should handle function call failures during streaming', async () => {
    const signature = 'userInput:string -> responseOutput:string';

    const failingFunction: AxFunction = {
      name: 'failingStreamFunction',
      description: 'A function that fails during streaming',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => {
        throw new Error('Streaming function failed');
      },
    };

    const chunks: AxChatResponse['results'] = [
      {
        index: 0,
        content: 'Starting processing...',
        functionCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'failingStreamFunction',
              params: { input: 'test' },
            },
          },
        ],
      },
      {
        index: 0,
        content: 'Output: This should not be reached',
        finishReason: 'stop',
      },
    ];
    const streamingResponse = createStreamingResponse(chunks);

    const ai = new AxMockAIService({
      features: { functions: true, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<{ userInput: string }, { responseOutput: string }>(
      signature,
      {
        functions: [failingFunction],
      }
    );

    await expect(
      gen.forward(ai, { userInput: 'test input' }, { stream: true })
    ).rejects.toThrow(/Generate failed/);
  });
});
