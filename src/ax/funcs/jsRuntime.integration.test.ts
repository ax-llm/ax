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
