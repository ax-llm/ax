import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import type { AxAIService, AxChatResponse } from '@ax-llm/ax/index.js';
import { generateText, streamText, tool } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AxAIProvider } from './index.js';

const createMockAIService = (
  responses: Partial<AxChatResponse>[] = []
): AxAIService => {
  let callCount = 0;
  return {
    getName: () => 'test-model',
    chat: vi.fn().mockImplementation((_req, options?) => {
      const response = responses[callCount] || { results: [] };
      callCount++;

      if (options?.stream) {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(response);
            controller.close();
          },
        });
      }

      return Promise.resolve(response);
    }),
  } as AxAIService;
};

describe('AxAIProvider', () => {
  it('should be defined', () => {
    expect(AxAIProvider).toBeDefined();
  });

  it('should implement LanguageModelV3 interface', () => {
    const mockAI = createMockAIService();
    const provider = new AxAIProvider(mockAI);

    expect(provider.specificationVersion).toBe('v3');
    expect(provider.supportedUrls).toEqual({});
    expect(provider.provider).toBe('test-model');
    expect(provider.modelId).toBe('test-model');
  });

  describe('AI SDK Core integration', () => {
    it('generates text through AI SDK Core', async () => {
      const mockAI = createMockAIService([
        {
          results: [{ content: 'Hello from Ax', finishReason: 'stop' }],
          modelUsage: {
            tokens: { promptTokens: 4, completionTokens: 3, totalTokens: 7 },
          },
        },
      ]);
      const provider = new AxAIProvider(mockAI);

      const { rawFinishReason, text, usage, finishReason } = await generateText(
        {
          model: provider,
          prompt: 'Hello',
        }
      );

      expect(text).toBe('Hello from Ax');
      expect(finishReason).toBe('stop');
      expect(rawFinishReason).toBe('stop');
      expect(usage).toMatchObject({
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
      });
      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          chatPrompt: [
            { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          ],
        }),
        { stream: false }
      );
    });

    it('maps AI SDK tools and Ax tool calls', async () => {
      const mockAI = createMockAIService([
        {
          results: [
            {
              functionCalls: [
                {
                  id: 'call_weather',
                  type: 'function',
                  function: {
                    name: 'weather',
                    params: { location: 'Paris' },
                  },
                },
              ],
              finishReason: 'function_call',
            },
          ],
        },
      ]);
      const provider = new AxAIProvider(mockAI);

      const { finishReason, toolCalls } = await generateText({
        model: provider,
        tools: {
          weather: tool({
            description: 'Get weather information',
            inputSchema: z.object({ location: z.string() }),
          }),
        },
        prompt: 'Weather in Paris?',
      });

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          functionCall: 'auto',
          functions: [
            expect.objectContaining({
              name: 'weather',
              description: 'Get weather information',
              parameters: expect.objectContaining({ type: 'object' }),
            }),
          ],
        }),
        { stream: false }
      );
      expect(finishReason).toBe('tool-calls');
      expect(toolCalls).toEqual([
        expect.objectContaining({
          toolCallId: 'call_weather',
          toolName: 'weather',
          input: { location: 'Paris' },
        }),
      ]);
    });

    it('streams text through AI SDK Core', async () => {
      const mockAI = createMockAIService([
        {
          results: [{ content: 'Streaming text', finishReason: 'stop' }],
          modelUsage: {
            tokens: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
          },
        },
      ]);
      const provider = new AxAIProvider(mockAI);

      const result = streamText({
        model: provider,
        prompt: 'Stream test',
      });
      const chunks: string[] = [];

      for await (const delta of result.textStream) {
        chunks.push(delta);
      }

      expect(chunks.join('')).toBe('Streaming text');
      await expect(result.finishReason).resolves.toBe('stop');
      await expect(result.usage).resolves.toMatchObject({
        inputTokens: 2,
        outputTokens: 2,
        totalTokens: 4,
      });
      expect(mockAI.chat).toHaveBeenCalledWith(expect.any(Object), {
        stream: true,
      });
    });
  });

  describe('doGenerate', () => {
    it('should generate text response', async () => {
      const mockResponse: AxChatResponse = {
        results: [
          {
            content: 'Hello, world!',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          tokens: {
            promptTokens: 10,
            completionTokens: 5,
          },
        },
      };

      const mockAI = createMockAIService([mockResponse]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      };

      const result = await provider.doGenerate(options);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
      expect(result.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
      expect(result.usage).toEqual({
        inputTokens: {
          total: 10,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: undefined,
          reasoning: undefined,
        },
      });
      expect(result.warnings).toEqual([]);
    });

    it('should request a non-streaming response', async () => {
      const mockAI = createMockAIService([
        { results: [{ content: 'Response', finishReason: 'stop' }] },
      ]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      };

      await provider.doGenerate(options);

      expect(mockAI.chat).toHaveBeenCalledWith(expect.any(Object), {
        stream: false,
      });
    });

    it('maps Ax correlation ids to AI SDK response metadata', async () => {
      const mockAI = createMockAIService([
        {
          sessionId: 'session-123',
          remoteId: 'resp-123',
          remoteRequestId: 'req-123',
          providerMetadata: { test: { nested: true } },
          results: [{ content: 'Response', finishReason: 'stop' }],
          modelUsage: {
            ai: 'test',
            model: 'test-model-v1',
            tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        },
      ]);
      const provider = new AxAIProvider(mockAI);

      const result = await provider.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      });

      expect(result.response).toMatchObject({
        id: 'resp-123',
        modelId: 'test-model-v1',
      });
      expect(result.providerMetadata).toMatchObject({
        test: { nested: true },
        'test-model': {
          sessionId: 'session-123',
          requestId: 'req-123',
        },
      });
    });

    it('should handle tool calls correctly', async () => {
      const mockResponse: AxChatResponse = {
        results: [
          {
            functionCalls: [
              {
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'getWeather',
                  params: { location: 'New York' },
                },
              },
            ],
            finishReason: 'function_call',
          },
        ],
        modelUsage: {
          tokens: {
            promptTokens: 15,
            completionTokens: 8,
          },
        },
      };

      const mockAI = createMockAIService([mockResponse]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'What is the weather?' }],
          },
        ],
        tools: [
          {
            type: 'function',
            name: 'getWeather',
            description: 'Get weather information',
            inputSchema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        ],
      };

      const result = await provider.doGenerate(options);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'tool-call',
        toolCallId: 'call_123',
        toolName: 'getWeather',
        input: '{"location":"New York"}',
      });
      expect(result.finishReason).toEqual({
        unified: 'tool-calls',
        raw: 'function_call',
      });
    });

    it('should handle string function params correctly', async () => {
      const mockResponse: AxChatResponse = {
        results: [
          {
            functionCalls: [
              {
                id: 'call_456',
                type: 'function',
                function: {
                  name: 'calculator',
                  params: '{"operation":"add","a":5,"b":3}',
                },
              },
            ],
            finishReason: 'function_call',
          },
        ],
      };

      const mockAI = createMockAIService([mockResponse]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Calculate 5+3' }] },
        ],
      };

      const result = await provider.doGenerate(options);

      expect(result.content[0]).toEqual({
        type: 'tool-call',
        toolCallId: 'call_456',
        toolName: 'calculator',
        input: '{"operation":"add","a":5,"b":3}',
      });
    });
  });

  describe('doStream', () => {
    it('should stream responses with proper lifecycle events', async () => {
      const mockResponse: AxChatResponse = {
        results: [
          {
            content: 'Streaming text',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          tokens: {
            promptTokens: 8,
            completionTokens: 3,
            totalTokens: 11,
            cacheReadTokens: 2,
            cacheCreationTokens: 1,
            reasoningTokens: 4,
          },
        },
      };

      const mockAI = createMockAIService([mockResponse]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Stream test' }] },
        ],
      };

      const result = await provider.doStream(options);
      const stream = result.stream;

      const chunks: any[] = [];
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      expect(chunks[0]).toEqual({
        type: 'stream-start',
        warnings: [],
      });

      expect(chunks[1]).toEqual({
        type: 'text-start',
        id: 'text-content',
      });

      expect(chunks[2]).toEqual({
        type: 'text-delta',
        id: 'text-content',
        delta: 'Streaming text',
      });

      expect(chunks[3]).toEqual({
        type: 'text-end',
        id: 'text-content',
      });

      expect(chunks[4]).toEqual({
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 8,
            noCache: undefined,
            cacheRead: 2,
            cacheWrite: 1,
          },
          outputTokens: {
            total: 3,
            text: undefined,
            reasoning: 4,
          },
        },
      });
    });

    it('should request a streaming response', async () => {
      const mockAI = createMockAIService([
        { results: [{ content: 'Streaming text', finishReason: 'stop' }] },
      ]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Stream test' }] },
        ],
      };

      await provider.doStream(options);

      expect(mockAI.chat).toHaveBeenCalledWith(expect.any(Object), {
        stream: true,
      });
    });

    it('emits AI SDK response metadata for streaming Ax chunks', async () => {
      const mockAI = createMockAIService([
        {
          remoteId: 'resp-stream-123',
          remoteRequestId: 'req-stream-123',
          results: [{ content: 'Streaming text', finishReason: 'stop' }],
          modelUsage: {
            ai: 'test',
            model: 'test-model-v1',
            tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          },
        },
      ]);
      const provider = new AxAIProvider(mockAI);

      const result = await provider.doStream({
        prompt: [
          { role: 'user', content: [{ type: 'text', text: 'Stream test' }] },
        ],
      });
      const reader = result.stream.getReader();
      const chunks: any[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toContainEqual({
        type: 'response-metadata',
        id: 'resp-stream-123',
        modelId: 'test-model-v1',
      });
      expect(chunks.at(-1)).toMatchObject({
        type: 'finish',
        providerMetadata: {
          'test-model': { requestId: 'req-stream-123' },
        },
      });
    });
  });

  describe('prompt conversion', () => {
    it('should convert tool calls in prompts correctly', async () => {
      const mockAI = createMockAIService([
        { results: [{ content: 'Response', finishReason: 'stop' }] },
      ]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV3CallOptions = {
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'What is the weather?' }],
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call_123',
                toolName: 'getWeather',
                input: '{"location":"Paris"}',
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call_123',
                toolName: 'getWeather',
                output: { type: 'text', value: 'Sunny, 22°C' },
              },
            ],
          },
        ],
      };

      await provider.doGenerate(options);

      expect(mockAI.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          chatPrompt: expect.arrayContaining([
            {
              role: 'user',
              content: [{ type: 'text', text: 'What is the weather?' }],
            },
            {
              role: 'assistant',
              content: '',
              functionCalls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'getWeather',
                    params: { location: 'Paris' },
                  },
                },
              ],
            },
            {
              role: 'function',
              functionId: 'call_123',
              result: 'Sunny, 22°C',
            },
          ]),
        }),
        { stream: false }
      );
    });
  });
});
