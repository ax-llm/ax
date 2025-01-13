import test from 'ava'

import { AxBalancer, axInputOrderComparator } from './balance.js'
import type {
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceMetrics,
  AxChatRequest,
  AxChatResponse,
  AxEmbedResponse,
} from './types.js'

/**
 * Mock service for testing
 */
class MockService implements AxAIService {
  constructor(
    private readonly chatFn: () => unknown = () => ({}),
    private readonly cost: number = 100
  ) {}

  getName = () => 'mock'

  getModelInfo = () => ({
    name: 'mock',
    provider: 'mock',
    promptTokenCostPer1M: this.cost,
    completionTokenCostPer1M: this.cost,
  })

  getEmbedModelInfo = () => undefined
  getModelConfig = () => ({})
  getFeatures = () => ({ functions: false, streaming: false })
  getModelMap = () => undefined
  getMetrics = () => ({}) as AxAIServiceMetrics

  embed = async () => ({}) as AxEmbedResponse
  setOptions = () => {}

  chat = async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _req: Readonly<AxChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ) => {
    this.chatFn()
    return Promise.resolve({} as AxChatResponse)
  }
}

test('first service works', async (t) => {
  let calledService: number | undefined
  const services: AxAIService[] = [
    new MockService(() => {
      calledService = 0
    }, 2.0),
    new MockService(() => {
      calledService = 1
    }, 1.0),
  ]

  const balancer = new AxBalancer(services)
  await balancer.chat({
    chatPrompt: [{ role: 'user', content: 'test' }],
    model: 'mock',
  })

  t.is(calledService, 1)
})

test('first service fails', async (t) => {
  let calledService: number | undefined
  const services: AxAIService[] = [
    new MockService(() => {
      calledService = 0
    }, 2.0),
    new MockService(() => {
      throw new Error('test')
    }, 1.0),
  ]

  const balancer = new AxBalancer(services)
  await balancer.chat({
    chatPrompt: [{ role: 'user', content: 'test' }],
    model: 'mock',
  })

  t.is(calledService, 0)
})

test('first service works comparator', async (t) => {
  let calledService: number | undefined
  const services: AxAIService[] = [
    new MockService(() => {
      calledService = 0
    }, 2.0),
    new MockService(() => {
      calledService = 1
    }, 1.0),
  ]

  const balancer = new AxBalancer(services, {
    comparator: axInputOrderComparator,
  })

  await balancer.chat({
    chatPrompt: [{ role: 'user', content: 'test' }],
    model: 'mock',
  })

  t.is(calledService, 0)
})

test('first service fails comparator', async (t) => {
  let calledService: number | undefined
  const services: AxAIService[] = [
    new MockService(() => {
      throw new Error('test')
    }, 2.0),
    new MockService(() => {
      calledService = 1
    }, 1.0),
  ]

  const balancer = new AxBalancer(services, {
    comparator: axInputOrderComparator,
  })

  await balancer.chat({
    chatPrompt: [{ role: 'user', content: 'test' }],
    model: 'mock',
  })

  t.is(calledService, 1)
})
