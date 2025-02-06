// // index.test-d.ts
// import type { ReadableStream } from 'stream/web'

// import { expectError, expectType } from 'tsd'

// import type {
//   AxAIService,
//   AxAIServiceMetrics,
//   AxAIServiceOptions,
//   AxChatRequest,
//   AxChatResponse,
//   AxEmbedResponse,
//   AxFunction,
//   AxModelConfig,
//   AxModelInfo,
//   AxModelInfoWithProvider,
//   AxTokenUsage,
// } from './index.js'

// // Test AxModelInfo structure
// expectType<AxModelInfo>({
//   name: 'gpt-4',
//   currency: 'USD',
//   promptTokenCostPer1M: 30,
//   completionTokenCostPer1M: 60,
//   aliases: ['gpt4'],
// })

// // Test AxTokenUsage structure
// expectType<AxTokenUsage>({
//   promptTokens: 100,
//   completionTokens: 50,
//   totalTokens: 150,
// })

// // Test AxModelConfig
// expectType<AxModelConfig>({
//   maxTokens: 1000,
//   temperature: 0.7,
//   topP: 0.9,
//   stopSequences: ['\n', 'Stop'],
//   stream: true,
// })

// // Test AxFunction
// expectType<AxFunction>({
//   name: 'getData',
//   description: 'Fetches data',
//   parameters: {
//     type: 'object',
//     properties: {
//       id: {
//         type: 'string',
//         description: 'The data ID',
//       },
//     },
//     required: ['id'],
//   },
//   func: async (args) => ({ data: 'test' }),
// })

// // Test chat request structure
// expectType<AxChatRequest>({
//   chatPrompt: [
//     { role: 'system', content: 'You are a helpful assistant' },
//     { role: 'user', content: 'Hello' },
//     {
//       role: 'assistant',
//       content: 'Hi there!',
//       functionCalls: [
//         {
//           id: '123',
//           type: 'function',
//           function: { name: 'getData', params: { id: '123' } },
//         },
//       ],
//     },
//   ],
//   model: 'gpt-4',
//   modelConfig: { temperature: 0.7 },
// })

// // Test chat response
// expectType<AxChatResponse>({
//   sessionId: '123',
//   remoteId: '456',
//   results: [
//     {
//       content: 'Hello',
//       id: '789',
//       finishReason: 'stop',
//     },
//   ],
//   modelUsage: {
//     promptTokens: 10,
//     completionTokens: 5,
//     totalTokens: 15,
//   },
// })

// // Test embed response
// expectType<AxEmbedResponse>({
//   sessionId: '123',
//   embeddings: [[0.1, 0.2, 0.3]],
//   modelUsage: {
//     promptTokens: 10,
//     completionTokens: 0,
//     totalTokens: 10,
//   },
// })

// // Test service options
// expectType<AxAIServiceOptions>({
//   debug: true,
//   fetch: fetch,
//   rateLimiter: async (req, info) => req(),
// })

// // Test complex chat prompt with different content types
// expectType<AxChatRequest['chatPrompt'][number]>({
//   role: 'user',
//   content: [
//     {
//       type: 'text',
//       text: 'Analyze this image',
//       cache: true,
//     },
//     {
//       type: 'image',
//       mimeType: 'image/jpeg',
//       image: 'base64string',
//       details: 'high',
//     },
//     {
//       type: 'audio',
//       data: 'base64string',
//       format: 'wav',
//     },
//   ],
// })

// // Test error cases
// expectError<AxModelInfo>({
//   name: 123, // Should be string
// })

// expectError<AxChatRequest>({
//   chatPrompt: [
//     { role: 'invalid', content: 'test' }, // Invalid role
//   ],
// })

// expectError<AxModelConfig>({
//   temperature: 'hot', // Should be number
// })

// expectError<AxChatResponse['results'][number]>({
//   finishReason: 'invalid', // Invalid finish reason
// })

// // Test AxAIService implementation
// const mockService: AxAIService = {
//   getName: () => 'test-service',

//   getModelInfo: () => ({
//     name: 'gpt-4',
//     provider: 'openai',
//     currency: 'USD',
//     promptTokenCostPer1M: 30,
//   }),

//   getEmbedModelInfo: () => ({
//     name: 'text-embedding-ada-002',
//     provider: 'openai',
//     promptTokenCostPer1M: 10,
//   }),

//   getModelConfig: () => ({
//     maxTokens: 1000,
//     temperature: 0.7,
//   }),

//   getFeatures: (model) => ({
//     functions: true,
//     streaming: true,
//   }),

//   getModelList: () => ({
//     'gpt-4': 'openai/gpt-4',
//   }),

//   getMetrics: () => ({
//     latency: {
//       chat: { mean: 1000, p95: 2000, p99: 3000, samples: [800, 1200] },
//       embed: { mean: 200, p95: 400, p99: 600, samples: [150, 250] },
//     },
//     errors: {
//       chat: { count: 10, rate: 0.01, total: 1000 },
//       embed: { count: 5, rate: 0.005, total: 1000 },
//     },
//   }),

//   chat: async (req, options) => ({
//     results: [{ content: 'Hello' }],
//     sessionId: '123',
//   }),

//   embed: async (req, options) => ({
//     embeddings: [[0.1, 0.2, 0.3]],
//     sessionId: '123',
//   }),

//   setOptions: (options) => {},
// }

// // Test return types of service methods
// expectType<string>(mockService.getName())
// expectType<Readonly<AxModelInfoWithProvider>>(mockService.getModelInfo())
// expectType<Readonly<AxModelInfoWithProvider> | undefined>(
//   mockService.getEmbedModelInfo()
// )
// expectType<{ functions: boolean; streaming: boolean }>(
//   mockService.getFeatures()
// )
// expectType<AxAIServiceMetrics>(mockService.getMetrics())

// // Test async method return types
// const chatResponse = await mockService.chat({
//   chatPrompt: [{ role: 'user', content: 'Hello' }],
// })
// expectType<AxChatResponse | ReadableStream<AxChatResponse>>(chatResponse)

// const embedResponse = await mockService.embed({
//   texts: ['Hello world'],
// })
// expectType<AxEmbedResponse>(embedResponse)

// // Test error cases
// expectError<AxAIService>({
//   ...mockService,
//   getName: () => 123, // Should return string
// })

// expectError<AxAIService>({
//   ...mockService,
//   getFeatures: () => ({
//     // Missing required properties
//     functions: true,
//   }),
// })
