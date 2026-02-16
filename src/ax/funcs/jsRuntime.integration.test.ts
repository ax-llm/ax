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
      await expect(
        session.execute('return summaries; summaries')
      ).rejects.toThrow('Illegal return statement');
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

  it('thrown Error in worker preserves name and message when caught', async () => {
    const runtime = new AxJSRuntime();
    const session = runtime.createSession();
    try {
      await expect(
        session.execute('throw new TypeError("bad type")')
      ).rejects.toThrow('bad type');
      const err = await session
        .execute('throw new TypeError("bad type")')
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('TypeError');
      expect(err.message).toBe('bad type');
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
