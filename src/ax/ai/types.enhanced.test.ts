import { describe, expect, it } from 'vitest';

import type {
  AxChatResponse,
  AxChatResponseResult,
  AxTokenUsage,
} from './types.js';

describe('Enhanced AxChatResponse Types', () => {
  describe('Enhanced Citation Data', () => {
    it('should support basic url_citation with original fields', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'This is a response with a citation.',
        citations: [
          {
            url: 'https://example.com/article',
            title: 'Example Article',
            description: 'An example article description',
          },
        ],
      };

      expect(result.citations).toBeDefined();
      expect(result.citations![0].url).toBe('https://example.com/article');
      expect(result.citations![0].title).toBe('Example Article');
      expect(result.citations![0].description).toBe(
        'An example article description'
      );
    });

    it('should support enhanced citation fields', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'Academic response with rich citation metadata.',
        citations: [
          {
            url: 'https://academic.example.com/paper',
            title: 'Research Paper on AI',
            description: 'A comprehensive study on artificial intelligence',
            license: 'CC BY 4.0',
            publicationDate: '2024-01-15T10:30:00Z',
            snippet: 'The key finding was that AI models perform better...',
          },
        ],
      };

      const citation = result.citations![0];
      expect(citation.license).toBe('CC BY 4.0');
      expect(citation.publicationDate).toBe('2024-01-15T10:30:00Z');
      expect(citation.snippet).toBe(
        'The key finding was that AI models perform better...'
      );
    });

    it('should support multiple citations with mixed metadata', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'Response with multiple sources.',
        citations: [
          {
            url: 'https://source1.com',
            title: 'Source 1',
          },
          {
            url: 'https://source2.com',
            title: 'Source 2',
            license: 'MIT',
            snippet: 'Relevant excerpt from source 2',
          },
        ],
      };

      expect(result.citations).toHaveLength(2);
      expect(result.citations![1].license).toBe('MIT');
      expect(result.citations![1].snippet).toBe(
        'Relevant excerpt from source 2'
      );
    });

    it('should validate confidence score range', () => {
      const validResult: AxChatResponseResult = {
        index: 0,
        content: 'Response with citation.',
        citations: [{ url: 'https://example.com' }],
      };
      expect(validResult.citations![0].url).toBe('https://example.com');
    });
  });

  describe('Enhanced Token Usage', () => {
    it('should support basic token usage fields', () => {
      const usage: AxTokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      expect(usage.promptTokens).toBe(100);
      expect(usage.completionTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
    });

    it('should support reasoning tokens for O1-style models', () => {
      const usage: AxTokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 180,
        reasoningTokens: 30,
      };

      expect(usage.reasoningTokens).toBe(30);
      expect(usage.totalTokens).toBe(180); // Should include reasoning tokens
    });

    it('should support cache token tracking', () => {
      const usage: AxTokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheCreationTokens: 25,
        cacheReadTokens: 75,
      };

      expect(usage.cacheCreationTokens).toBe(25);
      expect(usage.cacheReadTokens).toBe(75);
    });

    it('should support service tier information', () => {
      const standardUsage: AxTokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        serviceTier: 'standard',
      };

      const priorityUsage: AxTokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        serviceTier: 'priority',
      };

      const batchUsage: AxTokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        serviceTier: 'batch',
      };

      expect(standardUsage.serviceTier).toBe('standard');
      expect(priorityUsage.serviceTier).toBe('priority');
      expect(batchUsage.serviceTier).toBe('batch');
    });

    it('should support all enhanced token fields together', () => {
      const comprehensiveUsage: AxTokenUsage = {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 350,
        thoughtsTokens: 20,
        reasoningTokens: 30,
        cacheCreationTokens: 10,
        cacheReadTokens: 150,
        serviceTier: 'priority',
      };

      expect(comprehensiveUsage.thoughtsTokens).toBe(20);
      expect(comprehensiveUsage.reasoningTokens).toBe(30);
      expect(comprehensiveUsage.cacheCreationTokens).toBe(10);
      expect(comprehensiveUsage.cacheReadTokens).toBe(150);
      expect(comprehensiveUsage.serviceTier).toBe('priority');
    });
  });

  describe('Log Probabilities', () => {
    it('should support basic log probabilities', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'Hello world!',
        logprobs: {
          content: [
            {
              token: 'Hello',
              logprob: -0.31725305,
            },
            {
              token: ' world',
              logprob: -0.5234812,
            },
            {
              token: '!',
              logprob: -0.8901234,
            },
          ],
        },
      };

      expect(result.logprobs).toBeDefined();
      expect(result.logprobs!.content).toHaveLength(3);
      expect(result.logprobs!.content![0].token).toBe('Hello');
      expect(result.logprobs!.content![0].logprob).toBe(-0.31725305);
    });

    it('should support log probabilities with top alternatives', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'The answer is 42.',
        logprobs: {
          content: [
            {
              token: 'The',
              logprob: -0.1,
              topLogprobs: [
                { token: 'The', logprob: -0.1 },
                { token: 'An', logprob: -2.3 },
                { token: 'This', logprob: -3.1 },
              ],
            },
            {
              token: ' answer',
              logprob: -0.5,
              topLogprobs: [
                { token: ' answer', logprob: -0.5 },
                { token: ' solution', logprob: -1.8 },
                { token: ' result', logprob: -2.2 },
              ],
            },
          ],
        },
      };

      const firstToken = result.logprobs!.content![0];
      expect(firstToken.topLogprobs).toHaveLength(3);
      expect(firstToken.topLogprobs![0].token).toBe('The');
      expect(firstToken.topLogprobs![1].token).toBe('An');
      expect(firstToken.topLogprobs![1].logprob).toBe(-2.3);
    });

    it('should support empty log probabilities', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'Response without detailed probabilities.',
        logprobs: {
          content: [],
        },
      };

      expect(result.logprobs!.content).toEqual([]);
    });

    it('should work without log probabilities (optional field)', () => {
      const result: AxChatResponseResult = {
        index: 0,
        content: 'Simple response without logprobs.',
      };

      expect(result.logprobs).toBeUndefined();
    });
  });

  describe('Integration Tests', () => {
    it('should support complete response with all enhanced fields', () => {
      const response: AxChatResponse = {
        sessionId: 'session-123',
        remoteId: 'remote-456',
        results: [
          {
            index: 0,
            content:
              'Based on recent research, AI models show significant improvement.',
            citations: [
              {
                url: 'https://research.ai/paper-2024',
                title: 'AI Model Performance Study 2024',
                description: 'Comprehensive analysis of AI model improvements',
                license: 'CC BY-SA 4.0',
                publicationDate: '2024-03-15T09:00:00Z',
                snippet: 'Recent experiments demonstrate a 25% improvement...',
              },
            ],
            logprobs: {
              content: [
                {
                  token: 'Based',
                  logprob: -0.2,
                  topLogprobs: [
                    { token: 'Based', logprob: -0.2 },
                    { token: 'According', logprob: -1.5 },
                  ],
                },
              ],
            },
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'openai',
          model: 'gpt-4o-mini',
          tokens: {
            promptTokens: 150,
            completionTokens: 75,
            totalTokens: 255,
            reasoningTokens: 30,
            cacheCreationTokens: 15,
            cacheReadTokens: 100,
            serviceTier: 'priority',
          },
        },
      };

      // Verify all fields are properly typed and accessible
      expect(response.results[0].citations![0].title).toBe(
        'AI Model Performance Study 2024'
      );
      expect(
        response.results[0].logprobs!.content![0].topLogprobs![1].token
      ).toBe('According');
      expect(response.modelUsage!.tokens!.reasoningTokens).toBe(30);
      expect(response.modelUsage!.tokens!.serviceTier).toBe('priority');
    });

    it('should maintain backward compatibility with existing responses', () => {
      const legacyResponse: AxChatResponse = {
        results: [
          {
            index: 0,
            content: 'Legacy response format.',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'anthropic',
          model: 'claude-3-sonnet',
          tokens: {
            promptTokens: 50,
            completionTokens: 25,
            totalTokens: 75,
          },
        },
      };

      // Should work without any enhanced fields
      expect(legacyResponse.results[0].content).toBe('Legacy response format.');
      expect(legacyResponse.modelUsage!.tokens!.totalTokens).toBe(75);
      expect(legacyResponse.results[0].annotations).toBeUndefined();
      expect(legacyResponse.results[0].logprobs).toBeUndefined();
      expect(
        legacyResponse.modelUsage!.tokens!.reasoningTokens
      ).toBeUndefined();
    });
  });
});
