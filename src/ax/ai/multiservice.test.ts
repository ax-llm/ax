import { describe, expect, it, vi } from 'vitest';

import { AxMultiServiceRouter } from './multiservice.js';
import type {
  AxAIService,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxLoggerFunction,
  AxModelConfig,
} from './types.js';

// Mock logger function for tests
const mockLogger: AxLoggerFunction = (message: string) => console.log(message);

//
// Create two dummy AI services.
//

const metrics: AxAIServiceMetrics = {
  latency: {
    chat: { mean: 10, p95: 10, p99: 10, samples: [] },
    embed: { mean: 10, p95: 10, p99: 10, samples: [] },
  },
  errors: {
    chat: { count: 1, rate: 0, total: 1 },
    embed: { count: 1, rate: 0, total: 1 },
  },
};

type AxAIServiceLastUsed = {
  chatModel?: string;
  embedModel?: string;
  modelConfig?: AxModelConfig;
};

const testModelConfig: AxModelConfig = {
  maxTokens: 1000,
  temperature: 0.5,
  topP: 0.9,
  topK: 10,
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
};

const serviceALastUsed: AxAIServiceLastUsed = {
  modelConfig: testModelConfig,
};

const serviceA: AxAIService<string, string> = {
  getId: () => 'serviceA',
  getName: () => 'Service A',
  getFeatures: () => ({ functions: false, streaming: false }),
  getModelList: () => [
    {
      key: 'serviceA-modelA',
      model: 'ModelA',
      description: 'First service A model',
    },
    {
      key: 'serviceA-modelB',
      model: 'ModelB',
      description: 'Second service A model',
    },
  ],
  getMetrics: () => metrics,
  getLogger: () => (message: string) => console.log(message),
  getLastUsedChatModel: (): string | undefined => serviceALastUsed.chatModel,
  getLastUsedEmbedModel: (): string | undefined => serviceALastUsed.embedModel,
  getLastUsedModelConfig: (): AxModelConfig | undefined => undefined,
  chat: async (
    req: Readonly<AxChatRequest<string>>
  ): Promise<AxChatResponse> => {
    serviceALastUsed.chatModel = req.model;
    return {
      results: [{ index: 0, content: `model ${req.model} from Service A` }],
    };
  },
  embed: async (): Promise<AxEmbedResponse> => {
    serviceALastUsed.embedModel = 'test-model';
    return {
      embeddings: [[1, 2, 3]],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 5,
          completionTokens: 5,
          totalTokens: 10,
        },
      },
    };
  },
  setOptions: () => {},
  getOptions: () => ({ optionFrom: 'A' }) as AxAIServiceOptions,
};

const serviceBLastUsed: AxAIServiceLastUsed = {
  modelConfig: testModelConfig,
};

const serviceB: AxAIService<string, string> = {
  getId: () => 'serviceB',
  getName: () => 'Service B',
  getFeatures: () => ({ functions: true, streaming: true }),
  getModelList: () => [
    {
      key: 'serviceB-modelA',
      model: 'ModelA',
      description: 'First service B model',
    },
    {
      key: 'serviceB-modelB',
      model: 'ModelB',
      description: 'Second service B model',
    },
  ],
  getLogger: () => (message: string) => console.log(message),
  getLastUsedChatModel: (): string | undefined => serviceBLastUsed.chatModel,
  getLastUsedEmbedModel: (): string | undefined => serviceBLastUsed.embedModel,
  getLastUsedModelConfig: (): AxModelConfig | undefined =>
    serviceBLastUsed.modelConfig,
  getMetrics: () => metrics,
  chat: async (
    req: Readonly<AxChatRequest<string>>
  ): Promise<AxChatResponse> => {
    serviceBLastUsed.chatModel = req.model;
    return {
      results: [{ index: 0, content: `model ${req.model} from Service B` }],
    };
  },
  embed: async (): Promise<AxEmbedResponse> => {
    serviceBLastUsed.embedModel = 'test-model';
    return {
      embeddings: [[4, 5, 6]],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
        },
      },
    };
  },
  setOptions: () => {},
  getOptions: () => ({ optionFrom: 'B' }) as AxAIServiceOptions,
};

const serviceC: AxAIService<string, string> = {
  getId: () => 'serviceC',
  getName: () => 'Service C',
  getFeatures: () => ({ functions: false, streaming: false }),
  getModelList: () => [],
  getMetrics: () => metrics,
  getLogger: () => (message: string) => console.log(message),
  chat: async (
    req: Readonly<AxChatRequest<string>>
  ): Promise<AxChatResponse> => {
    return {
      results: [{ index: 0, content: `model ${req.model} from Service C` }],
    };
  },
  embed: async (): Promise<AxEmbedResponse> => {
    return {
      embeddings: [[4, 5, 6]],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
        },
      },
    };
  },
  setOptions: () => {},
  getOptions: () => ({ optionFrom: 'C' }) as AxAIServiceOptions,
  getLastUsedChatModel: (): string | undefined => undefined,
  getLastUsedEmbedModel: (): string | undefined => undefined,
  getLastUsedModelConfig: (): AxModelConfig | undefined => undefined,
};

