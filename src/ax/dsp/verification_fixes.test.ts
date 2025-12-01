import { describe, expect, it } from 'vitest';
import { validateAndParseFieldValue } from './extract.js';

describe('Verification of Fixes', () => {
  it('should parse markdown list of JSON strings for object array', () => {
    const field = {
      name: 'items',
      title: 'Items',
      description: 'List of items',
      type: {
        name: 'object',
        isArray: true,
        fields: { id: { type: 'number' }, name: { type: 'string' } },
      },
    };

    // Simulate LLM outputting a markdown list where each item is a JSON string
    // Note: parseMarkdownList currently only supports single-line items, so we use single-line code blocks
    const value = `
- \`\`\`json {"id": 1, "name": "Item 1"} \`\`\`
- {"id": 2, "name": "Item 2"}
`;

    // @ts-ignore - validateAndParseFieldValue is internal but exported
    const result = validateAndParseFieldValue(field, value);

    expect(result).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
    ]);
  });

  it('should parse markdown list of JSON strings for json array', () => {
    const field = {
      name: 'data',
      title: 'Data',
      description: 'List of data',
      type: { name: 'json', isArray: true },
    };

    const value = `
- {"key": "value1"}
- \`\`\`json {"key": "value2"} \`\`\`
`;

    // @ts-ignore
    const result = validateAndParseFieldValue(field, value);

    expect(result).toEqual([{ key: 'value1' }, { key: 'value2' }]);
  });

  it('should return raw string for invalid JSON in markdown list (lenient parsing)', () => {
    const field = {
      name: 'items',
      title: 'Items',
      description: 'List of items',
      type: {
        name: 'object',
        isArray: true,
        fields: { id: { type: 'number' } },
      },
    };

    const value = `
- {invalid json}
`;

    // @ts-ignore
    const result = validateAndParseFieldValue(field, value);

    // It should return the string as is, because JSON.parse failed and it swallowed the error
    expect(result).toEqual(['{invalid json}']);
  });
});
