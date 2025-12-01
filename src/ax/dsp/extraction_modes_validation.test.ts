import { describe, expect, it } from 'vitest';
import { extractValues } from './extract.js';
import { f } from './sig.js';

describe('Key-Value vs JSON Extraction Modes', () => {
  describe('Key-Value Format (hasComplexFields = false)', () => {
    it('should extract simple string fields with key-value format', () => {
      const signature = f()
        .input('userQuery', f.string())
        .output('answerText', f.string())
        .build();

      const values: Record<string, unknown> = {};
      const content = 'Answer Text: This is a simple response';

      extractValues(signature, values, content);

      expect(values).toEqual({
        answerText: 'This is a simple response',
      });
    });

    it('should extract multiple fields with key-value format', () => {
      const signature = f()
        .input('query', f.string())
        .output('answer', f.string())
        .output('confidence', f.number())
        .build();

      const values: Record<string, unknown> = {};
      const content = `Answer: The answer is 42
Confidence: 0.95`;

      extractValues(signature, values, content);

      expect(values).toEqual({
        answer: 'The answer is 42',
        confidence: 0.95,
      });
    });

    it('should extract array fields with JSON format in key-value mode', () => {
      const signature = f()
        .input('query', f.string())
        .output('items', f.string().array())
        .build();

      const values: Record<string, unknown> = {};
      const content = 'Items: ["apple", "banana", "cherry"]';

      extractValues(signature, values, content);

      expect(values).toEqual({
        items: ['apple', 'banana', 'cherry'],
      });
    });

    it('should extract array fields with markdown list in key-value mode', () => {
      const signature = f()
        .input('query', f.string())
        .output('items', f.string().array())
        .build();

      const values: Record<string, unknown> = {};
      const content = `Items:
- apple
- banana
- cherry`;

      extractValues(signature, values, content);

      expect(values).toEqual({
        items: ['apple', 'banana', 'cherry'],
      });
    });

    it('should extract object array with JSON strings in markdown list (key-value mode)', () => {
      const signature = f()
        .input('query', f.string())
        .output(
          'people',
          f.object({ name: f.string(), age: f.number() }).array()
        )
        .build();

      const values: Record<string, unknown> = {};
      // Simulate LLM output with markdown list of JSON objects on single lines
      const content = `People:
- \`\`\`json {"name": "Alice", "age": 30} \`\`\`
- {"name": "Bob", "age": 25}`;

      extractValues(signature, values, content);

      expect(values).toEqual({
        people: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      });
    });
  });

  describe('JSON Format (hasComplexFields = true)', () => {
    it('should work with structured outputs flag', () => {
      const signature = f()
        .input('userQuery', f.string())
        .output('aiResponse', f.string())
        .useStructured()
        .build();

      // When hasComplexFields is true, the system expects JSON output
      expect(signature.hasComplexFields()).toBe(true);
    });

    it('should NOT parse object fields in key-value extraction', () => {
      // Note: Individual object fields (not arrays) trigger hasComplexFields=true,
      // so in practice, the LLM would output JSON format, not key-value format.
      // This test demonstrates that extractValues doesn't parse objects from strings
      const signature = f()
        .input('query', f.string())
        .output(
          'analysisData',
          f.object({ name: f.string(), count: f.number() })
        )
        .build();

      // Verify this triggers complex fields mode
      expect(signature.hasComplexFields()).toBe(true);

      const values: Record<string, unknown> = {};
      const content = 'Analysis Data: {"name": "test", "count": 42}';

      extractValues(signature, values, content);

      // extractValues doesn't parse object JSON strings - that's done by parsePartialJson
      // in processResponse.ts when hasComplexFields=true
      expect(values).toEqual({
        analysisData: '{"name": "test", "count": 42}',
      });
    });

    it('should extract array of objects in non-structured mode', () => {
      const signature = f()
        .input('query', f.string())
        .output(
          'items',
          f.object({ id: f.number(), label: f.string() }).array()
        )
        .build();

      const values: Record<string, unknown> = {};
      // This will trigger hasComplexFields = true, but extractValues still uses key-value parsing
      // The LLM should output after "Items:" prefix
      const content =
        'Items: [{"id": 1, "label": "A"}, {"id": 2, "label": "B"}]';

      extractValues(signature, values, content);

      expect(values).toEqual({
        items: [
          { id: 1, label: 'A' },
          { id: 2, label: 'B' },
        ],
      });
    });

    it('should handle top-level array output (structured mode)', () => {
      // In structured mode with only one output field that's an array,
      // the LLM might return the array directly without a wrapper
      const signature = f()
        .input('documentText', f.string())
        .output(
          'people',
          f.object({ name: f.string(), age: f.number() }).array()
        )
        .build();

      const values: Record<string, unknown> = {};
      // When there's only one field, extractValues can handle raw JSON array
      const content = JSON.stringify([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);

      extractValues(signature, values, content);

      expect(values).toEqual({
        people: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
      });
    });
  });

  describe('Edge Cases and Compatibility', () => {
    it('should handle code blocks in string arrays (preserve as-is)', () => {
      const signature = f()
        .input('query', f.string())
        .output('items', f.string().array())
        .build();

      const values: Record<string, unknown> = {};
      const content = `Items:
- plain text
- \`\`\`json "json string" \`\`\`
- another plain text`;

      extractValues(signature, values, content);

      // For string arrays, code blocks should be preserved as-is
      // Only object/json types get JSON extraction treatment
      expect(values).toEqual({
        items: [
          'plain text',
          '```json "json string" ```',
          'another plain text',
        ],
      });
    });

    it('should not break existing key-value extraction for simple types', () => {
      const signature = f()
        .input('question', f.string())
        .output('answer', f.string())
        .output('isConfident', f.boolean())
        .output('score', f.number())
        .build();

      const values: Record<string, unknown> = {};
      const content = `Answer: The sky is blue
Is Confident: true
Score: 9.5`;

      extractValues(signature, values, content);

      expect(values).toEqual({
        answer: 'The sky is blue',
        isConfident: true,
        score: 9.5,
      });
    });
  });
});
