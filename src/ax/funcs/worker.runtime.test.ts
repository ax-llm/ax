import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { axWorkerRuntime } from './worker.runtime.js';
import { getWorkerSource } from './worker.js';

describe('axWorkerRuntime bootstrap', () => {
  it('throws when no postMessage transport is available', () => {
    const runtimeConfig = {
      functionRefKey: '__ax_fn_ref__',
      maxErrorCauseDepth: 4,
    } as const;
    const source = `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

    const sandbox: Record<string, unknown> = {};
    sandbox.globalThis = sandbox;

    expect(() => runInNewContext(source, sandbox)).toThrow(
      'Worker transport unavailable: no postMessage channel'
    );
  });

  it('serialized function does not use bare require (bundler-safe)', () => {
    const source = axWorkerRuntime.toString();
    // Should NOT contain bare require('...') calls outside of new Function strings.
    // Must use `new Function(...)` to obtain `require` so esbuild cannot
    // replace it with a module-scope polyfill variable.
    const bareRequireCall = /[^.'"\w]require\s*\(\s*['"]node:worker_threads/;
    expect(source).not.toMatch(bareRequireCall);
  });

  it('serialized function does not use globalThis.require (esbuild sees through it)', () => {
    const source = axWorkerRuntime.toString();
    // esbuild is smart enough to see through `globalThis['require']` and
    // still replaces it with a module-scope polyfill variable. The function
    // must use `new Function(...)` instead.
    const globalThisRequire =
      /globalThis\s*(\[\s*['"]require['"]\s*]|\.require)/;
    expect(source).not.toMatch(globalThisRequire);
  });

  it('detects Node runtime via globalThis.require in isolated sandbox', () => {
    const runtimeConfig = {
      functionRefKey: '__ax_fn_ref__',
      maxErrorCauseDepth: 4,
    } as const;
    const source = `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

    // Simulate a Node worker_threads environment with require on globalThis
    // but WITHOUT any module-scope bundler polyfills.
    const sandbox: Record<string, unknown> = {
      process: { versions: { node: process.version.slice(1) } },
      require,
      console,
    };
    sandbox.globalThis = sandbox;
    // No browser `self` — forces Node path

    // The function should detect Node via globalThis['require'] and try
    // to load worker_threads. Since we're not in a real worker, parentPort
    // will be null, so it falls through to the postMessage check and throws
    // the transport error — but critically NOT "h is not defined" or similar.
    expect(() => runInNewContext(source, sandbox)).toThrow(
      'Worker transport unavailable: no postMessage channel'
    );
  });

  it('detects Node runtime via process.getBuiltinModule when require is unavailable (ESM worker)', () => {
    const runtimeConfig = {
      functionRefKey: '__ax_fn_ref__',
      maxErrorCauseDepth: 4,
    } as const;
    const source = `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

    // Simulate an ESM worker context where `require` is NOT available
    // but `process.getBuiltinModule` is (Node 22.3+).
    // This is the scenario when the parent module is ESM and
    // new Worker(source, { eval: true }) creates an ESM worker.
    const sandbox: Record<string, unknown> = {
      process: {
        versions: { node: process.version.slice(1) },
        getBuiltinModule: (specifier: string) => {
          // Only allow node:worker_threads, return a mock with null parentPort
          if (specifier === 'node:worker_threads') {
            return { parentPort: null };
          }
          return null;
        },
      },
      console,
      // No `require` — simulating ESM worker context
    };
    sandbox.globalThis = sandbox;

    // Should detect Node via getBuiltinModule, load worker_threads,
    // find parentPort is null, and fall through to postMessage check.
    expect(() => runInNewContext(source, sandbox)).toThrow(
      'Worker transport unavailable: no postMessage channel'
    );
  });

  it('prefers process.getBuiltinModule over new Function require', () => {
    const runtimeConfig = {
      functionRefKey: '__ax_fn_ref__',
      maxErrorCauseDepth: 4,
    } as const;
    const source = `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

    let getBuiltinModuleCalled = false;

    const sandbox: Record<string, unknown> = {
      process: {
        versions: { node: process.version.slice(1) },
        getBuiltinModule: (specifier: string) => {
          getBuiltinModuleCalled = true;
          if (specifier === 'node:worker_threads') {
            return { parentPort: null };
          }
          return null;
        },
      },
      require,
      console,
    };
    sandbox.globalThis = sandbox;

    // Both require and getBuiltinModule are available; getBuiltinModule
    // should be used first since it works in both CJS and ESM contexts.
    expect(() => runInNewContext(source, sandbox)).toThrow(
      'Worker transport unavailable: no postMessage channel'
    );
    expect(getBuiltinModuleCalled).toBe(true);
  });

  it('getWorkerSource() executes in an isolated sandbox without bundler helpers', () => {
    const source = getWorkerSource();

    // Sandbox with Node-like environment but NO bundler helpers (__name, __require, etc.)
    const sandbox: Record<string, unknown> = {
      process: {
        versions: { node: process.version.slice(1) },
        getBuiltinModule: (specifier: string) => {
          if (specifier === 'node:worker_threads') {
            return { parentPort: null };
          }
          return null;
        },
      },
      console,
    };
    sandbox.globalThis = sandbox;

    // Should NOT throw ReferenceError for any bundler-injected helper.
    // Expected error is only "Worker transport unavailable" (no postMessage).
    expect(() => runInNewContext(source, sandbox)).toThrow(
      'Worker transport unavailable: no postMessage channel'
    );
  });

  it('serialized function does not use bare import() (bundler-safe)', () => {
    const source = axWorkerRuntime.toString();
    // Bare dynamic import() may be rewritten by bundlers.
    // Must use indirect eval if dynamic imports are ever needed.
    // Match `import(` but not inside string literals or comments.
    // This is a best-effort static check — it catches obvious bare usage.
    const bareImportCall = /[^.'"\w]import\s*\(/;
    expect(source).not.toMatch(bareImportCall);
  });
});

// ---------------------------------------------------------------------------
// getWorkerSource() output & polyfills
// ---------------------------------------------------------------------------

describe('getWorkerSource() output', () => {
  it('returns syntactically valid JavaScript', () => {
    const source = getWorkerSource();
    // If the source has a syntax error, `new Function` will throw SyntaxError.
    // We wrap in a function body to allow top-level `var` declarations.
    expect(() => new Function(source)).not.toThrow();
  });

  it('contains the serialized axWorkerRuntime function', () => {
    const source = getWorkerSource();
    expect(source).toContain('function axWorkerRuntime');
  });

  it('contains the runtime config payload', () => {
    const source = getWorkerSource();
    expect(source).toContain('"functionRefKey"');
    expect(source).toContain('"maxErrorCauseDepth"');
  });

  it('ends with a newline', () => {
    const source = getWorkerSource();
    expect(source.endsWith('\n')).toBe(true);
  });

  it('prepends __name polyfill when source contains __name calls', () => {
    // In dev/vitest the source won't contain __name (no minification).
    // We verify the polyfill logic by checking both branches:
    const source = getWorkerSource();

    if (source.includes('__name')) {
      // Built/minified: polyfill must be prepended.
      expect(source).toMatch(/^var __name=\(fn,_n\)=>fn;\n/);
    } else {
      // Dev/test: no polyfill needed, source starts with the IIFE.
      expect(source).toMatch(/^\(/);
    }
  });

  it('__name polyfill (if present) is a no-op that returns the function', () => {
    // Verify the polyfill semantics directly.
    const fn = () => 42;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const polyfillFn = new Function(
      'fn',
      'var __name=(fn,_n)=>fn; return __name(fn, "myName");'
    );
    expect(polyfillFn(fn)).toBe(fn);
  });
});

// ---------------------------------------------------------------------------
// Web Worker (browser-like) sandbox
// ---------------------------------------------------------------------------

describe('axWorkerRuntime in browser-like sandbox', () => {
  const runtimeConfig = {
    functionRefKey: '__ax_fn_ref__',
    maxErrorCauseDepth: 4,
  } as const;

  const makeSource = () =>
    `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

  it('bootstraps with postMessage transport (Web Worker environment)', () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    // Should NOT throw — postMessage is available.
    expect(() => runInNewContext(makeSource(), sandbox)).not.toThrow();
    // onmessage should have been wired up by _setOnMessage.
    expect(typeof sandbox.onmessage).toBe('function');
  });

  it('processes init + execute and sends result back via postMessage', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    // Send init
    onmessage({ data: { type: 'init', outputMode: 'return' } });

    // Send execute
    onmessage({ data: { type: 'execute', id: 1, code: '2 + 3' } });

    // The sync eval path posts the result synchronously.
    // For async paths, we'd need to await — give a tick just in case.
    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(1);
    expect(result!.value).toBe(5);
  });

  it('processes async execute with await and sends result back', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      Promise,
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    onmessage({ data: { type: 'init', outputMode: 'return' } });
    onmessage({
      data: { type: 'execute', id: 2, code: 'await Promise.resolve(42)' },
    });

    // Async path — give it time to resolve.
    await new Promise((r) => setTimeout(r, 50));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(2);
    expect(result!.value).toBe(42);
  });

  it('returns code execution errors as string values (not rejections)', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    onmessage({ data: { type: 'init', outputMode: 'return' } });
    // ReferenceError: undeclared variable
    onmessage({
      data: { type: 'execute', id: 3, code: 'nonExistentVariable' },
    });

    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(3);
    // Code execution errors (ReferenceError, SyntaxError, etc.) are
    // returned as string values so the LLM can self-correct.
    expect(typeof result!.value).toBe('string');
    expect(result!.value).toMatch(/^ReferenceError:/);
    expect(result!.error).toBeUndefined();
  });

  it('returns thrown Error as serialized error (not string value)', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    onmessage({ data: { type: 'init', outputMode: 'return' } });
    onmessage({
      data: {
        type: 'execute',
        id: 4,
        code: 'throw new Error("custom boom")',
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(4);
    // Non-code-execution errors are serialized as structured error objects.
    expect(result!.error).toBeDefined();
    const err = result!.error as Record<string, unknown>;
    expect(err.name).toBe('Error');
    expect(err.message).toBe('custom boom');
  });

  it('ignores messages with unknown type', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    // These should be silently ignored — no crashes, no responses.
    onmessage({ data: { type: 'unknown-type' } });
    onmessage({ data: null });
    onmessage({ data: 'not-an-object' });
    onmessage({ data: { type: 42 } });

    await new Promise((r) => setTimeout(r, 10));
    expect(messages).toHaveLength(0);
  });

  it('ignores execute messages with missing id or code', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    onmessage({ data: { type: 'execute', code: '1+1' } }); // missing id
    onmessage({ data: { type: 'execute', id: 1 } }); // missing code
    onmessage({ data: { type: 'execute', id: 'not-a-number', code: '1' } }); // bad id

    await new Promise((r) => setTimeout(r, 10));
    expect(messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Permission lockdown in sandbox
// ---------------------------------------------------------------------------

describe('axWorkerRuntime permission lockdown', () => {
  const runtimeConfig = {
    functionRefKey: '__ax_fn_ref__',
    maxErrorCauseDepth: 4,
  } as const;

  const makeSource = () =>
    `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

  it('locks down network globals (fetch, WebSocket, etc.) when not granted', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      fetch: () => {},
      WebSocket: class {},
      XMLHttpRequest: class {},
      EventSource: class {},
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    // Init WITHOUT network permission.
    onmessage({
      data: { type: 'init', permissions: [], outputMode: 'return' },
    });

    // After lockdown, these globals should be undefined.
    onmessage({ data: { type: 'execute', id: 1, code: 'typeof fetch' } });

    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.value).toBe('undefined');
  });

  it('preserves network globals when network permission is granted', async () => {
    const messages: unknown[] = [];
    const mockFetch = () => {};
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      fetch: mockFetch,
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    // Init WITH network permission.
    onmessage({
      data: { type: 'init', permissions: ['network'], outputMode: 'return' },
    });

    onmessage({ data: { type: 'execute', id: 1, code: 'typeof fetch' } });

    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.value).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Node worker_threads sandbox with parentPort (full message bridge)
// ---------------------------------------------------------------------------

describe('axWorkerRuntime with Node parentPort', () => {
  const runtimeConfig = {
    functionRefKey: '__ax_fn_ref__',
    maxErrorCauseDepth: 4,
  } as const;

  const makeSource = () =>
    `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

  it('uses parentPort.postMessage and .on("message") for Node workers', async () => {
    const messages: unknown[] = [];
    let messageHandler: ((data: unknown) => void) | null = null;

    const mockParentPort = {
      postMessage: (msg: unknown) => messages.push(msg),
      on: (event: string, handler: (data: unknown) => void) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      },
    };

    const sandbox: Record<string, unknown> = {
      process: {
        versions: { node: process.version.slice(1) },
        getBuiltinModule: (specifier: string) => {
          if (specifier === 'node:worker_threads') {
            return { parentPort: mockParentPort };
          }
          return null;
        },
      },
      console,
    };
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);

    // The runtime should have registered a handler via parentPort.on('message').
    expect(messageHandler).not.toBeNull();

    // Send init + execute via the Node message handler (data, not {data}).
    messageHandler!({ type: 'init', outputMode: 'return' });
    messageHandler!({ type: 'execute', id: 1, code: '10 * 3' });

    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(1);
    expect(result!.value).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// stdout output mode in sandbox
// ---------------------------------------------------------------------------

describe('axWorkerRuntime stdout output mode', () => {
  const runtimeConfig = {
    functionRefKey: '__ax_fn_ref__',
    maxErrorCauseDepth: 4,
  } as const;

  const makeSource = () =>
    `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

  it('captures console.log output in stdout mode', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      console: {
        log: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    onmessage({
      data: { type: 'init', outputMode: 'stdout', captureConsole: true },
    });
    onmessage({
      data: {
        type: 'execute',
        id: 1,
        code: 'console.log("hello"); console.log("world")',
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(1);
    expect(result!.value).toBe('hello\nworld');
  });
});

// ---------------------------------------------------------------------------
// fn-call proxy + fn-result round-trip in sandbox
// ---------------------------------------------------------------------------

describe('axWorkerRuntime fn-call proxy', () => {
  const runtimeConfig = {
    functionRefKey: '__ax_fn_ref__',
    maxErrorCauseDepth: 4,
  } as const;

  const makeSource = () =>
    `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});`;

  it('sends fn-call message for function ref proxies and resolves on fn-result', async () => {
    const messages: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      self: undefined as unknown,
      postMessage: (msg: unknown) => messages.push(msg),
      Promise,
      console,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    runInNewContext(makeSource(), sandbox);
    const onmessage = sandbox.onmessage as (event: { data: unknown }) => void;

    // Init with a function ref in globals.
    onmessage({
      data: {
        type: 'init',
        outputMode: 'return',
        globals: {
          myFunc: { __ax_fn_ref__: 'myFunc' },
        },
      },
    });

    // Execute code that calls the proxied function.
    onmessage({
      data: { type: 'execute', id: 1, code: 'await myFunc("arg1")' },
    });

    // Give the async execute a tick to start.
    await new Promise((r) => setTimeout(r, 10));

    // Runtime should have sent an fn-call message.
    const fnCall = messages.find(
      (m) => (m as Record<string, unknown>).type === 'fn-call'
    ) as Record<string, unknown> | undefined;
    expect(fnCall).toBeDefined();
    expect(fnCall!.name).toBe('myFunc');
    expect(fnCall!.args).toEqual(['arg1']);

    // Send fn-result back.
    onmessage({
      data: { type: 'fn-result', id: fnCall!.id, value: 'resolved-value' },
    });

    await new Promise((r) => setTimeout(r, 50));

    const result = messages.find(
      (m) => (m as Record<string, unknown>).type === 'result'
    ) as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
    expect(result!.id).toBe(1);
    expect(result!.value).toBe('resolved-value');
  });
});
