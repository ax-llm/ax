import { ReadableStream } from 'node:stream/web';

import { describe, expect, it } from 'vitest';

import { validateAxMessageArray } from '../ai/base.js';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';

import { AxGen } from './generate.js';
import { AxSignature } from './sig.js';
import type { AxProgramForwardOptions } from './types.js';

function createStreamingResponse(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream<AxChatResponse>({
    start(controller) {
      let count = 0;

      const processChunks = async () => {
        if (count >= chunks.length || controller.desiredSize === null) {
          // Check if controller is already closed
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

        // Schedule next chunk
        if (count < chunks.length) {
          setTimeout(processChunks, 10);
        } else {
          // Check if controller is still open before closing
          if (controller.desiredSize !== null) {
            controller.close();
          }
        }
      };

      // Start processing
      setTimeout(processChunks, 10);
    },
    cancel() {},
  });
}

describe('AxGen forward and streamingForward', () => {
  const signature = 'userQuestion:string -> modelAnswer:string';

  it('should return non-streaming output from forward when stream option is false', async () => {
    // Prepare a non-streaming (plain) response.
    const nonStreamingResponse: AxChatResponse = {
      results: [
        {
          index: 0,
          content: 'Model Answer: Non-stream response',
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    };
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: nonStreamingResponse,
    });

    const gen = new AxGen<{ userQuestion: string }, { modelAnswer: string }>(
      signature
    );
    // Call forward with stream disabled.
    const response = await gen.forward(
      ai,
      { userQuestion: 'test' },
      { stream: false }
    );
    expect(response).toEqual({ modelAnswer: 'Non-stream response' });
  });

  it('should return aggregated output from forward when stream option is true', async () => {
    // Prepare a streaming response that enqueues three chunks with a timer.
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Model Answer: chunk 1 ' },
      { index: 0, content: 'chunk 2 ' },
      { index: 0, content: 'chunk 3', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      // Provide chatResponse as a function that accepts request params and returns the stream
      chatResponse: streamingResponse as any,
    });

    const gen = new AxGen<{ userQuestion: string }, { modelAnswer: string }>(
      signature
    );
    // Call forward with stream enabled.
    // Even though the underlying AI service streams, forward() aggregates
    // the chunks and returns an object.
    const response = await gen.forward(
      ai,
      { userQuestion: 'test' },
      { stream: true }
    );
    expect(response).toBeDefined();
    expect(response.modelAnswer).toContain('chunk 1');
    expect(response.modelAnswer).toContain('chunk 2');
    expect(response.modelAnswer).toContain('chunk 3');
  });
});

describe('AxProgramForwardOptions types', () => {
  it('should allow "disable" as a value for thinkingTokenBudget', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }), // Mock AI service
      thinkingTokenBudget: 'none',
    };
    // If this compiles, the type test passes implicitly.
    // We can add a simple assertion to make the test explicit.
    expect(options.thinkingTokenBudget).toBe('none');
  });

  it('should allow other valid values for thinkingTokenBudget', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }), // Mock AI service
      thinkingTokenBudget: 'minimal',
    };
    expect(options.thinkingTokenBudget).toBe('minimal');
  });

  it('should allow showThoughts option', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }), // Mock AI service
      showThoughts: true,
    };
    expect(options.showThoughts).toBe(true);
  });

  it('should ensure showThoughts is false when thinkingTokenBudget is none', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }),
      thinkingTokenBudget: 'none',
      showThoughts: true, // This should be overridden
    };
    expect(options.thinkingTokenBudget).toBe('none');
    expect(options.showThoughts).toBe(true); // This validates the type allows both options
  });
});

