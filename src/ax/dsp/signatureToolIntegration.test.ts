import { describe, it, expect } from 'vitest';

import type { AxFunction } from '../ai/types.js';
import { SignatureToolCallingManager } from './signatureToolCalling.js';
import { AxSignature } from './sig.js';

describe('Signature Tool Calling Integration', () => {
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
      } as const,
      func: async (args: { query: string }) => `Results for: ${args.query}`,
    },
  ];

  it('should integrate signature tool calling end-to-end with dot notation', () => {
    // Test signature injection
    const signature = AxSignature.create('query:string -> answer:string');
    const injected = signature.injectToolFields(mockTools);

    const fields = injected.getOutputFields();
    expect(fields.length).toBeGreaterThan(1);
    expect(fields.map((f) => f.name)).toContain('answer');
    expect(fields.map((f) => f.name)).toContain('search_web_query');

    // Test tool fields are optional
    const searchField = fields.find((f) => f.name === 'search_web_query');
    expect(searchField?.isOptional).toBe(true);
  });

  it('should handle tool routing correctly with dot notation', async () => {
    const manager = new SignatureToolCallingManager({
      signatureToolCalling: true,
      functions: mockTools,
    });

    // Test with populated tool field
    const results1 = {
      answer: 'Here is your answer',
      search_web_query: 'test',
    };

    const processed1 = await manager.processResults(results1);
    expect(processed1.answer).toBe('Here is your answer');
    expect(processed1.search_web_query).toBe('test');

    // Test without populated tool field
    const results2 = {
      answer: 'Here is your answer',
    };

    const processed2 = await manager.processResults(results2);
    expect(processed2.answer).toBe('Here is your answer');
    expect(processed2.search_web_query).toBeUndefined();
  });

  it('should handle field name sanitization correctly', () => {
    const signature = AxSignature.create(
      'queryText:string -> responseText:string'
    );

    // Test private methods via public interface
    const tools: AxFunction[] = [
      {
        name: 'camelCaseTool',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        func: async () => '',
      },
      {
        name: 'snake_case_tool',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        func: async () => '',
      },
      {
        name: 'PascalCaseTool',
        description: 'Test',
        parameters: { type: 'object', properties: {} },
        func: async () => '',
      },
    ];

    const injected = signature.injectToolFields(tools);
    const fieldNames = injected.getOutputFields().map((f) => f.name);

    expect(fieldNames).toContain('responseText');
    expect(fieldNames).toContain('camel_case_tool');
    expect(fieldNames).toContain('snake_case_tool');
    expect(fieldNames).toContain('pascal_case_tool');
  });

  it('should handle empty tools gracefully', () => {
    const signature = AxSignature.create('query:string -> answer:string');
    const injected = signature.injectToolFields([]);

    expect(injected.getOutputFields()).toHaveLength(1);
    expect(injected.getOutputFields()[0].name).toBe('answer');
  });
});
