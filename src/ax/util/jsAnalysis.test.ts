import { describe, expect, it } from 'vitest';

import { extractReferencedIdentifiers } from '../agent/contextManager.js';
import { hasCompletionSignalCall } from '../agent/runtime.js';
import { stripJsStringsAndComments } from './jsAnalysis.js';

const strip = stripJsStringsAndComments;

describe('stripJsStringsAndComments', () => {
  it('keeps the code after a regex literal that contains a quote', () => {
    const code = [
      "const quote = /'/;",
      'const answer = final({ ok: 1 });',
    ].join('\n');

    expect(strip(code)).toContain('final({ ok: 1 })');
    expect(strip(code)).toContain('const answer =');
  });

  it('keeps the code after a character-class regex', () => {
    const code = ['const re = /["\']/;', 'respond({ ok: 1 });'].join('\n');

    expect(strip(code)).toContain('respond({ ok: 1 })');
  });

  it('keeps the code after a regex whose class holds a comment opener', () => {
    const code = [
      'const re = /[/*]/;',
      'const answer = final({ ok: 1 });',
    ].join('\n');

    expect(strip(code)).toContain('final({ ok: 1 })');
  });

  it('reads an escaped slash and flags as part of the pattern', () => {
    const code = [
      'const path = /a\\/b/gi;',
      'const answer = final({ ok: 1 });',
    ].join('\n');

    expect(strip(code)).toContain('final({ ok: 1 })');
    expect(strip(code)).not.toContain('a\\/b');
  });

  it('does not read division as a regex', () => {
    const code = [
      'const half = total / 2;',
      'const answer = final({ ok: 1 });',
    ].join('\n');

    expect(strip(code)).toContain('total / 2');
    expect(strip(code)).toContain('final({ ok: 1 })');
  });

  it('does not read a division chain as a regex', () => {
    const code = ['const ratio = a / b / c;', 'final({ ok: 1 });'].join('\n');

    expect(strip(code)).toContain('a / b / c');
    expect(strip(code)).toContain('final({ ok: 1 })');
  });

  it('still blanks string literals and comments', () => {
    const code = [
      '// note',
      'const s = "text";',
      '/* block */',
      'const n = 1;',
    ].join('\n');

    const result = strip(code);
    expect(result).not.toContain('note');
    expect(result).not.toContain('text');
    expect(result).not.toContain('block');
    expect(result).toContain('const n = 1;');
  });

  it('preserves the length of the input so offsets stay comparable', () => {
    const code = ['const quote = /"/;', 'const s = "x";', 'f(1);'].join('\n');

    expect(strip(code)).toHaveLength(code.length);
  });
});

describe('callers that depend on the sanitized code', () => {
  it('sees a completion call that follows a quote-bearing regex', () => {
    const code = ["const quote = /'/;", 'return final({ answer: 42 });'].join(
      '\n'
    );

    expect(hasCompletionSignalCall(code)).toBe(true);
  });

  it('keeps identifiers declared after a quote-bearing regex', () => {
    const code = [
      "const quote = /'/;",
      'const parsed = JSON.parse(payload);',
    ].join('\n');

    const identifiers = extractReferencedIdentifiers(code);
    expect(identifiers.has('JSON')).toBe(true);
    expect(identifiers.has('parse')).toBe(true);
    expect(identifiers.has('payload')).toBe(true);
  });
});
