import { describe, expect, it } from 'vitest';
import type { AxAIGoogleGeminiModel } from './google-gemini/types.js';
import type {
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from './openai/chat_types.js';
import type { AxAIService, AxAIServiceOptions } from './types.js';
import { AxAI } from './wrap.js';

describe('AxAI Wrapper', () => {
  describe('Interface Compatibility', () => {
    it('should implement all AxAIService methods', () => {
      // Create a mock AxAI instance
      const mockAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      // Test that all required AxAIService methods exist
      expect(typeof mockAI.getId).toBe('function');
      expect(typeof mockAI.getName).toBe('function');
      expect(typeof mockAI.getFeatures).toBe('function');
      expect(typeof mockAI.getModelList).toBe('function');
      expect(typeof mockAI.getMetrics).toBe('function');
      expect(typeof mockAI.getLogger).toBe('function');

      expect(typeof mockAI.getLastUsedChatModel).toBe('function');
      expect(typeof mockAI.getLastUsedEmbedModel).toBe('function');
      expect(typeof mockAI.getLastUsedModelConfig).toBe('function');

      expect(typeof mockAI.chat).toBe('function');
      expect(typeof mockAI.embed).toBe('function');

      expect(typeof mockAI.setOptions).toBe('function');
      expect(typeof mockAI.getOptions).toBe('function');
    });

    it('should be assignable to AxAIService interface', () => {
      // Type-level test using TypeScript's structural typing
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      // This should compile without errors - proves interface compatibility
      const service: AxAIService = axAI;
      expect(service).toBeDefined();
    });

    it('should be assignable to specific AxAIService with concrete model types', () => {
      // Type-level test for the specific case mentioned in the error
      const axAI = new AxAI({
        name: 'google-gemini',
        apiKey: 'test-key',
        config: { model: 'gemini-2.0-flash-exp' as AxAIGoogleGeminiModel },
      });

      // This should compile without errors - proves interface compatibility with specific model types
      const service: AxAIService<string, unknown, string> = axAI;
      expect(service).toBeDefined();
    });

    it('should properly delegate getLastUsedChatModel return type', () => {
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      // The method should exist and return the expected type
      const result = axAI.getLastUsedChatModel();

      // At runtime, this will be undefined since we haven't made any calls
      // but the important thing is that it doesn't throw a type error
      expect(result).toBeUndefined();
    });

    it('should properly delegate getLastUsedEmbedModel return type', () => {
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: {
          model: 'gpt-4' as AxAIOpenAIModel,
          embedModel: 'text-embedding-3-small' as AxAIOpenAIEmbedModel,
        },
      });

      const result = axAI.getLastUsedEmbedModel();
      expect(result).toBeUndefined();
    });

    it('should properly delegate getLastUsedModelConfig return type', () => {
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      const result = axAI.getLastUsedModelConfig();
      expect(result).toBeUndefined();
    });
  });

  describe('Factory Methods', () => {
    it('should create AxAI instance with constructor', () => {
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      expect(axAI).toBeInstanceOf(AxAI);
      expect(axAI.getName()).toBe('OpenAI');
    });

    it('should create AxAI instance with static create method', () => {
      const axAI = AxAI.create({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      expect(axAI).toBeInstanceOf(AxAI);
      expect(axAI.getName()).toBe('OpenAI');
    });
  });

  describe('Method Delegation', () => {
    it('should delegate all methods to underlying AI service', () => {
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
      });

      // Test basic methods
      expect(axAI.getName()).toBe('OpenAI');
      expect(typeof axAI.getId()).toBe('string');
      expect(typeof axAI.getFeatures()).toBe('object');
      expect(typeof axAI.getMetrics()).toBe('object');

      // Test options methods
      const options: AxAIServiceOptions = { debug: true };
      expect(() => axAI.setOptions(options)).not.toThrow();
      expect(typeof axAI.getOptions()).toBe('object');
    });

    it('should handle supported AI providers with proper configuration', () => {
      // Test a few key providers that don't require special config
      const providerConfigs = [
        { name: 'openai', apiKey: 'test-key', config: { model: 'test-model' } },
        {
          name: 'anthropic',
          apiKey: 'test-key',
          config: { model: 'test-model' },
        },
        {
          name: 'google-gemini',
          apiKey: 'test-key',
          config: { model: 'test-model' },
        },
        { name: 'ollama', apiKey: 'test-key', config: { model: 'test-model' } },
      ] as const;

      providerConfigs.forEach((config) => {
        expect(() => {
          const axAI = new AxAI(config);
          // Just test that the instance is created successfully
          expect(axAI).toBeInstanceOf(AxAI);
          expect(typeof axAI.getName()).toBe('string');
        }).not.toThrow();
      });
    });
  });

  describe('Type Safety', () => {
    it('should maintain type safety for model keys', () => {
      // This test ensures that the generic TModelKey type is preserved
      const axAI = new AxAI({
        name: 'openai',
        apiKey: 'test-key',
        config: { model: 'gpt-4' as AxAIOpenAIModel },
        models: [
          {
            key: 'fast',
            model: 'gpt-4' as AxAIOpenAIModel,
            description: 'Fast model',
          },
          {
            key: 'smart',
            model: 'gpt-4' as AxAIOpenAIModel,
            description: 'Smart model',
          },
        ],
      });

      const modelList = axAI.getModelList();
      expect(Array.isArray(modelList)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unknown AI provider', () => {
      expect(() => {
        new AxAI({
          // @ts-expect-error - Testing unknown provider
          name: 'unknown-provider',
          apiKey: 'test-key',
          config: { model: 'test-model' },
        });
      }).toThrow('Unknown AI');
    });
  });
});
