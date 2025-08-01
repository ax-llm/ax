import { describe, it, expect } from 'vitest';

import type { AxFunction } from '../ai/types.js';
import { AxSignature } from './sig.js';

describe('Signature Tool Dot Notation', () => {
  describe('Nested Parameter Injection', () => {
    it('should inject nested object parameters with dot notation', () => {
      const tool: AxFunction = {
        name: 'searchWeb',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            filters: {
              type: 'object',
              properties: {
                dateRange: { type: 'string', description: 'Date range' },
                category: { type: 'string', description: 'Category filter' },
              },
              description: 'Search filters',
            },
          },
          required: ['query'],
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchTask:string -> searchResult:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldNames = fields.map((f) => f.name);

      expect(fieldNames).toContain('searchResult');
      expect(fieldNames).toContain('search_web_query');
      expect(fieldNames).toContain('search_web_filters_date_range');
      expect(fieldNames).toContain('search_web_filters_category');
    });

    it('should handle arrays with dot notation', () => {
      const tool: AxFunction = {
        name: 'processItems',
        description: 'Process multiple items',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Item name' } as any,
                  value: { type: 'number', description: 'Item value' } as any,
                },
                description: 'Item object' as any,
              } as any,
              description: 'Array of items' as any,
            },
          },
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldNames = fields.map((f) => f.name);

      expect(fieldNames).toContain('searchResponseText');
      expect(fieldNames).toContain('process_items_items');
    });

    it('should handle required vs optional parameters', () => {
      const tool: AxFunction = {
        name: 'complexTool',
        description: 'Complex tool with mixed requirements',
        parameters: {
          type: 'object',
          properties: {
            requiredParam: {
              type: 'string',
              description: 'Required parameter',
            } as any,
            optionalParam: {
              type: 'number',
              description: 'Optional parameter',
            } as any,
            nested: {
              type: 'object',
              properties: {
                requiredNested: {
                  type: 'boolean',
                  description: 'Required nested parameter',
                } as any,
                optionalNested: {
                  type: 'string',
                  description: 'Optional nested parameter',
                } as any,
              },
              required: ['requiredNested'],
              description: 'Nested object' as any,
            } as any,
          },
          required: ['requiredParam'],
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldMap = new Map(fields.map((f) => [f.name, f]));

      expect(fieldMap.get('complex_tool_required_param')?.isOptional).toBe(
        true
      );
      expect(fieldMap.get('complex_tool_optional_param')?.isOptional).toBe(
        true
      );
      expect(
        fieldMap.get('complex_tool_nested_required_nested')?.isOptional
      ).toBe(true);
      expect(
        fieldMap.get('complex_tool_nested_optional_nested')?.isOptional
      ).toBe(true);
    });

    it('should handle deeply nested objects', () => {
      const tool: AxFunction = {
        name: 'deepTool',
        description: 'Deeply nested parameters',
        parameters: {
          type: 'object',
          properties: {
            level1: {
              type: 'object',
              properties: {
                level2: {
                  type: 'object',
                  properties: {
                    level3: {
                      type: 'object',
                      properties: {
                        value: { type: 'string', description: 'Deep value' },
                      },
                      description: 'Level 3 object',
                    },
                  },
                  description: 'Level 2 object',
                },
              },
              description: 'Level 1 object',
            },
          },
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldNames = fields.map((f) => f.name);

      expect(fieldNames).toContain('deep_tool_level1_level2_level3_value');
    });

    it('should handle primitive types correctly', () => {
      const tool: AxFunction = {
        name: 'primitiveTool',
        description: 'Tool with primitive types',
        parameters: {
          type: 'object',
          properties: {
            stringParam: { type: 'string', description: 'String parameter' },
            numberParam: { type: 'number', description: 'Number parameter' },
            booleanParam: {
              type: 'boolean',
              description: 'Boolean parameter',
            } as any,
            stringArray: {
              type: 'array',
              items: { type: 'string', description: 'String item' } as any,
              description: 'String array' as any,
            } as any,
            numberArray: {
              type: 'array',
              items: { type: 'number', description: 'Number item' } as any,
              description: 'Number array' as any,
            } as any,
          },
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldMap = new Map(fields.map((f) => [f.name, f]));

      // Use type assertion to bypass TypeScript checking for test
      const stringField = fieldMap.get('primitive_tool_string_param') as any;
      const numberField = fieldMap.get('primitive_tool_number_param') as any;
      const booleanField = fieldMap.get('primitive_tool_boolean_param') as any;
      const arrayField = fieldMap.get('primitive_tool_string_array') as any;

      expect(stringField?.type.name).toBe('string');
      expect(numberField?.type.name).toBe('number');
      expect(booleanField?.type.name).toBe('boolean');
      expect(arrayField?.type.name).toBe('string');
      expect(arrayField?.type.isArray).toBe(true);
    });

    it('should sanitize field names correctly', () => {
      const tool: AxFunction = {
        name: 'ComplexToolName',
        description: 'Tool with complex name',
        parameters: {
          type: 'object',
          properties: {
            paramWithDashes: {
              type: 'string',
              description: 'Parameter with dashes',
            } as any,
            paramWithDots: {
              type: 'string',
              description: 'Parameter with dots',
            } as any,
          },
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldNames = fields.map((f) => f.name);

      expect(fieldNames).toContain('complex_tool_name_param_with_dashes');
      expect(fieldNames).toContain('complex_tool_name_param_with_dots');
    });

    it('should handle tools without parameters gracefully', () => {
      const tool: AxFunction = {
        name: 'noParamTool',
        description: 'Tool without parameters',
        func: async () => 'result',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldNames = fields.map((f) => f.name);

      expect(fieldNames).toContain('searchResponseText');
      expect(fieldNames).toContain('no_param_tool');
    });

    it('should maintain field order and descriptions', () => {
      const tool: AxFunction = {
        name: 'orderTool',
        description: 'Tool to test order',
        parameters: {
          type: 'object',
          properties: {
            first: { type: 'string', description: 'First parameter' },
            second: { type: 'number', description: 'Second parameter' },
            third: { type: 'boolean', description: 'Third parameter' },
          },
          required: ['first'],
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldMap = new Map(fields.map((f) => [f.name, f]));

      expect(fieldMap.get('order_tool_first')?.description).toBe(
        'First parameter'
      );
      expect(fieldMap.get('order_tool_second')?.description).toBe(
        'Second parameter'
      );
      expect(fieldMap.get('order_tool_third')?.description).toBe(
        'Third parameter'
      );
    });
  });

  describe('Dot Notation Validation', () => {
    it('should validate dot notation field names', () => {
      const tool: AxFunction = {
        name: 'testTool',
        description: 'Test tool',
        parameters: {
          type: 'object',
          properties: {
            'user.name': { type: 'string', description: 'User name' },
            'config.timeout': { type: 'number', description: 'Config timeout' },
          },
        },
        func: async () => '',
      };

      const signature = AxSignature.create(
        'searchRequestText:string -> searchResponseText:string'
      );
      const injected = signature.injectToolFields([tool]);

      const fields = injected.getOutputFields();
      const fieldNames = fields.map((f) => f.name);

      // Should sanitize dots to underscores
      expect(fieldNames).toContain('test_tool_user_name');
      expect(fieldNames).toContain('test_tool_config_timeout');
    });
  });
});