describe('AxMultiServiceRouter Interface Compatibility', () => {
  it('should implement all AxAIService methods', () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);

    // Test that all required AxAIService methods exist
    expect(typeof router.getId).toBe('function');
    expect(typeof router.getName).toBe('function');
    expect(typeof router.getFeatures).toBe('function');
    expect(typeof router.getModelList).toBe('function');
    expect(typeof router.getMetrics).toBe('function');
    expect(typeof router.getLogger).toBe('function');

    expect(typeof router.getLastUsedChatModel).toBe('function');
    expect(typeof router.getLastUsedEmbedModel).toBe('function');
    expect(typeof router.getLastUsedModelConfig).toBe('function');

    expect(typeof router.chat).toBe('function');
    expect(typeof router.embed).toBe('function');

    expect(typeof router.setOptions).toBe('function');
    expect(typeof router.getOptions).toBe('function');
  });

  it('should be assignable to AxAIService interface', () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);

    // This should compile without errors - proves interface compatibility
    const service: AxAIService = router;
    expect(service).toBeDefined();
  });

  it('should properly delegate getLastUsedChatModel return type', () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);

    // The method should exist and return the expected type
    const result = router.getLastUsedChatModel();

    // At runtime, this will be undefined since we haven't made any calls
    // but the important thing is that it doesn't throw a type error
    expect(result).toBeUndefined();
  });

  it('should properly delegate getLastUsedEmbedModel return type', () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);

    const result = router.getLastUsedEmbedModel();
    expect(result).toBeUndefined();
  });

  it('should properly delegate getLastUsedModelConfig return type', () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);

    const result = router.getLastUsedModelConfig();
    expect(result).toBeUndefined();
  });
});

