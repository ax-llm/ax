import { describe, expect, test, vi } from 'vitest';

import {
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
} from '../util/apicall.js';
import { AxBalancer } from './balance.js';
import {
  type AxBalancerRoutingEvent,
  type AxBalancerStatsKey,
  type AxBalancerStatsStore,
  AxInMemoryBalancerStatsStore,
  axUpdateBalancerRouteStats,
  createBalancerRouteStats,
  sampleBalancerRouteHealth,
} from './balance_adaptive.js';
import { AxMockAIService } from './mock/api.js';
import type { AxAIService, AxChatResponse, AxEmbedResponse } from './types.js';

const statsKey = (
  routeKey: string,
  slice = 'default',
  logicalModel = 'shared'
): AxBalancerStatsKey => ({
  namespace: 'test',
  slice,
  logicalModel,
  routeKey,
});

const response = (content = 'ok'): AxChatResponse => ({
  results: [{ index: 0, content, finishReason: 'stop' }],
  modelUsage: {
    ai: 'mock',
    model: 'mock-model',
    tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  },
});

const createService = ({
  name,
  onChat,
  structuredOutputs = true,
  onEmbed,
}: {
  name: string;
  onChat?: () => Promise<AxChatResponse | ReadableStream<AxChatResponse>>;
  structuredOutputs?: boolean;
  onEmbed?: () => AxEmbedResponse | Promise<AxEmbedResponse>;
}) =>
  new AxMockAIService<string>({
    id: `${name}-id`,
    name,
    models: [
      {
        key: 'shared',
        model: `${name}-model`,
        description: `${name} shared model`,
      },
    ],
    features: { streaming: true, structuredOutputs },
    chatResponse: onChat,
    embedResponse: onEmbed,
  });

const adaptiveOptions = (
  store?: AxBalancerStatsStore,
  onRoutingEvent?: (event: AxBalancerRoutingEvent) => void | Promise<void>
) => ({
  comparator: AxBalancer.inputOrderComparator,
  debug: false,
  strategy: {
    type: 'adaptive' as const,
    deadlineMs: 1_000,
    badOutcomeCost: 1,
    namespace: 'test',
    routeKey: (service: AxAIService, index: number) =>
      service.getName() || String(index),
    statsStore: store,
    onRoutingEvent,
  },
});

describe('adaptive balancer statistics', () => {
  test('updates failure EWMA and log-latency sufficient statistics', () => {
    const initial = createBalancerRouteStats();
    const failed = axUpdateBalancerRouteStats(initial, { outcome: 'failure' });
    expect(failed.observations).toBe(1);
    expect(failed.failureEwma).toBeCloseTo(0.24);

    const first = axUpdateBalancerRouteStats(failed, {
      outcome: 'success',
      latencyMs: 100,
    });
    const second = axUpdateBalancerRouteStats(first, {
      outcome: 'success',
      latencyMs: 400,
    });
    expect(second.observations).toBe(3);
    expect(second.successes).toBe(2);
    expect(Math.exp(second.logLatencyMean)).toBeCloseTo(200);
    expect(second.logLatencyM2).toBeGreaterThan(0);
  });

  test('keeps keys isolated and applies concurrent observations atomically', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    await Promise.all(
      Array.from({ length: 50 }, () =>
        store.observe(statsKey('route-a'), {
          outcome: 'success',
          latencyMs: 25,
        })
      )
    );
    await store.observe(statsKey('route-b', 'other'), { outcome: 'failure' });

    expect((await store.get(statsKey('route-a')))?.observations).toBe(50);
    expect((await store.get(statsKey('route-b', 'other')))?.observations).toBe(
      1
    );
    expect(await store.get(statsKey('route-b'))).toBeUndefined();
  });

  test('samples different cold-start deadline probabilities', () => {
    let seed = 17;
    const random = () => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const samples = Array.from({ length: 8 }, () =>
      sampleBalancerRouteHealth(undefined, 1_000, random)
    );

    expect(
      new Set(samples.map((sample) => sample.deadlineMissProbability)).size
    ).toBeGreaterThan(1);
    expect(
      samples.every(
        (sample) =>
          sample.deadlineMissProbability >= 0 &&
          sample.deadlineMissProbability <= 1
      )
    ).toBe(true);
  });
});

