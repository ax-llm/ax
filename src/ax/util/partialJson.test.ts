import { describe, expect, it } from 'vitest';
import { parsePartialJson } from './partialJson.js';

describe('parsePartialJson', () => {
  it('should parse valid JSON', () => {
    expect(parsePartialJson('{"a": 1}')).toEqual({ a: 1 });
    expect(parsePartialJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('should parse truncated objects', () => {
    expect(parsePartialJson('{"a": 1')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a": 1, "b": 2')).toEqual({ a: 1, b: 2 });
  });

  it('should parse truncated arrays', () => {
    expect(parsePartialJson('[1, 2')).toEqual([1, 2]);
    expect(parsePartialJson('[1, 2,')).toEqual([1, 2]);
  });

  it('should parse truncated strings', () => {
    expect(parsePartialJson('{"a": "hello')).toEqual({ a: 'hello' });
    expect(parsePartialJson('["hello')).toEqual(['hello']);
  });

  it('should parse nested structures', () => {
    expect(parsePartialJson('{"a": {"b": [1')).toEqual({ a: { b: [1] } });
    expect(parsePartialJson('{"a": {"b": [1,')).toEqual({ a: { b: [1] } });
  });

  it('should handle trailing commas', () => {
    expect(parsePartialJson('{"a": 1,}')).toEqual({ a: 1 });
    expect(parsePartialJson('[1, 2,]')).toEqual([1, 2]);
  });

  it('should handle truncated primitives (booleans/null)', () => {
    // These currently fail or return null in the current implementation
    // We want to improve this behavior
    // cspell:disable-next-line
    expect(parsePartialJson('{"a": tru')).toEqual({ a: true });
    // cspell:disable-next-line
    expect(parsePartialJson('{"a": fals')).toEqual({ a: false });
    // cspell:disable-next-line
    expect(parsePartialJson('{"a": nul')).toEqual({ a: null });
  });

  it('should handle escaped characters at the end of string', () => {
    // This is a tricky case
    // "hello\" -> "hello" (if we just append " it becomes "hello"" which is invalid string literal for hello")
    // actually "hello\" means the quote is escaped.
    // If the stream ends at "hello\", it means the string is likely "hello...something"
    // But if we want to close it, we should probably remove the backslash or escape it.
    expect(parsePartialJson('{"a": "hello\\')).toEqual({ a: 'hello' });
  });

  it('should handle truncated numbers', () => {
    expect(parsePartialJson('{"a": 12')).toEqual({ a: 12 });
    expect(parsePartialJson('{"a": 12.3')).toEqual({ a: 12.3 });
    expect(parsePartialJson('{"a": -1')).toEqual({ a: -1 });
    expect(parsePartialJson('{"a": 1e')).toEqual({ a: 1 }); // 1e might be parsed as 1 if we strip trailing chars
    expect(parsePartialJson('[1, 2.5')).toEqual([1, 2.5]);
  });

  it('should handle unclosed keys', () => {
    // {"key": "value", "newK
    expect(parsePartialJson('{"key": "value", "newK')).toEqual({
      key: 'value',
    });
    // {"key - this is too incomplete, return null
    expect(parsePartialJson('{"key')).toBeNull();
  });

  it('should handle strings with special characters', () => {
    expect(parsePartialJson('{"a": "hello \\"world\\"')).toEqual({
      a: 'hello "world"',
    });
    expect(parsePartialJson('{"a": "line\\nbreak')).toEqual({
      a: 'line\nbreak',
    });
    expect(parsePartialJson('{"a": "\\u0041')).toEqual({ a: 'A' }); // \u0041 is A
  });

  it('should handle deep nesting', () => {
    expect(parsePartialJson('{"a": {"b": {"c": [1, 2')).toEqual({
      a: { b: { c: [1, 2] } },
    });
    expect(parsePartialJson('[[[[')).toEqual([[[[]]]]);
  });

  it('should handle whitespace', () => {
    expect(parsePartialJson('  { "a": 1 }  ')).toEqual({ a: 1 });
    expect(parsePartialJson('{ "a": 1, ')).toEqual({ a: 1 });
  });

  it('should handle empty or near-empty structures', () => {
    expect(parsePartialJson('{')).toEqual({});
    expect(parsePartialJson('[')).toEqual([]);
    expect(parsePartialJson('{"a": [')).toEqual({ a: [] });
  });

  it('should handle tricky string endings', () => {
    // String ending with a backslash that is NOT escaping the quote (e.g. "path\\")
    // If input is `{"path": "C:\\` -> we want `{"path": "C:"}` or `{"path": "C:\\"}`?
    // If the stream stopped at `C:\\`, it might mean the next char is `"` closing it, or another `\`
    // Our current logic removes the last backslash if it's at EOF.
    expect(parsePartialJson('{"a": "ends with backslash \\')).toEqual({
      a: 'ends with backslash ',
    });
  });

  it('should return null for empty or invalid input', () => {
    expect(parsePartialJson('')).toBeNull();
    expect(parsePartialJson('   ')).toBeNull();
    expect(parsePartialJson('invalid')).toBeNull();
    expect(parsePartialJson('{"a": }')).toBeNull(); // Missing value
  });
});
