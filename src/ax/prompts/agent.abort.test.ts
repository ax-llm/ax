import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import {
  AxAIServiceAbortedError,
  AxAIServiceStatusError,
} from '../util/apicall.js';

import { AxAgent } from './agent.js';

describe('AxAgent.stop()', () => {
  it('throws when stop() is called during multi-step loop', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        callCount++;
        return {
          results: [
            {
              index: 0,
              content: '',
              functionCalls: [
                {
                  id: `call_${callCount}`,
                  type: 'function' as const,
                  function: {
                    name: 'myFunc',
                    params: { userInput: `step ${callCount}` },
                  },
                },
              ],
              finishReason: 'function_call',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        };
      },
    });

    const myAgent = new AxAgent(
      {
        name: 'testAgent',
        description:
          'A test agent that processes inputs for testing abort functionality',
        signature: 'userQuery:string -> answer:string',
        functions: [
          {
            name: 'myFunc',
            description: 'A test function that does nothing special',
            parameters: {
              type: 'object',
              properties: { userInput: { type: 'string' } },
            },
            func: async () => {
              if (callCount === 1) {
                myAgent.stop();
              }
              return 'func result';
            },
          },
        ],
      },
      { maxSteps: 10 }
    );

    await expect(myAgent.forward(ai, { userQuery: 'test' })).rejects.toThrow();
  });

  it('throws when external abort signal is triggered', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        callCount++;
        if (callCount === 1) {
          controller.abort('external abort');
        }
        return {
          results: [
            {
              index: 0,
              content: '',
              functionCalls: [
                {
                  id: `call_${callCount}`,
                  type: 'function' as const,
                  function: {
                    name: 'myFunc',
                    params: { userInput: 'data' },
                  },
                },
              ],
              finishReason: 'function_call',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        };
      },
    });

    const myAgent = new AxAgent(
      {
        name: 'testAgent',
        description:
          'A test agent that processes inputs for testing abort functionality',
        signature: 'userQuery:string -> answer:string',
        functions: [
          {
            name: 'myFunc',
            description: 'A test function that does nothing special',
            parameters: {
              type: 'object',
              properties: { userInput: { type: 'string' } },
            },
            func: async () => 'result',
          },
        ],
      },
      { maxSteps: 10 }
    );

    await expect(
      myAgent.forward(
        ai,
        { userQuery: 'test' },
        {
          abortSignal: controller.signal,
        }
      )
    ).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it('throws when stop() is called before forward()', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });

    const myAgent = new AxAgent(
      {
        name: 'testAgent',
        description:
          'A test agent that processes inputs for testing abort functionality',
        signature: 'userQuery:string -> answer:string',
      },
      { maxSteps: 10 }
    );

    // Call stop before forward
    myAgent.stop();

    await expect(myAgent.forward(ai, { userQuery: 'test' })).rejects.toThrow();
  });

  it('propagates abortSignal to function handler extra parameter', async () => {
    let receivedSignal: AbortSignal | undefined;
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: '',
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'myTool',
                      params: { data: 'test data' },
                    },
                  },
                ],
                finishReason: 'function_call',
              },
            ],
            modelUsage: {
              ai: 'mock',
              model: 'mock',
              tokens: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            },
          };
        }
        return {
          results: [
            {
              index: 0,
              content: 'answer: done',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        };
      },
    });

    const myAgent = new AxAgent(
      {
        name: 'testAgent',
        description:
          'A test agent that verifies abort signal propagation to functions',
        signature: 'userQuery:string -> answer:string',
        functions: [
          {
            name: 'myTool',
            description: 'A tool that captures the abort signal from extra',
            parameters: {
              type: 'object',
              properties: { data: { type: 'string', description: 'data' } },
            },
            func: async (_args: any, extra: any) => {
              receivedSignal = extra?.abortSignal;
              return 'tool result';
            },
          },
        ],
      },
      { maxSteps: 5 }
    );

    const controller = new AbortController();
    await myAgent
      .forward(ai, { userQuery: 'test' }, { abortSignal: controller.signal })
      .catch(() => {
        /* may fail due to mock, that's ok */
      });

    // The function handler should have received an abort signal
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts during retry backoff when stop() is called', async () => {
    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async (): Promise<AxChatResponse> => {
        throw new AxAIServiceStatusError(
          503,
          'Service Unavailable',
          'https://api.example.com/chat',
          { test: 'request' },
          { error: 'service_unavailable' }
        );
      },
    });

    const myAgent = new AxAgent(
      {
        name: 'testAgent',
        description:
          'A test agent that verifies stop aborts retry backoff execution',
        signature: 'userQuery:string -> answer:string',
      },
      { maxRetries: 5 }
    );

    const pending = myAgent.forward(ai, { userQuery: 'test' });

    // Let the retry path begin, then stop via internal controller.
    await Promise.resolve();
    await Promise.resolve();
    myAgent.stop();

    await expect(pending).rejects.toBeInstanceOf(AxAIServiceAbortedError);
  });
});