describe('AxBalancer adaptive routing', () => {
  test('validates shared-store route identities and strategy values', () => {
    const services = [
      createService({ name: 'one' }),
      createService({ name: 'two' }),
    ] as const;
    const store = new AxInMemoryBalancerStatsStore();

    expect(
      () =>
        new AxBalancer(services, {
          strategy: {
            type: 'adaptive',
            deadlineMs: 100,
            badOutcomeCost: 1,
            statsStore: store,
          },
        })
    ).toThrow(/routeKey is required/);
    expect(
      () =>
        new AxBalancer(services, {
          strategy: {
            type: 'adaptive',
            deadlineMs: 100,
            badOutcomeCost: 1,
            routeKey: () => 'duplicate',
            statsStore: store,
          },
        })
    ).toThrow(/must be unique/);
    expect(
      () =>
        new AxBalancer(services, {
          strategy: {
            type: 'adaptive',
            deadlineMs: 100,
            badOutcomeCost: 1,
            routeKey: () => '   ',
          },
        })
    ).toThrow(/non-empty/);
    expect(
      () =>
        new AxBalancer(services, {
          strategy: {
            type: 'adaptive',
            deadlineMs: 0,
            badOutcomeCost: 1,
          },
        })
    ).toThrow(/deadlineMs/);
    expect(
      () =>
        new AxBalancer(services, {
          strategy: {
            type: 'adaptive',
            deadlineMs: 100,
            badOutcomeCost: -1,
          },
        })
    ).toThrow(/badOutcomeCost/);
    expect(
      () =>
        new AxBalancer(services, {
          strategy: {
            type: 'adaptive',
            deadlineMs: 100,
            badOutcomeCost: 1,
            expectedTokens: { promptTokens: -1, completionTokens: 1 },
          },
        })
    ).toThrow(/expectedTokens.promptTokens/);
  });

  test('selects the lowest estimated-cost route and uses input order for ties', async () => {
    const calls: string[] = [];
    const services = [
      createService({
        name: 'first',
        onChat: async () => {
          calls.push('first');
          return response('first');
        },
      }),
      createService({
        name: 'second',
        onChat: async () => {
          calls.push('second');
          return response('second');
        },
      }),
    ] as const;
    const cheapest = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        estimateCost: ({ routeKey }) => (routeKey === 'second' ? 0.001 : 1),
        routeKey: (service) => service.getName(),
      },
    });
    await cheapest.chat({
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'secret' }],
    });
    expect(calls).toEqual(['second']);

    calls.length = 0;
    const tied = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        estimateCost: () => 0,
        routeKey: (service) => service.getName(),
      },
    });
    await tied.chat({
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'test' }],
    });
    expect(calls).toEqual(['first']);
  });

  test('uses expected tokens and each route concrete model for built-in pricing', async () => {
    const calls: string[] = [];
    const expensive = createService({
      name: 'expensive',
      onChat: async () => {
        calls.push('expensive');
        return response();
      },
    });
    const cheap = createService({
      name: 'cheap',
      onChat: async () => {
        calls.push('cheap');
        return response();
      },
    });
    const expensiveCost = vi
      .spyOn(expensive, 'getEstimatedCost')
      .mockReturnValue(0.1);
    const cheapCost = vi
      .spyOn(cheap, 'getEstimatedCost')
      .mockReturnValue(0.001);
    const balancer = new AxBalancer([expensive, cheap], {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        expectedTokens: { promptTokens: 1_200, completionTokens: 300 },
        routeKey: (service) => service.getName(),
      },
    });

    await balancer.chat({
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'test' }],
    });
    expect(calls).toEqual(['cheap']);
    expect(expensiveCost).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'expensive-model',
        tokens: {
          promptTokens: 1_200,
          completionTokens: 300,
          totalTokens: 1_500,
        },
      })
    );
    expect(cheapCost).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cheap-model' })
    );
  });

  test('treats unavailable pricing as zero and validates custom estimates', async () => {
    const service = createService({
      name: 'unpriced',
      onChat: async () => response(),
    });
    const getEstimatedCost = vi
      .spyOn(service, 'getEstimatedCost')
      .mockReturnValue(0);
    const unpriced = new AxBalancer([service], {
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        expectedTokens: { promptTokens: 100 },
      },
    });

    await expect(
      unpriced.chat({
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      })
    ).resolves.toMatchObject({ results: expect.any(Array) });
    expect(getEstimatedCost).toHaveReturnedWith(0);
    expect(getEstimatedCost).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: {
          promptTokens: 100,
          completionTokens: 0,
          totalTokens: 100,
        },
      })
    );

    const invalidEstimate = new AxBalancer([service], {
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        estimateCost: () => Number.NaN,
      },
    });
    await expect(
      invalidEstimate.chat({
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrow(/finite and non-negative/);
  });

  test('learns shared reliability by namespace, slice, model, and route', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    for (let index = 0; index < 20; index++) {
      await store.observe(statsKey('unreliable', 'summarize'), {
        outcome: 'failure',
      });
      await store.observe(statsKey('reliable', 'summarize'), {
        outcome: 'success',
        latencyMs: 10,
      });
    }

    const calls: string[] = [];
    const services = [
      createService({
        name: 'unreliable',
        onChat: async () => {
          calls.push('unreliable');
          return response();
        },
      }),
      createService({
        name: 'reliable',
        onChat: async () => {
          calls.push('reliable');
          return response();
        },
      }),
    ] as const;
    const balancer = new AxBalancer(services, {
      ...adaptiveOptions(store),
      strategy: {
        ...adaptiveOptions(store).strategy,
        deadlineMs: 1_000_000_000,
        slice: ({ options }) => options?.customLabels?.workflow ?? 'default',
        estimateCost: () => 0,
      },
    });

    await balancer.chat(
      {
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      },
      { customLabels: { workflow: 'summarize' } }
    );
    expect(calls).toEqual(['reliable']);
    expect(
      (await store.get(statsKey('reliable', 'summarize')))?.observations
    ).toBe(21);
    expect(await store.get(statsKey('reliable', 'extract'))).toBeUndefined();
    expect(
      await store.get(statsKey('reliable', 'summarize', 'other'))
    ).toBeUndefined();
  });

  test('ranks learned deadline risk independently of cost', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    for (let index = 0; index < 100; index++) {
      await store.observe(statsKey('slow'), {
        outcome: 'success',
        latencyMs: 10_000,
      });
      await store.observe(statsKey('fast'), {
        outcome: 'success',
        latencyMs: 10,
      });
    }

    const calls: string[] = [];
    const balancer = new AxBalancer(
      [
        createService({
          name: 'slow',
          onChat: async () => {
            calls.push('slow');
            return response();
          },
        }),
        createService({
          name: 'fast',
          onChat: async () => {
            calls.push('fast');
            return response();
          },
        }),
      ],
      {
        ...adaptiveOptions(store),
        strategy: {
          ...adaptiveOptions(store).strategy,
          deadlineMs: 100,
          estimateCost: () => 0,
        },
      }
    );

    await balancer.chat({
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'test' }],
    });
    expect(calls).toEqual(['fast']);
  });

  test('shares observations across independent balancer instances', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    for (let index = 0; index < 8; index++) {
      const trainer = new AxBalancer(
        [
          createService({
            name: 'unstable',
            onChat: async () => {
              throw new AxAIServiceNetworkError(
                new Error('offline'),
                'test-url',
                {},
                {}
              );
            },
          }),
          createService({ name: 'stable', onChat: async () => response() }),
        ],
        {
          ...adaptiveOptions(store),
          strategy: {
            ...adaptiveOptions(store).strategy,
            badOutcomeCost: 0,
            estimateCost: ({ routeKey }) => (routeKey === 'unstable' ? 0 : 1),
          },
        }
      );
      await trainer.chat({
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'train' }],
      });
    }

    const calls: string[] = [];
    const verifier = new AxBalancer(
      [
        createService({
          name: 'unstable',
          onChat: async () => {
            calls.push('unstable');
            return response();
          },
        }),
        createService({
          name: 'stable',
          onChat: async () => {
            calls.push('stable');
            return response();
          },
        }),
      ],
      {
        ...adaptiveOptions(store),
        strategy: {
          ...adaptiveOptions(store).strategy,
          deadlineMs: 1_000_000_000,
          estimateCost: () => 0,
        },
      }
    );
    await verifier.chat({
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'verify' }],
    });
    expect(calls).toEqual(['stable']);
  });

  test('filters capabilities before ranking', async () => {
    const calls: string[] = [];
    const services = [
      createService({
        name: 'cheap-no-json',
        structuredOutputs: false,
        onChat: async () => {
          calls.push('cheap-no-json');
          return response();
        },
      }),
      createService({
        name: 'json',
        onChat: async () => {
          calls.push('json');
          return response();
        },
      }),
    ] as const;
    const balancer = new AxBalancer(services, {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        estimateCost: ({ routeKey }) => (routeKey === 'cheap-no-json' ? 0 : 1),
        routeKey: (service) => service.getName(),
      },
    });

    await balancer.chat({
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'test' }],
      responseFormat: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(calls).toEqual(['json']);
  });

  test('tries each adaptive route once and records only transient failures', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    const calls = { overloaded: 0, fallback: 0 };
    const services = [
      createService({
        name: 'overloaded',
        onChat: async () => {
          calls.overloaded++;
          throw new AxAIServiceStatusError(
            429,
            'rate limited secret',
            'test-url',
            { prompt: 'secret' },
            {}
          );
        },
      }),
      createService({
        name: 'fallback',
        onChat: async () => {
          calls.fallback++;
          return response('fallback');
        },
      }),
    ] as const;
    const events: AxBalancerRoutingEvent[] = [];
    const overloadedChat = vi.spyOn(services[0], 'chat');
    const balancer = new AxBalancer(services, {
      ...adaptiveOptions(store, (event) => events.push(event)),
      maxRetries: 9,
      strategy: {
        ...adaptiveOptions(store, (event) => events.push(event)).strategy,
        badOutcomeCost: 0,
        estimateCost: ({ routeKey }) => (routeKey === 'overloaded' ? 0 : 1),
      },
    });

    const request = {
      model: 'shared',
      chatPrompt: [{ role: 'user', content: 'secret' }],
    } as const;
    const providerOptions = { retry: { maxRetries: 4 } } as const;
    const result = await balancer.chat(request, providerOptions);
    expect('results' in result && result.results[0]?.content).toBe('fallback');
    expect(calls).toEqual({ overloaded: 1, fallback: 1 });
    expect((await store.get(statsKey('overloaded')))?.observations).toBe(1);
    expect(overloadedChat).toHaveBeenCalledOnce();
    expect(overloadedChat).toHaveBeenCalledWith(request, providerOptions);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'fallback',
        fromRouteKey: 'overloaded',
        toRouteKey: 'fallback',
        reason: 'status',
        status: 429,
      })
    );
    expect(JSON.stringify(events)).not.toContain('secret');

    // The adaptive score, not the legacy balancer backoff gate, decides the
    // next request. Each route still receives only one balancer-level attempt.
    await balancer.chat(request, providerOptions);
    expect(calls).toEqual({ overloaded: 2, fallback: 2 });
    expect(overloadedChat).toHaveBeenCalledTimes(2);
    expect((await store.get(statsKey('overloaded')))?.observations).toBe(2);

    let secondCalled = false;
    const invalid = new AxBalancer(
      [
        createService({
          name: 'invalid',
          onChat: async () => {
            throw new AxAIServiceStatusError(
              400,
              'bad request',
              'test-url',
              {},
              {}
            );
          },
        }),
        createService({
          name: 'unused',
          onChat: async () => {
            secondCalled = true;
            return response();
          },
        }),
      ],
      {
        ...adaptiveOptions(store),
        strategy: {
          ...adaptiveOptions(store).strategy,
          badOutcomeCost: 0,
          estimateCost: ({ routeKey }) => (routeKey === 'invalid' ? 0 : 1),
        },
      }
    );
    await expect(
      invalid.chat({
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(secondCalled).toBe(false);
    expect(await store.get(statsKey('invalid'))).toBeUndefined();
  });

  test('surfaces the final transient error after every route is exhausted', async () => {
    const calls: string[] = [];
    const services = ['first', 'second'].map((name) =>
      createService({
        name,
        onChat: async () => {
          calls.push(name);
          throw new AxAIServiceNetworkError(
            new Error(`${name} offline`),
            'test-url',
            {},
            {}
          );
        },
      })
    );
    const store = new AxInMemoryBalancerStatsStore();
    const balancer = new AxBalancer(services, {
      ...adaptiveOptions(store),
      strategy: {
        ...adaptiveOptions(store).strategy,
        badOutcomeCost: 0,
        estimateCost: ({ serviceIndex }) => serviceIndex,
      },
    });

    await expect(
      balancer.chat({
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toBeInstanceOf(AxAIServiceNetworkError);
    expect(calls).toEqual(['first', 'second']);
  });

  test('isolates stats-store and event-hook failures from requests', async () => {
    const events: AxBalancerRoutingEvent[] = [];
    const brokenStore: AxBalancerStatsStore = {
      async get() {
        throw new Error('store read contains secret');
      },
      async observe() {
        throw new Error('store write contains secret');
      },
    };
    const service = createService({
      name: 'healthy',
      onChat: async () => response(),
    });
    const balancer = new AxBalancer([service], {
      ...adaptiveOptions(brokenStore),
      strategy: {
        ...adaptiveOptions(brokenStore).strategy,
        onRoutingEvent: (event) => {
          events.push(event);
          return Promise.reject(new Error('telemetry failed'));
        },
      },
    });

    await expect(
      balancer.chat({
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'request secret' }],
      })
    ).resolves.toMatchObject({ results: expect.any(Array) });
    expect(events.filter((event) => event.type === 'store-error')).toEqual([
      expect.objectContaining({ operation: 'get', errorType: 'Error' }),
      expect.objectContaining({ operation: 'observe', errorType: 'Error' }),
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  test('records streaming success only after completion', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125);
    const service = createService({
      name: 'stream',
      onChat: async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(response('chunk'));
            controller.close();
          },
        }),
    });
    const balancer = new AxBalancer([service], adaptiveOptions(store));
    const result = (await balancer.chat(
      {
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      },
      { stream: true }
    )) as ReadableStream<AxChatResponse>;

    expect(await store.get(statsKey('stream'))).toBeUndefined();
    const reader = result.getReader();
    while (!(await reader.read()).done) {
      // Drain the stream so completion is observed.
    }
    const stats = await store.get(statsKey('stream'));
    now.mockRestore();
    expect(stats?.observations).toBe(1);
    expect(stats?.successes).toBe(1);
    expect(Math.exp(stats?.logLatencyMean ?? 0)).toBeCloseTo(25);
  });

  test('does not record caller-cancelled streams', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    let cancelled = false;
    const service = createService({
      name: 'cancelled',
      onChat: async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(response('chunk'));
          },
          cancel() {
            cancelled = true;
          },
        }),
    });
    const balancer = new AxBalancer([service], adaptiveOptions(store));
    const result = (await balancer.chat(
      {
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      },
      { stream: true }
    )) as ReadableStream<AxChatResponse>;
    const reader = result.getReader();
    await reader.read();
    await reader.cancel('caller stopped');

    expect(cancelled).toBe(true);
    expect(await store.get(statsKey('cancelled'))).toBeUndefined();
  });

  test('fails over before streaming content and does not replay mid-stream', async () => {
    const store = new AxInMemoryBalancerStatsStore();
    let fallbackCalls = 0;
    const beforeContent = createService({
      name: 'before-content',
      onChat: async () =>
        new ReadableStream({
          pull(controller) {
            controller.error(
              new AxAIServiceNetworkError(
                new Error('offline'),
                'test-url',
                {},
                {}
              )
            );
          },
        }),
    });
    const fallback = createService({
      name: 'fallback-stream',
      onChat: async () => {
        fallbackCalls++;
        return new ReadableStream({
          start(controller) {
            controller.enqueue(response('fallback'));
            controller.close();
          },
        });
      },
    });
    const preContentBalancer = new AxBalancer([beforeContent, fallback], {
      ...adaptiveOptions(store),
      strategy: {
        ...adaptiveOptions(store).strategy,
        badOutcomeCost: 0,
        estimateCost: ({ routeKey }) => (routeKey === 'before-content' ? 0 : 1),
      },
    });
    const fallbackResult = (await preContentBalancer.chat(
      {
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      },
      { stream: true }
    )) as ReadableStream<AxChatResponse>;
    const fallbackReader = fallbackResult.getReader();
    while (!(await fallbackReader.read()).done) {
      // Drain fallback.
    }
    expect(fallbackCalls).toBe(1);
    expect(
      (await store.get(statsKey('before-content')))?.failureEwma
    ).toBeGreaterThan(0.05);

    fallbackCalls = 0;
    const midStream = createService({
      name: 'mid-stream',
      onChat: async () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(response('partial'));
          },
          pull(controller) {
            controller.error(
              new AxAIServiceNetworkError(
                new Error('offline'),
                'test-url',
                {},
                {}
              )
            );
          },
        }),
    });
    const midStreamBalancer = new AxBalancer([midStream, fallback], {
      ...adaptiveOptions(store),
      strategy: {
        ...adaptiveOptions(store).strategy,
        badOutcomeCost: 0,
        estimateCost: ({ routeKey }) => (routeKey === 'mid-stream' ? 0 : 1),
      },
    });
    const partialResult = (await midStreamBalancer.chat(
      {
        model: 'shared',
        chatPrompt: [{ role: 'user', content: 'test' }],
      },
      { stream: true }
    )) as ReadableStream<AxChatResponse>;
    const partialReader = partialResult.getReader();
    expect((await partialReader.read()).value?.results[0]?.content).toBe(
      'partial'
    );
    await expect(partialReader.read()).rejects.toBeInstanceOf(
      AxAIServiceNetworkError
    );
    expect(fallbackCalls).toBe(0);
    expect(
      (await store.get(statsKey('mid-stream')))?.failureEwma
    ).toBeGreaterThan(0.05);
  });

  test('leaves non-chat selection on the existing ordered path', async () => {
    const embedCalls: string[] = [];
    const first = createService({
      name: 'first',
      onEmbed: async () => {
        embedCalls.push('first');
        return { embeddings: [[1]], modelUsage: undefined };
      },
    });
    const second = createService({
      name: 'second',
      onEmbed: async () => {
        embedCalls.push('second');
        return { embeddings: [[2]], modelUsage: undefined };
      },
    });
    const balancer = new AxBalancer([first, second], {
      comparator: AxBalancer.inputOrderComparator,
      debug: false,
      strategy: {
        type: 'adaptive',
        deadlineMs: 100,
        badOutcomeCost: 0,
        estimateCost: ({ routeKey }) => (routeKey === 'second' ? 0 : 1),
        routeKey: (service) => service.getName(),
      },
    });

    await balancer.embed({ texts: ['test'], embedModel: 'shared' });
    const firstTranscribe = vi.spyOn(first, 'transcribe');
    const secondTranscribe = vi.spyOn(second, 'transcribe');
    const firstSpeak = vi.spyOn(first, 'speak');
    const secondSpeak = vi.spyOn(second, 'speak');
    await balancer.transcribe({} as never);
    await balancer.speak({ text: 'test' } as never);
    expect(embedCalls).toEqual(['first']);
    expect(firstTranscribe).toHaveBeenCalledOnce();
    expect(secondTranscribe).not.toHaveBeenCalled();
    expect(firstSpeak).toHaveBeenCalledOnce();
    expect(secondSpeak).not.toHaveBeenCalled();
  });
});
