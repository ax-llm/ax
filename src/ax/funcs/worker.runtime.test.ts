import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { axWorkerRuntime } from './worker.runtime.js';

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
    // Should NOT contain bare require('node:worker_threads') call.
    // Must use globalThis['require'] or similar indirect access to survive
    // esbuild minification which replaces bare require with module-scope polyfills.
    const bareRequireCall =
      /[^.'"\w]require\s*\(\s*['"]node:worker_threads/;
    expect(source).not.toMatch(bareRequireCall);
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
});
