import { describe, it, expect } from 'vitest';

import type { AxFunction } from '../ai/types.js';
import { SignatureToolCallingManager } from './signatureToolCalling.js';
import { SignatureToolRouter } from './signatureToolRouter.js';
import { AxSignature } from './sig.js';

describe('SignatureToolCalling', () => {
  const mockTools: AxFunction[] = [
    {
      name: 'searchWeb',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      func: async (args: { query: string }) =>
        `Search results for: ${args.query}`,
    },
    {
      name: 'calculate',
      description: 'Perform calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression',
          },
        },
        required: ['expression'],
      },
      func: async (args: { expression: string }) =>
        // biome-ignore lint/security/noGlobalEval: Safe for testing
        `Result: ${eval(args.expression)}`,
    },
  ];

  describe('SignatureToolCallingManager', () => {
    it('should not modify signature when disabled', () => {
      const manager = new SignatureToolCallingManager({
        signatureToolCalling: false,
        functions: mockTools,
      });

      const signature = AxSignature.create('query:string -> answer:string');
      const processed = manager.processSignature(signature);

      expect(processed.getOutputFields()).toHaveLength(1);
      expect(processed.getOutputFields()[0].name).toBe('answer');
    });

    it('should inject tool fields when enabled', () => {
      const manager = new SignatureToolCallingManager({
        signatureToolCalling: true,
        functions: mockTools,
      });

      const signature = AxSignature.create('query:string -> answer:string');
      const processed = manager.processSignature(signature);

      const outputFields = processed.getOutputFields();
      expect(outputFields).toHaveLength(3); // answer + search_web + calculate

      const fieldNames = outputFields.map((f) => f.name);
      expect(fieldNames).toContain('answer');
      expect(fieldNames).toContain('search_web');
      expect(fieldNames).toContain('calculate');

      // Check that tool fields are optional
      const searchField = outputFields.find((f) => f.name === 'search_web');
      expect(searchField?.isOptional).toBe(true);
    });

    it('should process results and execute tools', async () => {
      const manager = new SignatureToolCallingManager({
        signatureToolCalling: true,
        functions: mockTools,
      });

      const results = {
        answer: 'Here is your answer',
        search_web: { query: 'test query' },
        calculate: { expression: '2 + 2' },
      };

      const processed = await manager.processResults(results);

      expect(processed.answer).toBe('Here is your answer');
      expect(processed.search_web).toBe('Search results for: test query');
      expect(processed.calculate).toBe('Result: 4');
    });

    it('should skip tool execution when fields are not populated', async () => {
      const manager = new SignatureToolCallingManager({
        signatureToolCalling: true,
        functions: mockTools,
      });

      const results = {
        answer: 'Here is your answer',
        // search_web and calculate are not populated
      };

      const processed = await manager.processResults(results);

      expect(processed.answer).toBe('Here is your answer');
      expect(processed.search_web).toBeUndefined();
      expect(processed.calculate).toBeUndefined();
    });
  });

  describe('SignatureToolRouter', () => {
    it('should route tool calls correctly', async () => {
      const router = new SignatureToolRouter(mockTools);

      const results = {
        answer: 'test',
        search_web: { query: 'hello world' },
        calculate: { expression: '10 * 5' },
      };

      const processed = await router.route(results);

      expect(processed.toolResults.search_web).toBe(
        'Search results for: hello world'
      );
      expect(processed.toolResults.calculate).toBe('Result: 50');
      expect(processed.remainingFields.answer).toBe('test');
    });

    it('should handle tool execution errors gracefully', async () => {
      const errorTool: AxFunction = {
        name: 'errorTool',
        description: 'Tool that throws errors',
        parameters: { type: 'object', properties: {} },
        func: async () => {
          throw new Error('Tool failed');
        },
      };

      const router = new SignatureToolRouter([errorTool]);

      const results = {
        answer: 'test',
        error_tool: {},
      };

      const processed = await router.route(results);

      // Should keep original value when tool fails
      expect(processed.remainingFields.error_tool).toEqual({});
    });
  });

  describe('AxSignature tool injection', () => {
    it('should inject tool fields into signature', () => {
      const signature = AxSignature.create('query:string -> answer:string');
      const injected = signature.injectToolFields(mockTools);

      const outputFields = injected.getOutputFields();
      expect(outputFields).toHaveLength(3);

      const fieldNames = outputFields.map((f) => f.name);
      expect(fieldNames).toContain('answer');
      expect(fieldNames).toContain('search_web');
      expect(fieldNames).toContain('calculate');
    });

    it('should not duplicate existing fields', () => {
      const signature = AxSignature.create(
        'query:string -> answer:string, search_web:string'
      );
      const injected = signature.injectToolFields(mockTools);

      const outputFields = injected.getOutputFields();
      const searchFields = outputFields.filter((f) => f.name === 'search_web');
      expect(searchFields).toHaveLength(1);
    });
  });
});
