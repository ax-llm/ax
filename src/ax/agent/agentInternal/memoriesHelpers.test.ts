import { describe, expect, it } from 'vitest';
import {
  mergeMemoryResults,
  normalizeMemoriesInput,
} from './memoriesHelpers.js';

describe('normalizeMemoriesInput', () => {
  it('accepts a single string', () => {
    expect(normalizeMemoriesInput('user prefs')).toEqual(['user prefs']);
  });

  it('trims whitespace', () => {
    expect(normalizeMemoriesInput('  user prefs  ')).toEqual(['user prefs']);
  });

  it('accepts an array of strings', () => {
    expect(normalizeMemoriesInput(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('dedupes entries', () => {
    expect(normalizeMemoriesInput(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('rejects empty arrays', () => {
    expect(() => normalizeMemoriesInput([])).toThrow(/at least one/);
  });

  it('rejects empty strings', () => {
    expect(() => normalizeMemoriesInput('')).toThrow(/non-empty strings/);
    expect(() => normalizeMemoriesInput(['  '])).toThrow(/non-empty strings/);
  });

  it('rejects non-string entries', () => {
    expect(() => normalizeMemoriesInput([1] as unknown[])).toThrow(
      /string or string\[\]/
    );
    expect(() => normalizeMemoriesInput(42 as unknown)).toThrow(
      /string or string\[\]/
    );
    expect(() => normalizeMemoriesInput(null as unknown)).toThrow(
      /string or string\[\]/
    );
  });
});

describe('mergeMemoryResults', () => {
  it('merges incoming into existing, sorted by id', () => {
    const result = mergeMemoryResults(
      [{ id: 'b', content: 'B' }],
      [{ id: 'a', content: 'A' }]
    );
    expect(result).toEqual([
      { id: 'a', content: 'A' },
      { id: 'b', content: 'B' },
    ]);
  });

  it('dedupes by id, last write wins', () => {
    const result = mergeMemoryResults(
      [{ id: 'a', content: 'old' }],
      [{ id: 'a', content: 'new' }]
    );
    expect(result).toEqual([{ id: 'a', content: 'new' }]);
  });

  it('treats undefined existing as empty', () => {
    expect(mergeMemoryResults(undefined, [{ id: 'a', content: 'A' }])).toEqual([
      { id: 'a', content: 'A' },
    ]);
  });

  it('skips malformed entries', () => {
    const result = mergeMemoryResults(
      [],
      [
        { id: 'a', content: 'A' },
        { id: '', content: 'empty id' },
        { id: 'b', content: null as unknown as string },
        null as unknown as { id: string; content: string },
      ]
    );
    expect(result).toEqual([{ id: 'a', content: 'A' }]);
  });

  it('trims ids', () => {
    const result = mergeMemoryResults([], [{ id: '  a  ', content: 'A' }]);
    expect(result).toEqual([{ id: 'a', content: 'A' }]);
  });
});