describe('AxMultiServiceRouter', () => {
  it('aggregates the model list from all services', () => {
    const router = new AxMultiServiceRouter([
      serviceA,
      serviceB,
      {
        key: 'serviceC',
        service: serviceC,
        description: 'Service C',
      },
    ]);
    // Manually add model for key-based service after construction
    router.setServiceEntry('serviceC', {
      service: serviceC,
      description: 'Service C',
      model: 'modelC',
    });

    const list = router.getModelList();
    expect(list).toHaveLength(5);
    expect(list?.map((m) => m.key)).toContain('serviceA-modelA');
    expect(list?.map((m) => m.key)).toContain('serviceA-modelB');
    expect(list?.map((m) => m.key)).toContain('serviceB-modelA');
    expect(list?.map((m) => m.key)).toContain('serviceB-modelB');
    expect(list?.map((m) => m.key)).toContain('serviceC');
  });

  it('delegates chat calls with the correct model parameter for key‐based and non‐key–based services', async () => {
    // Create a dummy key–based service.
    const dummyKeyServiceChat = vi.fn(
      async (req: Readonly<AxChatRequest<string>>) => {
        // Echo back the model value received for verification.
        return { results: [{ index: 0, content: req.model }] };
      }
    );
    const dummyKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] };
      }
    );
    const dummyKeyService = {
      getId: () => 'dummy-key-service',
      getName: () => 'Dummy Key Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getModelList: () => [],
      chat: dummyKeyServiceChat,
      embed: dummyKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getLogger: () => mockLogger,
      getMetrics: () => metrics,
      getLastUsedChatModel: (): string | undefined => undefined,
      getLastUsedEmbedModel: (): string | undefined => undefined,
      getLastUsedModelConfig: (): AxModelConfig | undefined => undefined,
    };
    const keyBasedItem = {
      key: 'A',
      service: dummyKeyService,
      description: 'Key based service',
    };

    // Create a dummy non–key–based service.
    const dummyNonKeyServiceChat = vi.fn(
      async (req: Readonly<AxChatRequest<string>>) => {
        return { results: [{ index: 0, content: req.model }] };
      }
    );
    const dummyNonKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] };
      }
    );
    const dummyNonKeyService = {
      getId: () => 'dummy-non-key-service',
      getName: () => 'Dummy Non-Key Service',
      getFeatures: () => ({ functions: true, streaming: true }),
      getModelList: () => [
        { key: 'B', description: 'Non-key model', model: 'modelB' },
      ],
      chat: dummyNonKeyServiceChat,
      embed: dummyNonKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getLogger: () => mockLogger,
      getMetrics: () => metrics,
      getLastUsedChatModel: (): string | undefined => 'modelB',
      getLastUsedEmbedModel: (): string | undefined => undefined,
      getLastUsedModelConfig: (): AxModelConfig | undefined => ({
        maxTokens: 1000,
        temperature: 0.5,
        topP: 0.9,
        topK: 10,
        presencePenalty: 0.0,
        frequencyPenalty: 0.0,
      }),
    };

    // Create a router that wraps both services.
    const router = new AxMultiServiceRouter([keyBasedItem, dummyNonKeyService]);

    // Manually add model for key-based service after construction
    router.setServiceEntry('A', {
      service: dummyKeyService,
      description: 'Key based service',
      model: 'A', // This is crucial - the model must be set to the key for the delegation to work
    });

    // For key-based service, the router uses the "useDefaultModel" flag so that the delegated
    // chat call passes the request's model (which here is the key "A").
    const chatReqA: AxChatRequest<string> = {
      model: 'A',
      chatPrompt: [{ role: 'user', content: 'Hello from A' }],
    };
    await router.chat(chatReqA);
    expect(dummyKeyServiceChat).toHaveBeenCalledTimes(1);

    const chatCallArgA = dummyKeyServiceChat.mock
      .calls[0]![0] as AxChatRequest<string>;
    expect(chatCallArgA.model).toBe('A');

    // For non–key–based service, getModelList produced an entry with key "B".
    const chatReqB: AxChatRequest<string> = {
      model: 'B',
      chatPrompt: [{ role: 'user', content: 'Hello from B' }],
    };
    await router.chat(chatReqB);
    expect(dummyNonKeyServiceChat).toHaveBeenCalledTimes(1);

    const chatCallArgB = dummyNonKeyServiceChat.mock
      .calls[0]![0] as AxChatRequest<string>;
    // For non–key–based services, the delegated "model" is also the key ("B").
    expect(chatCallArgB.model).toBe('B');
  });

  it('delegates embed calls with the correct embed model parameter for key‐based and non‐key–based services', async () => {
    // Create a dummy key-based service.
    const dummyKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] };
      }
    );
    const dummyKeyService = {
      getId: () => 'dummy-key-service',
      getName: () => 'Dummy Key Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getModelList: () => [],
      chat: async () => {
        return { results: [{ index: 0, content: 'dummy key service' }] };
      },
      embed: dummyKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getLogger: () => mockLogger,
      getMetrics: () => metrics,
      getLastUsedChatModel: (): string | undefined => undefined,
      getLastUsedEmbedModel: (): string | undefined => undefined,
      getLastUsedModelConfig: (): AxModelConfig | undefined => undefined,
    };
    const keyBasedItem = {
      key: 'A',
      service: dummyKeyService,
      description: 'Key based service',
    };

    // Create a dummy non-key-based service.
    const dummyNonKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] };
      }
    );
    const dummyNonKeyService = {
      getId: () => 'dummy-non-key-service',
      getName: () => 'Dummy Non-Key Service',
      getFeatures: () => ({ functions: true, streaming: true }),
      getModelList: () => [
        { key: 'B', description: 'Non-key model', model: 'modelB' },
      ],
      chat: async () => {
        return { results: [{ index: 0, content: 'dummy non-key service' }] };
      },
      getLastUsedChatModel: (): string | undefined => 'modelB',
      getLastUsedEmbedModel: (): string | undefined => undefined,
      getLastUsedModelConfig: (): AxModelConfig | undefined => ({
        maxTokens: 1000,
        temperature: 0.5,
        topP: 0.9,
        topK: 10,
        presencePenalty: 0.0,
        frequencyPenalty: 0.0,
      }),
      getMetrics: () => metrics,
      embed: dummyNonKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getLogger: () => mockLogger,
    };

    // Create a router containing both services.
    const router = new AxMultiServiceRouter([keyBasedItem, dummyNonKeyService]);

    // Manually add model for key-based service after construction
    router.setServiceEntry('A', {
      service: dummyKeyService,
      description: 'Key based service',
      model: 'A', // This is crucial - the model must be set to the key for the delegation to work
    });

    // For key-based service, when embed is requested with embedModel "A", the delegated
    // call passes "A" as the embed model.
    const embedReqA: AxEmbedRequest<string> = {
      embedModel: 'A',
      texts: ['Embed text A'],
    };
    await router.embed(embedReqA);
    expect(dummyKeyServiceEmbed).toHaveBeenCalledTimes(1);

    const embedCallArgA = dummyKeyServiceEmbed.mock
      .calls[0]![0] as AxEmbedRequest<string>;
    expect(embedCallArgA.embedModel).toBe('A');

    // For non–key–based service (the model list provided an entry with key "B"),
    // when embed is called with embedModel "B", the resulting delegate call passes "B".
    const embedReqB: AxEmbedRequest<string> = {
      embedModel: 'B',
      texts: ['Embed text B'],
    };
    await router.embed(embedReqB);
    expect(dummyNonKeyServiceEmbed).toHaveBeenCalledTimes(1);

    const embedCallArgB = dummyNonKeyServiceEmbed.mock
      .calls[0]![0] as AxEmbedRequest<string>;
    expect(embedCallArgB.embedModel).toBe('B');
  });

  it('delegates chat calls for non-key-based services (real services)', async () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);
    const chatRespA: AxChatResponse = (await router.chat({
      model: 'serviceA-modelA',
      chatPrompt: [{ role: 'user', content: 'Hello' }],
    })) as AxChatResponse;
    expect(chatRespA.results[0]!.content!).toBe(
      'model serviceA-modelA from Service A'
    );
    const chatRespB: AxChatResponse = (await router.chat({
      model: 'serviceB-modelB',
      chatPrompt: [{ role: 'user', content: 'Hello' }],
    })) as AxChatResponse;
    expect(chatRespB.results[0]!.content!).toBe(
      'model serviceB-modelB from Service B'
    );
  });

  it('delegates embed calls for non-key-based services (real services)', async () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB]);
    const embedRespA = await router.embed({
      embedModel: 'serviceA-modelA',
      texts: ['Hello'],
    });
    expect(embedRespA.embeddings).toEqual([[1, 2, 3]]);
    const embedRespB = await router.embed({
      embedModel: 'serviceB-modelB',
      texts: ['Hello'],
    });
    expect(embedRespB.embeddings).toEqual([[4, 5, 6]]);
  });

  it('aggregates the model list including embedModel entries', () => {
    const embedOnlyServiceLastUsed: AxAIServiceLastUsed = {
      modelConfig: testModelConfig,
    };
    const embedOnlyService: AxAIService<string, string> = {
      getId: () => 'embed-only-service',
      getName: () => 'Embed Only Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getModelList: () => [
        {
          key: 'embed-only',
          description: 'Embed only model',
          embedModel: 'modelE',
        },
      ],
      getMetrics: () => metrics,
      chat: async () => {
        throw new Error('chat should not be called');
      },
      embed: async (): Promise<AxEmbedResponse> => {
        embedOnlyServiceLastUsed.embedModel = 'test-model';
        return {
          embeddings: [[42]],
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
      },
      getLastUsedChatModel: (): string | undefined => undefined,
      getLastUsedEmbedModel: (): string | undefined =>
        embedOnlyServiceLastUsed.embedModel,
      getLastUsedModelConfig: (): AxModelConfig | undefined =>
        embedOnlyServiceLastUsed.modelConfig,
      setOptions: () => {},
      getOptions: () => ({}),
      getLogger: () => mockLogger,
    };
    const router2 = new AxMultiServiceRouter([embedOnlyService]);
    const list = router2.getModelList();
    expect(list).toHaveLength(1);
    expect(list[0]).toHaveProperty('key', 'embed-only');
    expect(list[0]).toHaveProperty('embedModel', 'modelE');
    expect(list[0]).not.toHaveProperty('model');
  });

  it('delegates embedModel-only service embed calls stripping embedModel', async () => {
    const embedOnlyServiceLastUsed: AxAIServiceLastUsed = {
      modelConfig: testModelConfig,
    };
    const embedFn = vi.fn(async (req: Readonly<AxEmbedRequest>) => {
      embedOnlyServiceLastUsed.embedModel = req.embedModel;
      return { embeddings: [[req.texts?.length ?? 0]] };
    });

    const embedOnlyService2 = {
      getId: () => 'embed-only-service',
      getName: () => 'Embed Only Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getModelList: () => [
        {
          key: 'embed-only',
          description: 'Embed only service',
          embedModel: 'modelE',
        },
      ],
      getLastUsedChatModel: (): string | undefined => undefined,
      getLastUsedEmbedModel: (): string | undefined =>
        embedOnlyServiceLastUsed.embedModel,
      getLastUsedModelConfig: (): AxModelConfig | undefined =>
        embedOnlyServiceLastUsed.modelConfig,
      getMetrics: () => metrics,
      chat: async () => {
        throw new Error('chat should not be called');
      },
      embed: embedFn,
      setOptions: () => {},
      getOptions: () => ({}),
      getLogger: () => mockLogger,
    };
    const router3 = new AxMultiServiceRouter([embedOnlyService2]);
    const resp = await router3.embed({
      embedModel: 'embed-only',
      texts: ['a', 'b', 'c'],
    });
    expect(embedFn).toHaveBeenCalledTimes(1);
    const callArg = embedFn.mock.calls[0]![0] as AxEmbedRequest;
    expect(callArg).not.toHaveProperty('embedModel');
    expect(callArg.texts!).toEqual(['a', 'b', 'c']);
    expect(resp.embeddings).toEqual([[3]]);
  });
});
