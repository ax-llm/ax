import { describe, expect, it, vi } from 'vitest'

import { AxMultiServiceRouter } from './multiservice.js'
import type {
  AxAIService,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
} from './types.js'

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
}

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
  getDefaultModels: () => ({ model: 'defaultModelA' }),
  getMetrics: () => metrics,
  chat: async (
    req: Readonly<AxChatRequest<string>>
  ): Promise<AxChatResponse> => {
    return { results: [{ content: `model ${req.model} from Service A` }] }
  },
  embed: async (): Promise<AxEmbedResponse> => {
    return {
      embeddings: [[1, 2, 3]],
      modelUsage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    }
  },
  setOptions: () => {},
  getOptions: () => ({ optionFrom: 'A' }) as AxAIServiceOptions,
}

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
  getDefaultModels: () => ({ model: 'defaultModelB' }),
  getMetrics: () => metrics,
  chat: async (
    req: Readonly<AxChatRequest<string>>
  ): Promise<AxChatResponse> => {
    return { results: [{ content: `model ${req.model} from Service B` }] }
  },
  embed: async (): Promise<AxEmbedResponse> => {
    return {
      embeddings: [[4, 5, 6]],
      modelUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    }
  },
  setOptions: () => {},
  getOptions: () => ({ optionFrom: 'B' }) as AxAIServiceOptions,
}