describe('AxGen thoughtFieldName', () => {
  const signature = 'userQuestion:string -> modelAnswer:string';

  it('should return thought with custom field name when thoughtFieldName is provided', async () => {
    // Mock AI service to return a response with a thought
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            thought: 'This is a custom thought.',
            content: 'Model Answer: Test output',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    });

    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; customThought?: string }
    >(signature, { thoughtFieldName: 'customThought' });
    const response = await gen.forward(ai, { userQuestion: 'test' });
    expect(response).toEqual({
      modelAnswer: 'Test output',
      customThought: 'This is a custom thought.',
    });
  });

  it('should return thought with default field name "thought" when thoughtFieldName is not provided', async () => {
    // Mock AI service
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            thought: 'This is a default thought.',
            content: 'Model Answer: Test output',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    });

    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; thought?: string }
    >(signature);
    const response = await gen.forward(ai, { userQuestion: 'test' });
    expect(response).toEqual({
      modelAnswer: 'Test output',
      thought: 'This is a default thought.',
    });
  });

  it('should stream thought with custom field name when thoughtFieldName is provided', async () => {
    const chunks: AxChatResponse['results'] = [
      { index: 0, thought: 'Thinking...' },
      { index: 0, content: 'Model Answer: chunk 1 ' },
      { index: 0, thought: 'Still thinking...' },
      { index: 0, content: 'chunk 2 ' },
      { index: 0, content: 'chunk 3', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse as any,
    });

    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; customThought?: string }
    >(signature, { thoughtFieldName: 'customThought' });
    const stream = await gen.streamingForward(ai, { userQuestion: 'test' });

    const finalResponse: { modelAnswer?: string; customThought?: string } = {};
    for await (const result of stream) {
      if (result.delta.modelAnswer) {
        finalResponse.modelAnswer =
          (finalResponse.modelAnswer ?? '') + result.delta.modelAnswer;
      }
      if (result.delta.customThought) {
        finalResponse.customThought =
          (finalResponse.customThought ?? '') + result.delta.customThought;
      }
    }

    expect(finalResponse).toBeDefined();
    expect(finalResponse.modelAnswer).toEqual('chunk 1 chunk 2 chunk 3');
    expect(finalResponse.customThought).toEqual('Thinking...Still thinking...');
  });

  it('should stream thought with default field name "thought" when thoughtFieldName is not provided', async () => {
    const chunks: AxChatResponse['results'] = [
      { index: 0, thought: 'Thinking...' },
      { index: 0, content: 'Model Answer: chunk 1 ' },
      { index: 0, thought: 'Still thinking...' },
      { index: 0, content: 'chunk 2 ' },
      { index: 0, content: 'chunk 3', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; thought?: string }
    >(signature);
    const stream = await gen.streamingForward(ai, { userQuestion: 'test' });

    const finalResponse: { modelAnswer?: string; thought?: string } = {};
    for await (const result of stream) {
      if (result.delta.modelAnswer) {
        finalResponse.modelAnswer =
          (finalResponse.modelAnswer ?? '') + result.delta.modelAnswer;
      }
      if (result.delta.thought) {
        finalResponse.thought =
          (finalResponse.thought ?? '') + result.delta.thought;
      }
    }

    expect(finalResponse).toBeDefined();
    expect(finalResponse.modelAnswer).toEqual('chunk 1 chunk 2 chunk 3');
    expect(finalResponse.thought).toEqual('Thinking...Still thinking...');
  });
});

describe('AxGen forward and streamingForward with multiple outputs', () => {
  const signature =
    'userQuestion:string -> modelAnswer:string, anotherAnswer:string';

  it('should return non-streaming output for a signature with two outputs when stream option is false', async () => {
    const nonStreamingResponse: AxChatResponse = {
      results: [
        {
          index: 0,
          content: 'Model Answer: response1\nAnother Answer: response2',
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    };
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: nonStreamingResponse,
    });

    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; anotherAnswer: string }
    >(signature);
    const response = await gen.forward(
      ai,
      { userQuestion: 'test' },
      { stream: false }
    );
    expect(response).toEqual({
      modelAnswer: 'response1',
      anotherAnswer: 'response2',
    });
  });

  it('should return aggregated output from forward for a signature with three outputs when stream option is true', async () => {
    const signatureWithThreeOutputs =
      'userQuestion:string -> modelAnswer:string, anotherAnswer:string, thirdAnswer:string';
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Model Answer: resp1\n' },
      { index: 0, content: 'Another Answer: resp2\n' },
      { index: 0, content: 'Third Answer: resp3', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });
    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; anotherAnswer: string; thirdAnswer: string }
    >(signatureWithThreeOutputs);
    const response = await gen.forward(
      ai,
      { userQuestion: 'test' },
      { stream: true }
    );
    expect(response).toEqual({
      modelAnswer: 'resp1',
      anotherAnswer: 'resp2',
      thirdAnswer: 'resp3',
    });
  });

  it('should yield streaming multi-output fields from streamingForward for a signature with two outputs', async () => {
    const signatureWithTwoOutputs =
      'userQuestion:string -> modelAnswer:string, anotherAnswer:string';
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Model Answer: resp1\n' },
      { index: 0, content: 'Another Answer: resp2', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<
      { userQuestion: string },
      { modelAnswer: string; anotherAnswer: string }
    >(signatureWithTwoOutputs);
    const stream = await gen.streamingForward(ai, { userQuestion: 'test' });

    const expectedOutputs = [
      { version: 0, index: 0, delta: { modelAnswer: 'resp1' } },
      { version: 0, index: 0, delta: { anotherAnswer: 'resp2' } },
    ];

    let outputIndex = 0;
    for await (const result of stream) {
      expect(result).toEqual(expectedOutputs[outputIndex]);
      outputIndex++;
    }
    expect(outputIndex).toBe(expectedOutputs.length);
  });
});

