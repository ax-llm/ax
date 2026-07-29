import { describe, expect, it } from 'vitest';

import {
  axMCPDecodeHeaderValue,
  axMCPEncodeHeaderValue,
  axMCPIsPlainHeaderValue,
} from './headerValue.js';

describe('MCP HTTP header values', () => {
  it.each([
    'us-west1',
    'Hello, 世界',
    ' padded ',
    'line1\nline2',
    '=?base64?literal?=',
    'tab\tinside',
  ])('round-trips %j', (value) => {
    expect(axMCPDecodeHeaderValue(axMCPEncodeHeaderValue(value))).toBe(value);
  });

  it('uses the published Base64 sentinel encoding', () => {
    expect(axMCPEncodeHeaderValue('Hello, 世界')).toBe(
      '=?base64?SGVsbG8sIOS4lueVjA==?='
    );
    expect(axMCPEncodeHeaderValue(' padded ')).toBe('=?base64?IHBhZGRlZCA=?=');
  });

  it('re-encodes plain values that look like sentinels', () => {
    const encoded = axMCPEncodeHeaderValue('=?base64?literal?=');
    expect(encoded).toBe('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
    expect(axMCPDecodeHeaderValue(encoded)).toBe('=?base64?literal?=');
  });

  it('accepts only RFC 9110 visible ASCII, space, and interior HTAB', () => {
    expect(axMCPIsPlainHeaderValue('plain value')).toBe(true);
    expect(axMCPIsPlainHeaderValue('tab\tinside')).toBe(true);
    expect(axMCPIsPlainHeaderValue(' leading')).toBe(false);
    expect(axMCPIsPlainHeaderValue('trailing\t')).toBe(false);
    expect(axMCPIsPlainHeaderValue('line\rbreak')).toBe(false);
    expect(axMCPIsPlainHeaderValue('non-ascii-é')).toBe(false);
  });

  it('leaves non-sentinel values unchanged when decoding', () => {
    expect(axMCPDecodeHeaderValue('ordinary')).toBe('ordinary');
  });
});
