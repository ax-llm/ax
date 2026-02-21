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
});