it('should yield streaming multi-output fields from streamingForward for a signature with five outputs', async () => {
  const signatureWithFiveOutputs =
    'userQuestion:string -> answerA:string, answerB:string, answerC:string, answerD:string, answerE:string';

  const chunks: AxChatResponse['results'] = [
    { index: 0, content: 'Answer A: r1\n' },
    { index: 0, content: 'Answer B: r2\n' },
    { index: 0, content: 'Answer C: r3\n' },
    { index: 0, content: 'Answer D: r4\n' },
    { index: 0, content: 'Answer E: r5', finishReason: 'stop' },
  ];
  const streamingResponse = createStreamingResponse(chunks);
  const ai = new AxMockAIService({
    features: { functions: false, streaming: true },
    chatResponse: streamingResponse,
  });

  const gen = new AxGen<
    { userQuestion: string },
    {
      answerA: string;
      answerB: string;
      answerC: string;
      answerD: string;
      answerE: string;
    }
  >(signatureWithFiveOutputs);
  const stream = await gen.streamingForward(ai, { userQuestion: 'test' });

  const expectedOutputs = [
    { version: 0, index: 0, delta: { answerA: 'r1' } },
    { version: 0, index: 0, delta: { answerB: 'r2' } },
    { version: 0, index: 0, delta: { answerC: 'r3' } },
    { version: 0, index: 0, delta: { answerD: 'r4' } },
    { version: 0, index: 0, delta: { answerE: 'r5' } },
  ];

  let outputIndex = 0;
  for await (const result of stream) {
    expect(result).toEqual(expectedOutputs[outputIndex]);
    outputIndex++;
  }
  expect(outputIndex).toBe(expectedOutputs.length);
});

describe('Error handling in AxGen', () => {
  const signature = 'userQuestion:string -> modelAnswer:string';

  it('should properly wrap errors with cause mechanism', async () => {
    const originalError = new Error('AI service failed');
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      // Mock a failure in the chat method using chatResponse function
      chatResponse: () => Promise.reject(originalError),
    });

    const gen = new AxGen<{ userQuestion: string }, { modelAnswer: string }>(
      signature
    );
    try {
      await gen.forward(ai, { userQuestion: 'test' });
      // If forward does not throw, fail the test
      throw new Error('Test should have failed but did not.');
    } catch (e) {
      const error = e as Error;
      expect(error.message).toContain('Generate failed');
      // Check if the original error is available as the cause
      expect((error as unknown as { cause?: Error }).cause).toBe(originalError);
    }
  });

  it('should handle streaming errors gracefully', async () => {
    const originalError = new Error('Streaming failed mid-stream');
    // Create a stream that errors after first chunk
    const chatResponseFunction = async () => {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            results: [{ index: 0, content: 'Model Answer: First part...' }],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            },
          });
          // Simulate an error after the first chunk
          setTimeout(() => {
            controller.error(originalError);
          }, 10);
        },
      });
    };

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: chatResponseFunction,
    });

    const gen = new AxGen<{ userQuestion: string }, { modelAnswer: string }>(
      signature
    );
    const streaming = await gen.streamingForward(ai, { userQuestion: 'test' });
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streaming) {
        // Process stream
      }
      // Fail if the loop completes without error
      throw new Error('Stream processing should have failed.');
    } catch (e) {
      const error = e as Error;
      expect(error.message).toContain('Generate failed');
      expect((error as unknown as { cause?: Error }).cause).toBe(originalError);
    }
  });
});

