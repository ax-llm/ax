import { describe, expect, test } from 'vitest';
import { axGlobals } from './globals.js';

describe('axGlobals functionResultFormatter', () => {
  test('should format objects with JSON.stringify(result, null, 2) by default', () => {
    const result = axGlobals.functionResultFormatter({ name: 'John', age: 30 });
    expect(result).toBe('{\n  "name": "John",\n  "age": 30\n}');
  });

  test('should return strings as-is', () => {
    const result = axGlobals.functionResultFormatter('hello world');
    expect(result).toBe('hello world');
  });

  test('should return empty string for null', () => {
    const result = axGlobals.functionResultFormatter(null);
    expect(result).toBe('');
  });

  test('should return empty string for undefined', () => {
    const result = axGlobals.functionResultFormatter(undefined);
    expect(result).toBe('');
  });

  test('should format numbers as JSON', () => {
    const result = axGlobals.functionResultFormatter(42);
    expect(result).toBe('42');
  });

  test('should format arrays as JSON', () => {
    const result = axGlobals.functionResultFormatter([1, 2, 3]);
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });

  test('should allow changing the global formatter', () => {
    const originalFormatter = axGlobals.functionResultFormatter;

    // Change to a custom formatter
    axGlobals.functionResultFormatter = (result: unknown) =>
      `CUSTOM: ${JSON.stringify(result)}`;

    const result = axGlobals.functionResultFormatter({ test: true });
    expect(result).toBe('CUSTOM: {"test":true}');

    // Restore original formatter
    axGlobals.functionResultFormatter = originalFormatter;
  });
});
