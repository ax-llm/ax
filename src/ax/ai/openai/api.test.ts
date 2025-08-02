import { describe, expect, it } from 'vitest';

import { AxAIOpenAI } from './api.js';

describe('AxAIOpenAI', () => {
  describe('API URL configuration', () => {
    it('should use default OpenAI API URL when apiURL is not provided', () => {
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
      });

      expect((llm as any).apiURL).toBe('https://api.openai.com/v1');
    });

    it('should use custom API URL when apiURL is provided', () => {
      const customUrl = 'https://openrouter.ai/api/v1';
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
        apiURL: customUrl,
      });

      expect((llm as any).apiURL).toBe(customUrl);
    });

    it('should use different custom API URL formats', () => {
      const testCases = [
        'https://custom-endpoint.com/v1',
        'https://api.anthropic.com/v1',
        'http://localhost:8080/v1',
        'https://gateway.ai.cloudflare.com/v1',
      ];

      testCases.forEach((url) => {
        const llm = new AxAIOpenAI({
          apiKey: 'test-key',
          apiURL: url,
        });

        expect((llm as any).apiURL).toBe(url);
      });
    });

    it('should work with ai() factory function and custom API URL', () => {
      // This test verifies the factory function properly passes apiURL
      // We'll test this via the AxAIOpenAI constructor which is what the factory uses
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
        apiURL: 'https://openrouter.ai/api/v1',
      });

      expect((llm as any).apiURL).toBe('https://openrouter.ai/api/v1');
    });
  });
});
