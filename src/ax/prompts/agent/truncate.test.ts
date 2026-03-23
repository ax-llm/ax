import { describe, expect, it } from 'vitest';

import {
  computeDynamicRuntimeChars,
  MIN_RUNTIME_CHARS,
  RUNTIME_BUDGET_FLOOR_RATIO,
  smartStringify,
  truncateStackTrace,
} from './truncate.js';

describe('computeDynamicRuntimeChars', () => {
  const maxRuntimeChars = 3000;
  const targetPromptChars = 16_000;

  it('returns maxRuntimeChars when action log is empty', () => {
    const result = computeDynamicRuntimeChars(
      [],
      targetPromptChars,
      maxRuntimeChars
    );
    expect(result).toBe(maxRuntimeChars);
  });

  it('returns floor value when action log exceeds budget', () => {
    const entries = [{ code: 'x'.repeat(10_000), output: 'y'.repeat(10_000) }];
    const result = computeDynamicRuntimeChars(
      entries,
      targetPromptChars,
      maxRuntimeChars
    );
    // Floor ratio (0.15 * 3000 = 450) > MIN_RUNTIME_CHARS (400), so floor ratio wins
    expect(result).toBe(
      Math.floor(maxRuntimeChars * RUNTIME_BUDGET_FLOOR_RATIO)
    );
  });

  it('returns minRuntimeChars when floor ratio would go below it', () => {
    // With a small maxRuntimeChars, floor ratio produces < MIN_RUNTIME_CHARS
    const result = computeDynamicRuntimeChars(
      [{ code: 'x'.repeat(10_000), output: 'y'.repeat(10_000) }],
      targetPromptChars,
      500 // 0.15 * 500 = 75 < MIN_RUNTIME_CHARS
    );
    expect(result).toBe(MIN_RUNTIME_CHARS);
  });

  it('scales linearly between max and floor', () => {
    // 50% usage → remainingRatio = 0.5 → 1500
    const entries = [{ code: 'x'.repeat(4000), output: 'y'.repeat(4000) }];
    const result = computeDynamicRuntimeChars(
      entries,
      targetPromptChars,
      maxRuntimeChars
    );
    expect(result).toBe(Math.floor(maxRuntimeChars * 0.5));
  });

  it('respects floor ratio when near budget', () => {
    // 90% usage → remainingRatio = max(0.15, 0.1) = 0.15 → 450
    const entries = [{ code: 'x'.repeat(7200), output: 'y'.repeat(7200) }];
    const result = computeDynamicRuntimeChars(
      entries,
      targetPromptChars,
      maxRuntimeChars
    );
    expect(result).toBe(
      Math.floor(maxRuntimeChars * RUNTIME_BUDGET_FLOOR_RATIO)
    );
  });

  it('handles zero targetPromptChars gracefully', () => {
    const result = computeDynamicRuntimeChars(
      [{ code: 'x', output: 'y' }],
      0,
      maxRuntimeChars
    );
    expect(result).toBe(maxRuntimeChars);
  });

  it('sums across multiple entries', () => {
    const entries = [
      { code: 'a'.repeat(2000), output: 'b'.repeat(2000) },
      { code: 'c'.repeat(2000), output: 'd'.repeat(2000) },
    ];
    // total = 8000, usage = 0.5 → 1500
    const result = computeDynamicRuntimeChars(
      entries,
      targetPromptChars,
      maxRuntimeChars
    );
    expect(result).toBe(Math.floor(maxRuntimeChars * 0.5));
  });
});

describe('smartStringify', () => {
  it('handles null and undefined', () => {
    expect(smartStringify(null, 3000)).toBe('null');
    expect(smartStringify(undefined, 3000)).toBe('undefined');
  });

  it('stringifies small arrays normally', () => {
    const arr = [1, 2, 3];
    const result = smartStringify(arr, 3000);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('truncates large arrays keeping head and tail', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i);
    const result = smartStringify(arr, 3000);
    expect(result).toContain('0');
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('48');
    expect(result).toContain('49');
    expect(result).toContain('45 hidden items');
  });

  it('limits object depth', () => {
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
    const result = smartStringify(deep, 3000);
    expect(result).toContain('[Object]');
    expect(result).not.toContain('"e"');
  });

  it('handles objects at exactly max depth', () => {
    // depth 0: root, depth 1: a, depth 2: b → should still show b's values
    const obj = { a: { b: { c: 'visible' } } };
    const result = smartStringify(obj, 3000);
    expect(result).toContain('visible');
  });

  it('falls back to JSON.stringify for primitives', () => {
    expect(smartStringify(42, 3000)).toBe('42');
    expect(smartStringify(true, 3000)).toBe('true');
    expect(smartStringify('hello', 3000)).toBe('"hello"');
  });

  it('handles error-like objects with stack', () => {
    const err = new Error('test error');
    err.stack = [
      'Error: test error',
      '    at foo (/src/a.ts:1:1)',
      '    at bar (/src/b.ts:2:2)',
      '    at baz (/src/c.ts:3:3)',
      '    at qux (/src/d.ts:4:4)',
      '    at quux (/src/e.ts:5:5)',
      '    at corge (/src/f.ts:6:6)',
      '    at grault (/src/g.ts:7:7)',
    ].join('\n');
    const result = smartStringify(err, 3000);
    // Should keep first 3 frames and last 1
    expect(result).toContain('at foo');
    expect(result).toContain('at bar');
    expect(result).toContain('at baz');
    expect(result).toContain('at grault');
    expect(result).toContain('3 frames hidden');
    expect(result).not.toContain('at qux');
  });

  it('handles arrays with large items', () => {
    const arr = Array.from({ length: 20 }, (_, i) => 'x'.repeat(500) + i);
    const result = smartStringify(arr, 1000);
    expect(result).toContain('15 hidden items');
    // Items should be individually truncated
    expect(result.length).toBeLessThan(2000);
  });
});

describe('truncateStackTrace', () => {
  it('returns short stacks unchanged', () => {
    const stack = [
      'Error: boom',
      '    at foo (/src/a.ts:1:1)',
      '    at bar (/src/b.ts:2:2)',
    ].join('\n');
    expect(truncateStackTrace(stack)).toBe(stack);
  });

  it('compresses long stacks', () => {
    const stack = [
      'Error: boom',
      '    at a (/1:1:1)',
      '    at b (/2:2:2)',
      '    at c (/3:3:3)',
      '    at d (/4:4:4)',
      '    at e (/5:5:5)',
      '    at f (/6:6:6)',
      '    at g (/7:7:7)',
      '    at h (/8:8:8)',
    ].join('\n');
    const result = truncateStackTrace(stack);
    expect(result).toContain('at a');
    expect(result).toContain('at b');
    expect(result).toContain('at c');
    expect(result).toContain('at h');
    expect(result).toContain('4 frames hidden');
    expect(result).not.toContain('at d');
    expect(result).not.toContain('at e');
  });

  it('preserves preamble lines before stack frames', () => {
    const stack = [
      'TypeError: cannot read property',
      'Additional info here',
      '    at foo (/a:1:1)',
      '    at bar (/b:2:2)',
    ].join('\n');
    const result = truncateStackTrace(stack);
    expect(result).toContain('TypeError: cannot read property');
    expect(result).toContain('Additional info here');
  });

  it('returns as-is if no stack frames found', () => {
    const text = 'just a string with no frames';
    expect(truncateStackTrace(text)).toBe(text);
  });
});