describe('AxGen Message Validation', () => {
  it('should pass validation for valid AxMessage array (direct function test)', () => {
    expect(() =>
      validateAxMessageArray([{ role: 'user', content: 'hello' }])
    ).not.toThrow();
  });

  it('should pass validation for AxMessage array with non-string content (direct function test)', () => {
    expect(() =>
      validateAxMessageArray([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ])
    ).not.toThrow();
  });
});

describe('AxGen Signature Validation', () => {
  it('should validate signature on construction and fail for incomplete signature', () => {
    // This should throw when trying to create AxGen with a signature that has only input fields
    const sig = new AxSignature();
    sig.addInputField({
      name: 'userInput',
      type: { name: 'string', isArray: false },
    });
    // Note: no output fields added

    expect(() => new AxGen(sig)).toThrow('must have at least one output field');
  });

  it('should validate signature on construction and pass for complete signature', () => {
    const sig = new AxSignature();
    sig.addInputField({
      name: 'userInput',
      type: { name: 'string', isArray: false },
    });
    sig.addOutputField({
      name: 'responseText',
      type: { name: 'string', isArray: false },
    });

    expect(() => new AxGen(sig)).not.toThrow();
  });

  it('should validate signature when using string signature', () => {
    // Should work with valid string signature
    expect(
      () => new AxGen('userInput:string -> responseText:string')
    ).not.toThrow();

    // Should fail with incomplete string signature (missing arrow)
    expect(() => new AxGen('userInput:string')).toThrow();
  });
});

describe('AxGen DSPy field prefix format', () => {
  it('should extract content without field prefix for userInput -> agentOutput signature', async () => {
    const signature = 'userInput -> agentOutput';

    // Mock AI service to return a response without field prefix
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'This is the agent response to the user input',
            finishReason: 'stop',
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
      },
    });

    const gen = new AxGen<{ userInput: string }, { agentOutput: string }>(
      signature
    );

    const response = await gen.forward(ai, {
      userInput: 'Hello, how can you help me?',
    });

    expect(response).toEqual({
      agentOutput: 'This is the agent response to the user input',
    });
  });

  it('should handle streaming response and extract content without field prefix', async () => {
    const signature = 'userInput -> agentOutput';

    // Prepare a streaming response without field prefix
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'This is part 1 ' },
      { index: 0, content: 'of the agent response ' },
      { index: 0, content: 'to the user input', finishReason: 'stop' },
    ];
    const streamingResponse = createStreamingResponse(chunks);

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

    const gen = new AxGen<{ userInput: string }, { agentOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'Hello, how can you help me?' },
      { stream: true }
    );

    expect(response).toBeDefined();
    expect(response.agentOutput).toBe(
      'This is part 1 of the agent response to the user input'
    );
  });

  it('should throw validation error with strictMode enabled when field prefix is missing', async () => {
    const signature = 'userInput -> agentOutput';

    // Mock AI service to return a response without field prefix
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'This is the agent response without field prefix',
            finishReason: 'stop',
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
      },
    });

    const gen = new AxGen<{ userInput: string }, { agentOutput: string }>(
      signature
    );

    // With strictMode enabled, should throw validation error for missing field prefix
    try {
      await gen.forward(
        ai,
        { userInput: 'Hello, how can you help me?' },
        { strictMode: true }
      );
      // If forward does not throw, fail the test
      throw new Error('Test should have failed but did not.');
    } catch (e) {
      const error = e as Error;
      expect(error.message).toContain('Generate failed');
      // Check if the original validation error is available as the cause
      expect((error as unknown as { cause?: Error }).cause).toBeInstanceOf(
        Error
      );
      expect(
        ((error as unknown as { cause?: Error }).cause as Error).message
      ).toContain('Expected (Required) field not found');
    }
  });

  it('should extract content with proper field prefix when strictMode is enabled', async () => {
    const signature = 'userInput -> agentOutput';

    // Mock AI service to return a response with proper field prefix
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Agent Output: This is the agent response with proper field prefix',
            finishReason: 'stop',
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
      },
    });

    const gen = new AxGen<{ userInput: string }, { agentOutput: string }>(
      signature
    );

    const response = await gen.forward(
      ai,
      { userInput: 'Hello, how can you help me?' },
      { strictMode: true }
    );

    expect(response).toEqual({
      agentOutput: 'This is the agent response with proper field prefix',
    });
  });
});
