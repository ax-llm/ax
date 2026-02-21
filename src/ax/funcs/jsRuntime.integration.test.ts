import { describe, expect, it } from 'vitest';

import { AxJSRuntime } from './jsRuntime.js';

describe('AxJSRuntime integration', () => {
  it('returns persisted value from a standalone sync return snippet', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      await expect(session.execute('var summaries = ["a", "b"]')).resolves.toBe(
        undefined
      );
      await expect(session.execute('return summaries')).resolves.toEqual([
        'a',
        'b',
      ]);
    } finally {
      session.close();
    }
  });

  it('returns persisted value from a standalone sync return snippet with semicolon', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      await expect(
        session.execute('var summaries = ["chapter 1", "chapter 2"]')
      ).resolves.toBe(undefined);
      await expect(session.execute('return summaries;')).resolves.toEqual([
        'chapter 1',
        'chapter 2',
      ]);
    } finally {
      session.close();
    }
  });

  it('does not rewrite non-standalone return code', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute('return summaries; summaries');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^SyntaxError: /);
      expect(result).toContain('Illegal return statement');
    } finally {
      session.close();
    }
  });

  it('auto-returns trailing async expression even when "return" appears in a string', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      await expect(
        session.execute('x = await Promise.resolve("return token"); x')
      ).resolves.toBe('return token');
    } finally {
      session.close();
    }
  });

  it('does not inject async auto-return for declaration-style trailing lines', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      await expect(
        session.execute('x = await Promise.resolve(1);\nconst y = 2')
      ).resolves.toBe(undefined);
    } finally {
      session.close();
    }
  });

  it('SyntaxError in executed code resolves with fix message (not reject)', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute('const x = ;');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^SyntaxError: /);
      expect(result.length).toBeGreaterThan(10);
    } finally {
      session.close();
    }
  });

  it('TypeError in executed code resolves with fix message (not reject)', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute('null.foo');
      expect(result).toMatch(/^TypeError: /);
      expect(result).toContain('null');
    } finally {
      session.close();
    }
  });

  it('ReferenceError in executed code resolves with fix message (not reject)', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute('x');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^ReferenceError: /);
    } finally {
      session.close();
    }
  });

  it('RangeError in executed code resolves with fix message (not reject)', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute('new Array(-1)');
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^RangeError: /);
    } finally {
      session.close();
    }
  });

  it('thrown Error (non-code-error) in worker preserves name and message when caught', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const err = await session
        .execute(
          'const e = new Error("custom"); e.name = "CustomError"; throw e'
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('CustomError');
      expect(err.message).toBe('custom');
    } finally {
      session.close();
    }
  });

  it('thrown error with custom name preserves name when caught', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const err = await session
        .execute(
          'throw (function(){ const e = new Error("wait"); e.name = "WaitForUserActionError"; return e; })()'
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('WaitForUserActionError');
      expect(err.message).toBe('wait');
    } finally {
      session.close();
    }
  });

  it('thrown error with cause preserves cause when caught', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const err = await session
        .execute('throw new Error("outer", { cause: new Error("inner") })')
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('outer');
      const cause = (err as Error & { cause?: Error }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect(cause!.message).toBe('inner');
    } finally {
      session.close();
    }
  });

  it('thrown error with data field preserves data when caught', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const err = await session
        .execute(
          'const e = new Error("oops"); e.name = "CustomError"; e.data = { foo: 1, bar: [2, 3] }; throw e'
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('CustomError');
      expect(err.message).toBe('oops');
      const data = (err as Error & { data?: unknown }).data;
      expect(data).toEqual({ foo: 1, bar: [2, 3] });
    } finally {
      session.close();
    }
  });

  it('catch pattern from skill: e.name, e.message, e.data all available', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    let caughtName: string | null = null;
    let caughtMessage: string | null = null;
    let caughtData: unknown = null;
    try {
      await session.execute(
        'const e = new Error("wait for user"); e.name = "WaitForUserActionError"; e.data = { action: "confirm", id: 1 }; throw e'
      );
    } catch (e) {
      if (e instanceof Error) {
        caughtName = e.name;
        caughtMessage = e.message;
        caughtData = (e as Error & { data?: unknown }).data;
      }
    } finally {
      session.close();
    }
    expect(caughtName).toBe('WaitForUserActionError');
    expect(caughtMessage).toBe('wait for user');
    expect(caughtData).toEqual({ action: 'confirm', id: 1 });
  });

  it('async code ending with a single-line comment does not produce SyntaxError', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        'x = await Promise.resolve(42)\n// trailing comment'
      );
      expect(result).toBe(42);
    } finally {
      session.close();
    }
  });

  it('async code with trailing comment still auto-returns the expression above', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        'var v = await Promise.resolve("hello");\nv\n// done'
      );
      expect(result).toBe('hello');
    } finally {
      session.close();
    }
  });

  it('async code with multiple trailing comment lines auto-returns correctly', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        'await Promise.resolve(99)\n// comment 1\n// comment 2\n'
      );
      expect(result).toBe(99);
    } finally {
      session.close();
    }
  });

  it('async code with inline comment (no semicolon) auto-returns correctly', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        'x = await Promise.resolve(7) // inline note'
      );
      expect(result).toBe(7);
    } finally {
      session.close();
    }
  });

  it('async code with inline comment after semicolon auto-returns correctly', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        'result = await Promise.resolve(5); // a note'
      );
      expect(result).toBe(5);
    } finally {
      session.close();
    }
  });

  it('auto-returns multiline awaited call expression', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute('await Promise.resolve(\n  7\n)');
      expect(result).toBe(7);
    } finally {
      session.close();
    }
  });

  it('auto-returns multiline trailing expression after setup statements', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        [
          'const base = await Promise.resolve(2);',
          '',
          'Math.max(',
          '  base,',
          '  9',
          ')',
        ].join('\n')
      );
      expect(result).toBe(9);
    } finally {
      session.close();
    }
  });

  it('does not regress declaration/block tails in async mode', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        [
          'await Promise.resolve(1);',
          'if (true) {',
          '  const x = 3;',
          '}',
        ].join('\n')
      );
      expect(result).toBe(undefined);
    } finally {
      session.close();
    }
  });

  it('does not regress trailing multiline object literal expression', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        [
          'await Promise.resolve();',
          '({',
          '  value: 11,',
          '  ok: true,',
          '})',
        ].join('\n')
      );
      expect(result).toEqual({ value: 11, ok: true });
    } finally {
      session.close();
    }
  });

  it('trailing block statement remains non-returning', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      const result = await session.execute(
        ['await Promise.resolve();', '{', '  a: 1', '}'].join('\n')
      );
      expect(result).toBe(undefined);
    } finally {
      session.close();
    }
  });

  it('strict allowUnsafe parsing keeps lockdown for non-boolean truthy values', async () => {
    const runtime = new AxJSRuntime({
      outputMode: 'return',
      allowUnsafeNodeHostAccess: 'false' as unknown as boolean,
    });
    const session = runtime.createSession();
    try {
      const result = await session.execute('return typeof process');
      expect(result).toBe('undefined');
    } finally {
      session.close();
    }
  });

  it('explicit allowUnsafe=true still exposes node host globals', async () => {
    const runtime = new AxJSRuntime({
      outputMode: 'return',
      allowUnsafeNodeHostAccess: true,
    });
    const session = runtime.createSession();
    try {
      const result = await session.execute('return typeof process');
      expect(result).toBe('object');
    } finally {
      session.close();
    }
  });

  it('handles multiline async snippets ending with line comments and no trailing newline', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession({
      assistantCapabilities: {
        listModules: async () => ['email'],
        getModuleInfo: async (name: string) => ({ name }),
      },
      search: {
        personalData: async () => ({ results: [{ name: 'Fred' }] }),
      },
      chatHistory: [{ content: 'Fred met Vikram in history' }],
    });

    const code = [
      'console.log(await assistantCapabilities.listModules());',
      'console.log(await assistantCapabilities.getModuleInfo("email"));',
      '',
      '// Search for Fred to see if we have an email for him',
      'var fredSearch = await search.personalData({ query: "Fred", types: ["contacts"] });',
      'console.log("Fred search result:", JSON.stringify(fredSearch));',
      '',
      "// Resolve Jason's email since we have it in the query but let's be sure",
      'var jasonEmail = "jason@bigbasinlabs.com";',
      'var vikramEmail = "vikram@bigbasinlabs.com";',
      '',
      '// The query provided Vikram and Jason. The task says Fred and Jason.',
      `// It's possible Vikram is the "Fred" the user meant, or a replacement.`,
      '// Or maybe Fred is someone else.',
      '',
      `// Let's look for any recent mention of "Fred" in history to see if there's a URN or prior context.`,
      'console.log("History check for Fred/Vikram context...");',
      'var historyHits = chatHistory.filter(m => m.content.toLowerCase().includes("fred") || m.content.toLowerCase().includes("vikram"));',
      'console.log("Relevant history:", JSON.stringify(historyHits));',
      '',
      "// If I find Fred's email, I'll proceed. If not, I'll ask.",
      '// Also check if Vikram was meant to replace Fred.',
    ].join('\n');

    try {
      const result = await session.execute(code);
      expect(typeof result).toBe('string');
      expect(result).toContain('History check for Fred/Vikram context...');
      expect(result).toContain('Relevant history:');
      expect(result).not.toMatch(/^SyntaxError:/);
    } finally {
      session.close();
    }
  });

  it('callback (fn-call) error preserves name and message when caught', async () => {
    const runtime = new AxJSRuntime();
    const thrower = () => {
      const err = new Error('callback failed');
      err.name = 'CallbackError';
      throw err;
    };
    const session = runtime.createSession({
      thrower,
    });
    try {
      const err = await session.execute('await thrower()').catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('CallbackError');
      expect(err.message).toBe('callback failed');
    } finally {
      session.close();
    }
  });
});
