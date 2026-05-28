import { describe, expect, it } from 'vitest';

import { ai } from './wrap.js';

describe('AI Factory Integration', () => {
  describe('OpenAI-compatible custom API URL support', () => {
    it('should configure a custom API URL correctly', () => {
      const llm = ai({
        name: 'openai',
        apiKey: 'test-key',
        apiURL: 'https://api.example.com/v1',
      });

      expect((llm as any).ai.apiURL).toBe('https://api.example.com/v1');
    });

    it('should configure custom OpenAI-compatible endpoints', () => {
      const testCases = [
        'https://custom-endpoint.com/v1',
        'https://api.anthropic.com/v1',
        'http://localhost:8080/v1',
        'https://gateway.ai.cloudflare.com/v1',
      ];

      testCases.forEach((url) => {
        const llm = ai({
          name: 'openai',
          apiKey: 'test-key',
          apiURL: url,
        });

        expect((llm as any).ai.apiURL).toBe(url);
      });
    });

    it('should use default OpenAI URL when apiURL is not specified', () => {
      const llm = ai({
        name: 'openai',
        apiKey: 'test-key',
      });

      expect((llm as any).ai.apiURL).toBe('https://api.openai.com/v1');
    });
  });
});
