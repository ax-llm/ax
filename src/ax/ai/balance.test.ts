import { describe, expect, test } from 'vitest';

import {
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
} from '../util/apicall.js';

import { AxBalancer } from './balance.js';
import { AxMockAIService, type AxMockAIServiceConfig } from './mock/api.js';
import type { AxAIService } from './types.js';

const createMockService = ({
  name = 'test-service',
  latencyMs = 100,
  chatResponse = async () => ({
    results: [
      {
        index: 0,
        content: 'test response',
        finishReason: 'stop' as const,
      },
    ],
    modelUsage: {
      ai: 'test-ai',
      model: 'test-model',
      tokens: {
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      },
    },
  }),
}: {
  name?: string;
  latencyMs?: number;
  chatResponse?: AxMockAIServiceConfig['chatResponse'];
} = {}) => {
  return new AxMockAIService({
    name,
    modelInfo: {
      name: 'test-model',
      provider: 'test-provider',
      promptTokenCostPer1M: 200,
      completionTokenCostPer1M: 150,
    },
    features: {
      functions: true,
      streaming: true,
    },
    chatResponse,
    latencyMs,
  });
};

describe('AxBalancer Interface Compatibility', () => {
  test('should implement all AxAIService methods', () => {
    const service1 = createMockService({ name: 'service1' });
    const service2 = createMockService({ name: 'service2' });
    const balancer = new AxBalancer([service1, service2]);

    // Test that all required AxAIService methods exist
    expect(typeof balancer.getId).toBe('function');
    expect(typeof balancer.getName).toBe('function');
    expect(typeof balancer.getFeatures).toBe('function');
    expect(typeof balancer.getModelList).toBe('function');
    expect(typeof balancer.getMetrics).toBe('function');
    expect(typeof balancer.getLogger).toBe('function');

    expect(typeof balancer.getLastUsedChatModel).toBe('function');
    expect(typeof balancer.getLastUsedEmbedModel).toBe('function');
    expect(typeof balancer.getLastUsedModelConfig).toBe('function');

    expect(typeof balancer.chat).toBe('function');
    expect(typeof balancer.embed).toBe('function');

    expect(typeof balancer.setOptions).toBe('function');
    expect(typeof balancer.getOptions).toBe('function');
  });

  test('should be assignable to AxAIService interface', () => {
    const service1 = createMockService({ name: 'service1' });
    const service2 = createMockService({ name: 'service2' });
    const balancer = new AxBalancer([service1, service2]);

    // This should compile without errors - proves interface compatibility
    const service: AxAIService = balancer;
    expect(service).toBeDefined();
  });

  test('should properly delegate getLastUsedChatModel return type', () => {
    const service1 = createMockService({ name: 'service1' });
    const service2 = createMockService({ name: 'service2' });
    const balancer = new AxBalancer([service1, service2]);

    // The method should exist and return the expected type
    const result = balancer.getLastUsedChatModel();

    // Mock service returns a default value, but the important thing is that it doesn't throw a type error
    expect(typeof result).toBe('string');
  });

  test('should properly delegate getLastUsedEmbedModel return type', () => {
    const service1 = createMockService({ name: 'service1' });
    const service2 = createMockService({ name: 'service2' });
    const balancer = new AxBalancer([service1, service2]);

    const result = balancer.getLastUsedEmbedModel();
    expect(typeof result).toBe('string');
  });

  test('should properly delegate getLastUsedModelConfig return type', () => {
    const service1 = createMockService({ name: 'service1' });
    const service2 = createMockService({ name: 'service2' });
    const balancer = new AxBalancer([service1, service2]);

    const result = balancer.getLastUsedModelConfig();
    expect(typeof result).toBe('object');
  });
});

