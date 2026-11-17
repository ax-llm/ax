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

describe('regex versus division token context', () => {
  const values = [
    'count++',
    'count--',
    '++count',
    '--count',
    '"12"',
    "'12'",
    '`12`',
    '/pattern/',
    '{}',
    'function () {}',
    'obj.of',
    'obj.return',
    'obj.#return',
    String.raw`\u{61}return`,
    String.raw`\u0061return`,
    'obj?.throw',
    'obj./* comment */in',
    'of',
    'yield',
    'await',
    // cspell:ignore πreturn 𐐀return
    'πreturn',
    '𐐀return',
    '1e-3',
    '12n',
    '(count)',
    'items[0]',
  ];

  it.each(values)('preserves division after %s', (value) => {
    const code = `const ratio = ${value} / denominator / 2;`;
    const sanitized = strip(code);
    expect(sanitized).toContain('/ denominator / 2');
    expect(sanitized).toHaveLength(code.length);
    expect(extractReferencedIdentifiers(code).has('denominator')).toBe(true);
    expect(
      hasCompletionSignalCall(
        `const ratio = ${value} / final({ answer: 42 }) / 2;`
      )
    ).toBe(true);
  });

  it.each([
    '=\n',
    '= /* comment */',
    '= // comment\n',
    '= +',
    '= !',
    '= typeof',
    '= void',
    '= value /',
  ])('blanks a regex after %s', (prefix) => {
    const code = `const pattern ${prefix} /["']/; final({ answer: payload });`;
    expect(strip(code)).not.toContain('["\']');
    expect(hasCompletionSignalCall(code)).toBe(true);
    expect(extractReferencedIdentifiers(code).has('payload')).toBe(true);
  });

  it('does not expose calls or identifiers inside regex literals', () => {
    const code = 'const pattern = /final(payload)|respond(other)/gi;';
    expect(hasCompletionSignalCall(code)).toBe(false);
    expect(extractReferencedIdentifiers(code).has('payload')).toBe(false);
  });

  it('keeps token context across comments and line breaks', () => {
    const code = 'const ratio = "12" /* note */\n / final({ answer: 42 }) / 2;';
    expect(hasCompletionSignalCall(code)).toBe(true);
    expect(strip(code).split('\n')).toHaveLength(2);
  });
});

describe('unterminated regex recovery', () => {
  it.each(['\n', '\r', '\u2028', '\u2029'])(
    'does not consume code across a line terminator %j',
    (newline) => {
      for (const backslash of ['', '\\']) {
        const code = `const pattern = /unterminated${backslash}${newline}final({ answer: 42 }); /`;
        expect(strip(code)).toContain('final({ answer: 42 })');
        expect(strip(code)).toHaveLength(code.length);
      }
    }
  );
});
