import { describe, expect, it } from 'vitest';

import { AxJSRuntime, AxJSRuntimePermission } from './jsRuntime.js';

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
      // SyntaxErrors from new Function/eval have no line info in stack trace,
      // so Source section is omitted (code is already in the action log code block).
      expect(result).not.toContain('Source:');
      expect(result.length).toBeGreaterThan(10);
    } finally {
      session.close();
    }
  });

  it('runtime error Source section shows only context window around error line', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      // ReferenceError on line 4; only lines 3, 4, 5 should appear in Source.
      // (Runtime errors include <anonymous>:N:M in the stack trace, enabling the
      //  focused context window. SyntaxErrors lack this, so Source is omitted.)
      const code = [
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
        'undeclaredVar.foo;',
        'const e = 5;',
      ].join('\n');
      const result = await session.execute(code);
      expect(result).toMatch(/^(ReferenceError|TypeError): /);
      expect(result).toContain('Source:');
      // Lines surrounding the error should be present.
      expect(result).toContain('3| const c = 3;');
      expect(result).toContain('4| undeclaredVar.foo;');
      expect(result).toContain('5| const e = 5;');
      // Lines far from the error should not appear.
      expect(result).not.toContain('1| const a = 1;');
      expect(result).not.toContain('2| const b = 2;');
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

  it('function proxy calls resolve correctly (llmQuery + final pattern)', async () => {
    const runtime = new AxJSRuntime();
    const results: unknown[] = [];
    const session = runtime.createSession({
      context: 'some text content',
      llmQuery: async (query: string, _ctx: unknown) => `Answer: ${query}`,
      final: (...args: unknown[]) => {
        results.push(...args);
      },
    });
    try {
      const code = [
        'var result = await llmQuery("summarize", context);',
        'final(result);',
      ].join('\n');
      await session.execute(code);
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('Answer: summarize');
    } finally {
      session.close();
    }
  });

  it('multiple sequential fn-call proxies resolve in order', async () => {
    const runtime = new AxJSRuntime();
    const finalArgs: unknown[] = [];
    const session = runtime.createSession({
      llmQuery: async (query: string) => `Response: ${query}`,
      final: (...args: unknown[]) => {
        finalArgs.push(args[0]);
      },
    });
    try {
      const code = [
        'var r1 = await llmQuery("first");',
        'var r2 = await llmQuery("second");',
        'final(r1 + " | " + r2);',
      ].join('\n');
      await session.execute(code);
      expect(finalArgs[0]).toBe('Response: first | Response: second');
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

  // ---------------------------------------------------------------------------
  // Variable persistence across session.execute() calls
  // ---------------------------------------------------------------------------

  it('persists const across async calls', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute('const x = await Promise.resolve(42)');
      const result = await session.execute('x');
      expect(result).toBe(42);
    } finally {
      session.close();
    }
  });

  it('persists let across async calls', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute('let y = await Promise.resolve("hello")');
      const result = await session.execute('y');
      expect(result).toBe('hello');
    } finally {
      session.close();
    }
  });

  it('persists var across async calls', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute('var z = await Promise.resolve(99)');
      const result = await session.execute('z');
      expect(result).toBe(99);
    } finally {
      session.close();
    }
  });

  it('persists object destructuring from async calls', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute(
        'const { a, b } = await Promise.resolve({ a: 1, b: 2 })'
      );
      const result = await session.execute('[a, b]');
      expect(result).toEqual([1, 2]);
    } finally {
      session.close();
    }
  });

  it('persists array destructuring from async calls', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute(
        'const [first, second] = await Promise.resolve([10, 20])'
      );
      const result = await session.execute('[first, second]');
      expect(result).toEqual([10, 20]);
    } finally {
      session.close();
    }
  });

  it('persists multiple declarations in a single async call', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute(
        'const p = await Promise.resolve(1);\nconst q = await Promise.resolve(2)'
      );
      const result = await session.execute('[p, q]');
      expect(result).toEqual([1, 2]);
    } finally {
      session.close();
    }
  });

  it('re-declaration overwrites previous persisted value', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute('const val = await Promise.resolve("old")');
      await session.execute('const val = await Promise.resolve("new")');
      const result = await session.execute('val');
      expect(result).toBe('new');
    } finally {
      session.close();
    }
  });

  it('does NOT persist declarations inside blocks', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute(
        'if (true) { const blockScoped = await Promise.resolve(123) }'
      );
      const result = await session.execute('typeof blockScoped');
      expect(result).toBe('undefined');
    } finally {
      session.close();
    }
  });

  it('motivating use case: function proxy + const persistence', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession({
      util: {
        resolveAddresses: async () => ['alice@example.com', 'bob@example.com'],
      },
    });
    try {
      await session.execute('const recipients = await util.resolveAddresses()');
      const result = await session.execute('recipients');
      expect(result).toEqual(['alice@example.com', 'bob@example.com']);
    } finally {
      session.close();
    }
  });

  it('persists const/let in sync code', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute('const syncConst = 100');
      const r1 = await session.execute('syncConst');
      expect(r1).toBe(100);

      await session.execute('let syncLet = 200');
      const r2 = await session.execute('syncLet');
      expect(r2).toBe(200);
    } finally {
      session.close();
    }
  });

  it('existing var sync persistence still works (regression)', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      await session.execute('var items = [1, 2, 3]');
      const result = await session.execute('return items');
      expect(result).toEqual([1, 2, 3]);
    } finally {
      session.close();
    }
  });

  it('persistence does not break code with no declarations', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    try {
      const result = await session.execute('2 + 3');
      expect(result).toBe(5);
    } finally {
      session.close();
    }
  });

  it('patchGlobals overwrites scalars and reconciles plain objects in place', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession({
      query: 'initial',
      tags: ['old'],
      inputs: { query: 'initial', stale: 'old' },
    });

    try {
      await session.execute('globalThis.savedInputs = inputs');
      await session.patchGlobals({
        query: 'updated',
        tags: ['fresh'],
        note: undefined,
        inputs: { query: 'updated' },
        helper: {
          describe: async () => 'patched helper',
        },
      });

      const result = await session.execute(`
        ({
          query,
          tags,
          note,
          savedInputsSame: globalThis.savedInputs === inputs,
          savedInputsQuery: globalThis.savedInputs.query,
          inputsKeys: Object.keys(inputs).sort(),
          helperResult: await helper.describe()
        })
      `);

      expect(result).toEqual({
        query: 'updated',
        tags: ['fresh'],
        note: undefined,
        savedInputsSame: true,
        savedInputsQuery: 'updated',
        inputsKeys: ['query'],
        helperResult: 'patched helper',
      });
    } finally {
      session.close();
    }
  });

  it('patchGlobals survives worker reset and recreation', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return', timeout: 500 });
    const session = runtime.createSession({
      query: 'initial',
      inputs: { query: 'initial' },
    });

    try {
      await expect(session.execute('while(true){}')).rejects.toThrow(
        'Execution timed out'
      );

      await session.patchGlobals({
        query: 'updated',
        inputs: { query: 'updated' },
      });

      const result = await session.execute(
        '({ query, inputQuery: inputs.query })'
      );
      expect(result).toEqual({ query: 'updated', inputQuery: 'updated' });
    } finally {
      session.close();
    }
  });

  it('patchGlobals respects abort signals', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    const controller = new AbortController();
    controller.abort('stop patching');

    try {
      await expect(
        session.patchGlobals(
          { query: 'updated' },
          { signal: controller.signal }
        )
      ).rejects.toThrow('Aborted: stop patching');
    } finally {
      session.close();
    }
  });

  it('inspectGlobals returns structured snapshots and respects reserved names', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();

    try {
      await session.execute(
        'const reservedView = 7; const visibleItems = [1, 2, 3]'
      );

      const snapshot = await session.inspectGlobals!({
        reservedNames: ['reservedView'],
      });
      const parsed = JSON.parse(snapshot ?? '');

      expect(parsed).toMatchObject({ version: 1 });
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect(
        parsed.entries.some(
          (entry: { name: string }) => entry.name === 'reservedView'
        )
      ).toBe(false);
      expect(
        parsed.entries.some(
          (entry: { name: string; type: string }) =>
            entry.name === 'visibleItems' && entry.type === 'array'
        )
      ).toBe(true);
    } finally {
      session.close();
    }
  });

  it('inspectGlobals survives worker reset and recreation', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return', timeout: 500 });
    const session = runtime.createSession();

    try {
      await expect(session.execute('while(true){}')).rejects.toThrow(
        'Execution timed out'
      );

      await session.execute('const afterReset = 2');
      const snapshot = await session.inspectGlobals!();
      const parsed = JSON.parse(snapshot ?? '');

      expect(
        parsed.entries.some(
          (entry: { name: string; type: string }) =>
            entry.name === 'afterReset' && entry.type === 'number'
        )
      ).toBe(true);
    } finally {
      session.close();
    }
  });

  it('snapshotGlobals returns restorable bindings and marks snapshot-only values', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();

    try {
      await session.execute(
        [
          'const rows = [{ id: 1 }, { id: 2 }];',
          'globalThis.summary = { count: rows.length };',
          'const helper = () => rows.length;',
        ].join('\n')
      );

      const snapshot = await session.snapshotGlobals!({
        reservedNames: ['summary'],
      });

      expect(snapshot).toMatchObject({ version: 1 });
      expect(snapshot.bindings).toMatchObject({
        rows: [{ id: 1 }, { id: 2 }],
      });
      expect(snapshot.bindings).not.toHaveProperty('summary');
      expect(snapshot.bindings).not.toHaveProperty('helper');
      expect(
        snapshot.entries.find((entry) => entry.name === 'rows')
      ).toMatchObject({
        name: 'rows',
        restorable: true,
        type: 'array',
      });
      expect(
        snapshot.entries.find((entry) => entry.name === 'helper')
      ).toMatchObject({
        name: 'helper',
        restorable: false,
        type: 'function',
      });
    } finally {
      session.close();
    }
  });

  it('snapshotGlobals respects abort signals', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    const controller = new AbortController();
    controller.abort('stop snapshotting');

    try {
      await expect(
        session.snapshotGlobals!({ signal: controller.signal })
      ).rejects.toThrow('Aborted: stop snapshotting');
    } finally {
      session.close();
    }
  });

  it('inspectGlobals respects abort signals', async () => {
    const runtime = new AxJSRuntime({ outputMode: 'return' });
    const session = runtime.createSession();
    const controller = new AbortController();
    controller.abort('stop inspecting');

    try {
      await expect(
        session.inspectGlobals!({ signal: controller.signal })
      ).rejects.toThrow('Aborted: stop inspecting');
    } finally {
      session.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Sandbox hardening: dynamic import blocking, Function/eval shims, intrinsic
// freeze, ShadowRealm lockdown. These end-to-end tests cover the hardening
// implemented in worker.runtime.ts §1-§7 and §13.
// ---------------------------------------------------------------------------

// Accept either our sandbox rejection ("not allowed in this sandbox") OR
// Node's own reject when `--experimental-vm-modules` is not enabled ("A
// dynamic import callback was invoked without --experimental-vm-modules").
// The security outcome is identical — the import did not succeed.
const BLOCKED_DEFAULT =
  /not allowed in this sandbox|without --experimental-vm-modules|dynamic import|SyntaxError/i;

const expectBlocked = async (
  session: { execute: (code: string) => Promise<unknown> },
  code: string,
  matcher: RegExp = BLOCKED_DEFAULT
) => {
  // The worker returns execution errors as string values; thrown Errors are
  // rejected. Either form is acceptable here — we just need to confirm the
  // code did not succeed.
  let outcome: unknown;
  try {
    outcome = await session.execute(code);
  } catch (err) {
    outcome = err instanceof Error ? err.message : String(err);
  }
  expect(typeof outcome === 'string' ? outcome : String(outcome)).toMatch(
    matcher
  );
};

describe('AxJSRuntime sandbox hardening', () => {
  describe('dynamic import() blocking (default)', () => {
    it('rejects await import("fs")', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await expectBlocked(session, 'return await import("fs")');
      } finally {
        session.close();
      }
    });

    it('rejects await import("node:fs")', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await expectBlocked(session, 'return await import("node:fs")');
      } finally {
        session.close();
      }
    });

    it('rejects new Function("return import(...)")()', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await expectBlocked(
          session,
          'return await (new Function("return import(\\"fs\\")"))()'
        );
      } finally {
        session.close();
      }
    });

    it('rejects (async()=>{}).constructor import', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await expectBlocked(
          session,
          'const AF = (async()=>{}).constructor; return await (new AF("return import(\\"fs\\")"))()'
        );
      } finally {
        session.close();
      }
    });

    it('rejects eval("import(...)")', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await expectBlocked(session, 'return await eval("import(\\"fs\\")")');
      } finally {
        session.close();
      }
    });

    it('rejects indirect eval (0,eval)("import(...)")', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await expectBlocked(
          session,
          'return await (0, eval)("import(\\"fs\\")")'
        );
      } finally {
        session.close();
      }
    });
  });

  describe('allowedModules: dynamic-import allowlist gate', () => {
    // This suite verifies the security boundary, not full Node module
    // passthrough. Allowlisted specifiers reach Node's vm import callback, but
    // complete namespace passthrough is runtime-dependent and may still fail.
    // Non-allowlisted specifiers must always be blocked.

    it('rejects non-allowlisted modules even when others are allowed', async () => {
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        permissions: [AxJSRuntimePermission.FILESYSTEM],
        allowedModules: ['node:fs'],
      });
      const session = runtime.createSession();
      try {
        // Accept either our sandbox rejection (when --experimental-vm-modules
        // is on) or Node's own refusal to invoke the callback (default Node
        // behavior). Both outcomes mean the non-allowlisted import did not
        // succeed.
        await expectBlocked(session, 'await import("node:child_process")');
      } finally {
        session.close();
      }
    });

    it('allowlisted specifiers are attempted but may still fail in Node vm', async () => {
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        permissions: [AxJSRuntimePermission.FILESYSTEM],
        allowedModules: ['node:fs'],
      });
      const session = runtime.createSession();
      try {
        let outcome: unknown;
        try {
          outcome = await session.execute('await import("node:fs")');
        } catch (err) {
          outcome = err instanceof Error ? err.message : String(err);
        }
        // Allowlisted modules are attempted; any failure here should come from
        // Node vm import semantics, NOT from the sandbox allowlist rejection.
        if (typeof outcome === 'string') {
          expect(outcome).not.toMatch(/not allowed in this sandbox/);
        }
      } finally {
        session.close();
      }
    });
  });

  describe('ShadowRealm lockdown (default)', () => {
    it('hides ShadowRealm from the worker global scope', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        const result = await session.execute('return typeof ShadowRealm');
        expect(result).toBe('undefined');
      } finally {
        session.close();
      }
    });
  });

  describe('intrinsic freeze (default)', () => {
    it('prevents Object.prototype poisoning', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        // Attempt to poison — either silently fails or throws. Swallow it.
        await session
          .execute(
            'try { Object.prototype.poisoned = 42 } catch (e) {}; void 0'
          )
          .catch(() => null);
        // Fresh object must not carry the poisoned property.
        const check = await session.execute('return ({}).poisoned');
        expect(check).toBeUndefined();
      } finally {
        session.close();
      }
    });

    it('prevents Array.prototype.push replacement', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        await session
          .execute(
            'try { Array.prototype.push = () => "evil" } catch (e) {}; void 0'
          )
          .catch(() => null);
        await session.execute('const a = []; a.push(1)');
        const result = await session.execute('return a');
        // Freeze must prevent prototype replacement — so push still works
        // normally as Array.prototype.push.
        expect(result).toEqual([1]);
      } finally {
        session.close();
      }
    });

    it('pins Error.stackTraceLimit to 10', async () => {
      const runtime = new AxJSRuntime({ outputMode: 'return' });
      const session = runtime.createSession();
      try {
        const value = await session.execute('return Error.stackTraceLimit');
        expect(value).toBe(10);
        // Writing to it should fail (silently or with a throw).
        await session
          .execute('try { Error.stackTraceLimit = 9999 } catch (e) {}; void 0')
          .catch(() => null);
        const after = await session.execute('return Error.stackTraceLimit');
        expect(after).toBe(10);
      } finally {
        session.close();
      }
    });
  });

  describe('opt-outs', () => {
    it('blockDynamicImport: false lets import() through', async () => {
      // Not a test of security — a test that the opt-out plumbing works.
      // We confirm the worker does NOT emit the "dynamic import blocking
      // requires node:vm" error.
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        blockDynamicImport: false,
        permissions: [AxJSRuntimePermission.FILESYSTEM],
      });
      const session = runtime.createSession();
      try {
        const result = await session.execute(
          'const fs = await import("node:fs"); return typeof fs.readFileSync'
        );
        expect(result).toBe('function');
      } finally {
        session.close();
      }
    });

    it('freezeIntrinsics: false allows prototype modification', async () => {
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        freezeIntrinsics: false,
      });
      const session = runtime.createSession();
      try {
        await session.execute('Object.prototype.customFlag = 7');
        const result = await session.execute('return ({}).customFlag');
        expect(result).toBe(7);
        await session.execute('delete Object.prototype.customFlag');
      } finally {
        session.close();
      }
    });
  });

  // Detect Node version once so the Permission Model suite can skip on Node < 20.
  const nodeVersion = process.versions?.node ?? '';
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  const supportsPermissionModel = Number.isFinite(nodeMajor) && nodeMajor >= 20;
  const describePermissionModel = supportsPermissionModel
    ? describe
    : describe.skip;

  describePermissionModel('Node Permission Model (OS-level defense)', () => {
    it('auto engages unconditionally: fs reads blocked at OS level without FILESYSTEM', async () => {
      // Default `new AxJSRuntime()` has no FILESYSTEM permission. With
      // `useNodePermissionModel: 'auto'` (the default) and a supported Node,
      // the worker spawns under --permission / --experimental-permission,
      // so *even if* a hypothetical language-level escape reached node:fs,
      // the kernel-level check would deny the read.
      //
      // We exercise this end-to-end by bypassing the language-level block
      // (blockDynamicImport: false) so node:fs can be required, then
      // confirming the read is still denied with ERR_ACCESS_DENIED.
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        blockDynamicImport: false,
        allowUnsafeNodeHostAccess: true,
        freezeIntrinsics: false,
        // useNodePermissionModel defaults to 'auto' → engaged here.
      });
      const session = runtime.createSession();
      try {
        const result = await session.execute(`
          try {
            const fs = await import('node:fs');
            fs.readFileSync('/etc/hosts');
            return 'NOT BLOCKED';
          } catch (e) {
            return e && e.code ? e.code : String(e).slice(0, 80);
          }
        `);
        expect(result).toBe('ERR_ACCESS_DENIED');
      } finally {
        session.close();
      }
    });

    it('FILESYSTEM permission grants OS-level fs-read via auto', async () => {
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        blockDynamicImport: false,
        allowUnsafeNodeHostAccess: true,
        freezeIntrinsics: false,
        permissions: [AxJSRuntimePermission.FILESYSTEM],
      });
      const session = runtime.createSession();
      try {
        const result = await session.execute(`
          try {
            const fs = await import('node:fs');
            // Reading a path that definitely exists under a standard POSIX
            // layout. If the Permission Model is engaged with
            // --allow-fs-read=* (what FILESYSTEM maps to), this succeeds.
            return typeof fs.readFileSync('/etc/hosts', 'utf8');
          } catch (e) {
            return e && e.code ? e.code : String(e).slice(0, 80);
          }
        `);
        expect(result).toBe('string');
      } finally {
        session.close();
      }
    });

    it('useNodePermissionModel: false disables OS-level block', async () => {
      // When the permission model is explicitly disabled, fs reads are NOT
      // kernel-blocked. The caller opts out of OS-layer defense (they still
      // have the language-level defenses).
      const runtime = new AxJSRuntime({
        outputMode: 'return',
        blockDynamicImport: false,
        allowUnsafeNodeHostAccess: true,
        freezeIntrinsics: false,
        useNodePermissionModel: false,
      });
      const session = runtime.createSession();
      try {
        const result = await session.execute(`
          try {
            const fs = await import('node:fs');
            return typeof fs.readFileSync('/etc/hosts', 'utf8');
          } catch (e) {
            return e && e.code ? e.code : String(e).slice(0, 80);
          }
        `);
        expect(result).toBe('string');
      } finally {
        session.close();
      }
    });
  });
});