const serviceC: AxAIService<string, string> = {
  getId: () => 'serviceC',
  getName: () => 'Service C',
  getFeatures: () => ({ functions: false, streaming: false }),
  getModelList: () => [],
  getDefaultModels: () => ({ model: 'defaultModelC' }),
  getMetrics: () => metrics,
  chat: async (
    req: Readonly<AxChatRequest<string>>
  ): Promise<AxChatResponse> => {
    return { results: [{ content: `model ${req.model} from Service C` }] }
  },
  embed: async (): Promise<AxEmbedResponse> => {
    return {
      embeddings: [[4, 5, 6]],
      modelUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    }
  },
  setOptions: () => {},
  getOptions: () => ({ optionFrom: 'C' }) as AxAIServiceOptions,
}

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
    ])
    // Manually add model for key-based service after construction
    router['services'].set('serviceC', {
      service: serviceC,
      description: 'Service C',
      model: 'modelC',
    })

    const list = router.getModelList()
    expect(list).toHaveLength(5)
    expect(list?.map((m) => m.key)).toContain('serviceA-modelA')
    expect(list?.map((m) => m.key)).toContain('serviceA-modelB')
    expect(list?.map((m) => m.key)).toContain('serviceB-modelA')
    expect(list?.map((m) => m.key)).toContain('serviceB-modelB')
    expect(list?.map((m) => m.key)).toContain('serviceC')
  })

  it('delegates chat calls with the correct model parameter for key‐based and non‐key–based services', async () => {
    // Create a dummy key–based service.
    const dummyKeyServiceChat = vi.fn(
      async (req: Readonly<AxChatRequest<string>>) => {
        // Echo back the model value received for verification.
        return { results: [{ content: req.model }] }
      }
    )
    const dummyKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] }
      }
    )
    const dummyKeyService = {
      getId: () => 'dummy-key-service',
      getName: () => 'Dummy Key Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      // getModelList is not used for key–based services.
      getModelList: () => [],
      // Return some default value (this value is stored but not used in the delegation).
      getDefaultModels: () => ({ model: 'default-key' }),
      chat: dummyKeyServiceChat,
      embed: dummyKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getMetrics: () => metrics,
    }
    const keyBasedItem = {
      key: 'A',
      service: dummyKeyService,
      description: 'Key based service',
    }

    // Create a dummy non–key–based service.
    const dummyNonKeyServiceChat = vi.fn(
      async (req: Readonly<AxChatRequest<string>>) => {
        return { results: [{ content: req.model }] }
      }
    )
    const dummyNonKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] }
      }
    )
    const dummyNonKeyService = {
      getId: () => 'dummy-non-key-service',
      getName: () => 'Dummy Non-Key Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getDefaultModels: () => ({ model: 'nonKeyDefault' }),
      // Return a model list with one entry.
      getModelList: () => [
        { key: 'B', description: 'Non-key model', model: 'modelB' },
      ],
      chat: dummyNonKeyServiceChat,
      embed: dummyNonKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getMetrics: () => metrics,
    }

    // Create a router that wraps both services.
    const router = new AxMultiServiceRouter([keyBasedItem, dummyNonKeyService])

    // Manually add model for key-based service after construction
    router['services'].set('A', {
      service: dummyKeyService,
      description: 'Key based service',
      model: 'A', // This is crucial - the model must be set to the key for the delegation to work
    })

    // For key-based service, the router uses the "useDefaultModel" flag so that the delegated
    // chat call passes the request's model (which here is the key "A").
    const chatReqA: AxChatRequest<string> = {
      model: 'A',
      chatPrompt: [{ role: 'user', content: 'Hello from A' }],
    }
    await router.chat(chatReqA)
    expect(dummyKeyServiceChat).toHaveBeenCalledTimes(1)

    const chatCallArgA = dummyKeyServiceChat.mock
      .calls[0]![0] as AxChatRequest<string>
    expect(chatCallArgA.model).toBe('A')

    // For non–key–based service, getModelList produced an entry with key "B".
    const chatReqB: AxChatRequest<string> = {
      model: 'B',
      chatPrompt: [{ role: 'user', content: 'Hello from B' }],
    }
    await router.chat(chatReqB)
    expect(dummyNonKeyServiceChat).toHaveBeenCalledTimes(1)

    const chatCallArgB = dummyNonKeyServiceChat.mock
      .calls[0]![0] as AxChatRequest<string>
    // For non–key–based services, the delegated "model" is also the key ("B").
    expect(chatCallArgB.model).toBe('B')
  })

  it('delegates embed calls with the correct embed model parameter for key‐based and non‐key–based services', async () => {
    // Create a dummy key-based service.
    const dummyKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] }
      }
    )
    const dummyKeyService = {
      getId: () => 'dummy-key-service',
      getName: () => 'Dummy Key Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getModelList: () => [],
      getDefaultModels: () => ({ model: 'default-key' }),
      chat: async () => {
        return { results: [{ content: 'dummy key service' }] }
      },
      embed: dummyKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getMetrics: () => metrics,
    }
    const keyBasedItem = {
      key: 'A',
      service: dummyKeyService,
      description: 'Key based service',
    }

    // Create a dummy non-key-based service.
    const dummyNonKeyServiceEmbed = vi.fn(
      async (req: Readonly<AxEmbedRequest>) => {
        return { embeddings: [[req.embedModel?.length ?? 0]] }
      }
    )
    const dummyNonKeyService = {
      getId: () => 'dummy-non-key-service',
      getName: () => 'Dummy Non-Key Service',
      getFeatures: () => ({ functions: false, streaming: false }),
      getDefaultModels: () => ({ model: 'nonKeyDefault' }),
      getModelList: () => [
        { key: 'B', description: 'Non-key model', model: 'modelB' },
      ],
      chat: async () => {
        return { results: [{ content: 'dummy non-key service' }] }
      },
      embed: dummyNonKeyServiceEmbed,
      setOptions: () => {},
      getOptions: () => ({}),
      getMetrics: () => metrics,
    }

    // Create a router containing both services.
    const router = new AxMultiServiceRouter([keyBasedItem, dummyNonKeyService])

    // Manually add model for key-based service after construction
    router['services'].set('A', {
      service: dummyKeyService,
      description: 'Key based service',
      model: 'A', // This is crucial - the model must be set to the key for the delegation to work
    })

    // For key-based service, when embed is requested with embedModel "A", the delegated
    // call passes "A" as the embed model.
    const embedReqA: AxEmbedRequest<string> = {
      embedModel: 'A',
      texts: ['Embed text A'],
    }
    await router.embed(embedReqA)
    expect(dummyKeyServiceEmbed).toHaveBeenCalledTimes(1)

    const embedCallArgA = dummyKeyServiceEmbed.mock
      .calls[0]![0] as AxEmbedRequest<string>
    expect(embedCallArgA.embedModel).toBe('A')

    // For non–key–based service (the model list provided an entry with key "B"),
    // when embed is called with embedModel "B", the resulting delegate call passes "B".
    const embedReqB: AxEmbedRequest<string> = {
      embedModel: 'B',
      texts: ['Embed text B'],
    }
    await router.embed(embedReqB)
    expect(dummyNonKeyServiceEmbed).toHaveBeenCalledTimes(1)

    const embedCallArgB = dummyNonKeyServiceEmbed.mock
      .calls[0]![0] as AxEmbedRequest<string>
    expect(embedCallArgB.embedModel).toBe('B')
  })

  it('delegates chat calls for non-key-based services (real services)', async () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB])
    const chatRespA: AxChatResponse = (await router.chat({
      model: 'serviceA-modelA',
      chatPrompt: [{ role: 'user', content: 'Hello' }],
    })) as AxChatResponse
    expect(chatRespA.results[0]!.content!).toBe(
      'model serviceA-modelA from Service A'
    )
    const chatRespB: AxChatResponse = (await router.chat({
      model: 'serviceB-modelB',
      chatPrompt: [{ role: 'user', content: 'Hello' }],
    })) as AxChatResponse
    expect(chatRespB.results[0]!.content!).toBe(
      'model serviceB-modelB from Service B'
    )
  })

  it('delegates embed calls for non-key-based services (real services)', async () => {
    const router = new AxMultiServiceRouter([serviceA, serviceB])
    const embedRespA = await router.embed({
      embedModel: 'serviceA-modelA',
      texts: ['Hello'],
    })
    expect(embedRespA.embeddings).toEqual([[1, 2, 3]])
    const embedRespB = await router.embed({
      embedModel: 'serviceB-modelB',
      texts: ['Hello'],
    })
    expect(embedRespB.embeddings).toEqual([[4, 5, 6]])
  })

  it('aggregates the model list including embedModel entries', () => {
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
      getDefaultModels: () => ({ model: 'unused', embedModel: 'modelE' }),
      getMetrics: () => metrics,
      chat: async () => {
        throw new Error('chat should not be called')
      },
      embed: async (): Promise<AxEmbedResponse> => ({
        embeddings: [[42]],
        modelUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
      setOptions: () => {},
      getOptions: () => ({}),
    }
    const router2 = new AxMultiServiceRouter([embedOnlyService])
    const list = router2.getModelList()
    expect(list).toHaveLength(1)
    expect(list[0]).toHaveProperty('key', 'embed-only')
    expect(list[0]).toHaveProperty('embedModel', 'modelE')
    expect(list[0]).not.toHaveProperty('model')
  })

  it('delegates embedModel-only service embed calls stripping embedModel', async () => {
    const embedFn = vi.fn(async (req: Readonly<AxEmbedRequest>) => {
      return { embeddings: [[req.texts?.length ?? 0]] }
    })
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
      getDefaultModels: () => ({ model: 'unused', embedModel: 'modelE' }),
      getMetrics: () => metrics,
      chat: async () => {
        throw new Error('chat should not be called')
      },
      embed: embedFn,
      setOptions: () => {},
      getOptions: () => ({}),
    }
    const router3 = new AxMultiServiceRouter([embedOnlyService2])
    const resp = await router3.embed({
      embedModel: 'embed-only',
      texts: ['a', 'b', 'c'],
    })
    expect(embedFn).toHaveBeenCalledTimes(1)
    const callArg = embedFn.mock.calls[0]![0] as AxEmbedRequest
    expect(callArg).not.toHaveProperty('embedModel')
    expect(callArg.texts!).toEqual(['a', 'b', 'c'])
    expect(resp.embeddings).toEqual([[3]])
  })
})
