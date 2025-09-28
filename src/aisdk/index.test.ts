import { describe, expect, it, vi } from 'vitest';
import type { AxAIService, AxChatResponse } from '@ax-llm/ax/index.js';
import type { LanguageModelV2CallOptions } from '@ai-sdk/provider';

import { AxAIProvider } from './index.js';

// Mock AxAIService
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
        // Return a mock ReadableStream for streaming
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

  it('should implement LanguageModelV2 interface', () => {
    const mockAI = createMockAIService();
    const provider = new AxAIProvider(mockAI);

    expect(provider.specificationVersion).toBe('v2');
    expect(provider.supportedUrls).toEqual({});
    expect(provider.provider).toBe('test-model');
    expect(provider.modelId).toBe('test-model');
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

      const options: LanguageModelV2CallOptions = {
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      };

      const result = await provider.doGenerate(options);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(result.warnings).toEqual([]);
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

      const options: LanguageModelV2CallOptions = {
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
      expect(result.finishReason).toBe('tool-calls');
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

      const options: LanguageModelV2CallOptions = {
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
          },
        },
      };

      const mockAI = createMockAIService([mockResponse]);
      const provider = new AxAIProvider(mockAI);

      const options: LanguageModelV2CallOptions = {
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

      // Verify proper streaming lifecycle
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
        finishReason: 'stop',
        usage: {
          inputTokens: 8,
          outputTokens: 3,
          totalTokens: 11,
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

      const options: LanguageModelV2CallOptions = {
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

      // Verify the chat method was called with properly converted prompt
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
        })
      );
    });
  });
});