describe('AxBalancer', () => {
  test('first service works', async () => {
    let calledService: number | undefined;
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        chatResponse: async () => {
          calledService = 0;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
      createMockService({
        name: 'service-1',
        latencyMs: 200, // Changed: Made service-1 slower
        chatResponse: async () => {
          calledService = 1;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
    ];

    const balancer = new AxBalancer(services);
    await balancer.chat({
      chatPrompt: [{ role: 'user', content: 'test' }],
      model: 'mock',
    });

    expect(calledService).toBe(0); // Changed: Now expecting service-0 to be called
  });

  test('first service fails', async () => {
    let calledService: number | undefined;
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        latencyMs: 200,
        chatResponse: async () => {
          calledService = 0;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
      createMockService({
        name: 'service-1',
        chatResponse: async () => {
          throw new AxAIServiceNetworkError(
            new Error('test'),
            'test-url',
            {},
            {}
          );
        },
      }),
    ];

    const balancer = new AxBalancer(services, { debug: false });
    await balancer.chat({
      chatPrompt: [{ role: 'user', content: 'test' }],
      model: 'mock',
    });

    expect(calledService).toBe(0);
  });

  test('first service works comparator', async () => {
    let calledService: number | undefined;
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        latencyMs: 200,
        chatResponse: async () => {
          calledService = 0;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
      createMockService({
        name: 'service-1',
        chatResponse: async () => {
          calledService = 1;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
    ];

    const balancer = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
    });

    await balancer.chat({
      chatPrompt: [{ role: 'user', content: 'test' }],
      model: 'mock',
    });

    expect(calledService).toBe(0);
  });

  test('first service fails comparator', async () => {
    let calledService: number | undefined;
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        latencyMs: 200,
        chatResponse: async () => {
          throw new AxAIServiceNetworkError(
            new Error('test'),
            'test-url',
            {},
            {}
          );
        },
      }),
      createMockService({
        name: 'service-1',
        chatResponse: async () => {
          calledService = 1;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
    ];

    const balancer = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
    });

    await balancer.chat({
      chatPrompt: [{ role: 'user', content: 'test' }],
      model: 'mock',
    });

    expect(calledService).toBe(1);
  });

  test('fails over to next service on a 529 overloaded status', async () => {
    let calledService: number | undefined;
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        latencyMs: 200,
        chatResponse: async () => {
          throw new AxAIServiceStatusError(
            529,
            'overloaded_error',
            'test-url',
            {},
            {}
          );
        },
      }),
      createMockService({
        name: 'service-1',
        chatResponse: async () => {
          calledService = 1;
          return {
            results: [
              {
                index: 0,
                content: 'test response',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 10,
                totalTokens: 30,
              },
            },
          };
        },
      }),
    ];

    const balancer = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
    });

    const res = await balancer.chat({
      chatPrompt: [{ role: 'user', content: 'test' }],
      model: 'mock',
    });

    expect(calledService).toBe(1);
    expect('results' in res && res.results[0]?.content).toBe('test response');
  });

  test('fails over on a streaming 529 thrown while reading the stream', async () => {
    let calledService: number | undefined;
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        // Resolves with a stream (HTTP-200), then errors on the first read — the shape of
        // Anthropic's streaming overloaded_error. The balancer must peek this and fail over.
        chatResponse: async () =>
          new ReadableStream({
            pull(controller) {
              controller.error(
                new AxAIServiceStatusError(
                  529,
                  'overloaded_error',
                  'test-url',
                  {},
                  {}
                )
              );
            },
          }),
      }),
      createMockService({
        name: 'service-1',
        chatResponse: async () => {
          calledService = 1;
          return new ReadableStream({
            start(controller) {
              controller.enqueue({
                results: [
                  {
                    index: 0,
                    content: 'streamed fallback',
                    finishReason: 'stop' as const,
                  },
                ],
                modelUsage: {
                  ai: 'test-ai',
                  model: 'test-model',
                  tokens: {
                    promptTokens: 20,
                    completionTokens: 10,
                    totalTokens: 30,
                  },
                },
              });
              controller.close();
            },
          });
        },
      }),
    ];

    const balancer = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
    });

    const res = await balancer.chat(
      { chatPrompt: [{ role: 'user', content: 'test' }], model: 'mock' },
      { stream: true }
    );

    let content = '';
    const reader = (res as ReadableStream<any>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      content += value.results?.[0]?.content ?? '';
    }

    expect(calledService).toBe(1);
    expect(content).toBe('streamed fallback');
  });

  test('records a mid-stream failure so the next call backs off the failed service', async () => {
    let calledService1 = false;
    const streamingChunk = {
      results: [
        { index: 0, content: 'partial', finishReason: 'stop' as const },
      ],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
      },
    };
    const services: AxAIService[] = [
      createMockService({
        name: 'service-0',
        // Emits one good chunk, then errors mid-stream — too late to fail over transparently
        // (partial output is committed), but the failure must still be recorded for backoff.
        chatResponse: async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(streamingChunk);
            },
            pull(controller) {
              controller.error(
                new AxAIServiceStatusError(
                  529,
                  'overloaded_error',
                  'test-url',
                  {},
                  {}
                )
              );
            },
          }),
      }),
      createMockService({
        name: 'service-1',
        chatResponse: async () => {
          calledService1 = true;
          return new ReadableStream({
            start(controller) {
              controller.enqueue({ ...streamingChunk });
              controller.close();
            },
          });
        },
      }),
    ];

    const balancer = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
    });

    // First call: stream from service-0 delivers one chunk then throws mid-stream.
    const res1 = (await balancer.chat(
      { chatPrompt: [{ role: 'user', content: 'test' }], model: 'mock' },
      { stream: true }
    )) as ReadableStream<any>;
    let firstContent = '';
    let midStreamError: unknown;
    const reader1 = res1.getReader();
    try {
      while (true) {
        const { done, value } = await reader1.read();
        if (done) break;
        firstContent += value.results?.[0]?.content ?? '';
      }
    } catch (e) {
      midStreamError = e;
    }
    expect(firstContent).toBe('partial');
    expect(midStreamError).toBeInstanceOf(AxAIServiceStatusError);
    expect(calledService1).toBe(false);

    // Second call: service-0 is now in backoff, so the balancer must route to service-1.
    const res2 = (await balancer.chat(
      { chatPrompt: [{ role: 'user', content: 'test' }], model: 'mock' },
      { stream: true }
    )) as ReadableStream<any>;
    let secondContent = '';
    const reader2 = res2.getReader();
    while (true) {
      const { done, value } = await reader2.read();
      if (done) break;
      secondContent += value.results?.[0]?.content ?? '';
    }
    expect(calledService1).toBe(true);
    expect(secondContent).toBe('partial');
  });
});
