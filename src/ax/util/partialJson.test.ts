import { describe, expect, it } from 'vitest';
import { parsePartialJson } from './partialJson.js';

describe('parsePartialJson', () => {
  it('should parse valid JSON', () => {
    expect(parsePartialJson('{"a": 1}').parsed).toEqual({ a: 1 });
    expect(parsePartialJson('[1, 2, 3]').parsed).toEqual([1, 2, 3]);
  });

  it('should return null partialMarker for complete JSON', () => {
    const result = parsePartialJson('{"a": 1}');
    expect(result.partialMarker).toBeNull();
  });

  it('should parse truncated objects', () => {
    expect(parsePartialJson('{"a": 1').parsed).toEqual({ a: 1 });
    expect(parsePartialJson('{"a": 1, "b": 2').parsed).toEqual({ a: 1, b: 2 });
  });

  it('should parse truncated arrays', () => {
    expect(parsePartialJson('[1, 2').parsed).toEqual([1, 2]);
    expect(parsePartialJson('[1, 2,').parsed).toEqual([1, 2]);
  });

  it('should parse truncated strings', () => {
    expect(parsePartialJson('{"a": "hello').parsed).toEqual({ a: 'hello' });
    expect(parsePartialJson('["hello').parsed).toEqual(['hello']);
  });

  it('should parse nested structures', () => {
    expect(parsePartialJson('{"a": {"b": [1').parsed).toEqual({
      a: { b: [1] },
    });
    expect(parsePartialJson('{"a": {"b": [1,').parsed).toEqual({
      a: { b: [1] },
    });
  });

  it('should handle trailing commas', () => {
    expect(parsePartialJson('{"a": 1,}').parsed).toEqual({ a: 1 });
    expect(parsePartialJson('[1, 2,]').parsed).toEqual([1, 2]);
  });

  it('should handle truncated primitives (booleans/null)', () => {
    // These currently fail or return null in the current implementation
    // We want to improve this behavior
    // cspell:disable-next-line
    expect(parsePartialJson('{"a": tru').parsed).toEqual({ a: true });
    // cspell:disable-next-line
    expect(parsePartialJson('{"a": fals').parsed).toEqual({ a: false });
    // cspell:disable-next-line
    expect(parsePartialJson('{"a": nul').parsed).toEqual({ a: null });
  });

  it('should handle escaped characters at the end of string', () => {
    // This is a tricky case
    // "hello\" -> "hello" (if we just append " it becomes "hello"" which is invalid string literal for hello")
    // actually "hello\" means the quote is escaped.
    // If the stream ends at "hello\", it means the string is likely "hello...something"
    // But if we want to close it, we should probably remove the backslash or escape it.
    expect(parsePartialJson('{"a": "hello\\').parsed).toEqual({ a: 'hello' });
  });

  it('should handle truncated numbers', () => {
    expect(parsePartialJson('{"a": 12').parsed).toEqual({ a: 12 });
    expect(parsePartialJson('{"a": 12.3').parsed).toEqual({ a: 12.3 });
    expect(parsePartialJson('{"a": -1').parsed).toEqual({ a: -1 });
    expect(parsePartialJson('{"a": 1e').parsed).toEqual({ a: 1 }); // 1e might be parsed as 1 if we strip trailing chars
    expect(parsePartialJson('[1, 2.5').parsed).toEqual([1, 2.5]);
  });

  it('should handle truncated exponent numbers like 12e+', () => {
    expect(parsePartialJson('{"a": 12e+').parsed).toEqual({ a: 12 });
    expect(parsePartialJson('{"a": 12e-').parsed).toEqual({ a: 12 });
    expect(parsePartialJson('{"a": 12E+').parsed).toEqual({ a: 12 });
  });

  it('should handle unclosed keys', () => {
    // {"key": "value", "newK
    expect(parsePartialJson('{"key": "value", "newK').parsed).toEqual({
      key: 'value',
    });
    // {"key - this is too incomplete, return null
    expect(parsePartialJson('{"key').parsed).toBeNull();
  });

  it('should handle trailing colons (incomplete property values)', () => {
    expect(parsePartialJson('{"name": "John", "age":').parsed).toEqual({
      name: 'John',
    });
    expect(parsePartialJson('{"age":').parsed).toEqual({});
  });

  it('should handle strings with special characters', () => {
    expect(parsePartialJson('{"a": "hello \\"world\\"').parsed).toEqual({
      a: 'hello "world"',
    });
    expect(parsePartialJson('{"a": "line\\nbreak').parsed).toEqual({
      a: 'line\nbreak',
    });
    expect(parsePartialJson('{"a": "\\u0041').parsed).toEqual({ a: 'A' }); // \u0041 is A
  });

  it('should handle deep nesting', () => {
    expect(parsePartialJson('{"a": {"b": {"c": [1, 2').parsed).toEqual({
      a: { b: { c: [1, 2] } },
    });
    expect(parsePartialJson('[[[[').parsed).toEqual([[[[]]]]);
  });

  it('should handle whitespace', () => {
    expect(parsePartialJson('  { "a": 1 }  ').parsed).toEqual({ a: 1 });
    expect(parsePartialJson('{ "a": 1, ').parsed).toEqual({ a: 1 });
  });

  it('should handle empty or near-empty structures', () => {
    expect(parsePartialJson('{').parsed).toEqual({});
    expect(parsePartialJson('[').parsed).toEqual([]);
    expect(parsePartialJson('{"a": [').parsed).toEqual({ a: [] });
  });

  it('should handle tricky string endings', () => {
    // String ending with a backslash that is NOT escaping the quote (e.g. "path\\")
    // If input is `{"path": "C:\\` -> we want `{"path": "C:"}` or `{"path": "C:\\"}`?
    // If the stream stopped at `C:\\`, it might mean the next char is `"` closing it, or another `\`
    // Our current logic removes the last backslash if it's at EOF.
    expect(parsePartialJson('{"a": "ends with backslash \\').parsed).toEqual({
      a: 'ends with backslash ',
    });
  });

  it('should return null for empty or invalid input', () => {
    expect(parsePartialJson('').parsed).toBeNull();
    expect(parsePartialJson('   ').parsed).toBeNull();
    expect(parsePartialJson('invalid').parsed).toBeNull();
    expect(parsePartialJson('{"a": }').parsed).toBeNull(); // Missing value
  });

  describe('partialMarker', () => {
    it('should indicate nesting level for truncated structures', () => {
      const result = parsePartialJson('{"a": {"b": [1');
      expect(result.partialMarker).not.toBeNull();
      expect(result.partialMarker!.nestingLevel).toBe(3); // {, {, [
      expect(result.partialMarker!.inArray).toBe(true);
    });

    it('should indicate we are in an object', () => {
      const result = parsePartialJson('{"a": {"b": 1');
      expect(result.partialMarker).not.toBeNull();
      expect(result.partialMarker!.inObject).toBe(true);
      expect(result.partialMarker!.inArray).toBe(false);
    });

    it('should indicate we are in an array', () => {
      const result = parsePartialJson('[1, 2');
      expect(result.partialMarker).not.toBeNull();
      expect(result.partialMarker!.inArray).toBe(true);
      expect(result.partialMarker!.inObject).toBe(false);
    });

    it('should indicate we are in a string', () => {
      const result = parsePartialJson('{"a": "hello');
      expect(result.partialMarker).not.toBeNull();
      expect(result.partialMarker!.inString).toBe(true);
    });

    it('should detect incomplete array item in nested structure', () => {
      // This simulates the bug scenario: array with incomplete last object
      const result = parsePartialJson(
        '{"appointments": [{"name": "Monday", "date": "2026-01-01"'
      );
      expect(result.parsed).toEqual({
        appointments: [{ name: 'Monday', date: '2026-01-01' }],
      });
      expect(result.partialMarker).not.toBeNull();
      // We're inside: { appointments: [ { <- 3 levels
      expect(result.partialMarker!.nestingLevel).toBe(3);
    });
  });
});
