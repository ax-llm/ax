import { axWorkerRuntime } from './worker.runtime.js';

/** Default number of prewarmed Node workers kept per worker-source key. */
export const DEFAULT_NODE_WORKER_POOL_SIZE = 4;
export const MAX_NODE_WORKER_POOL_SIZE = 16;
export const FUNCTION_REF_KEY = '__ax_rlm_fn_ref__';

/** Maximum depth for recursive error cause chains. */
export const MAX_ERROR_CAUSE_DEPTH = 16;

/**
 * Returns the inline source code for the Web Worker / Node worker_threads.
 *
 * The worker handles `init` and `execute` messages, proxies function calls
 * back to the main thread, and supports both sync and async code paths.
 *
 * ## Serialization boundary
 *
 * `axWorkerRuntime` is serialized via `.toString()` and evaluated as a
 * standalone script in an isolated context (Web Worker or Node worker_threads).
 * The serialized string contains ONLY the function body — it has no access to
 * module-scope variables, imports, or bundler-injected helpers from the
 * original bundle.
 *
 * This function is the **single point** where we bridge that gap: any
 * polyfills for bundler-injected references (e.g. `__name`) must be prepended
 * here. See the rules block at the top of `axWorkerRuntime()` in
 * `worker.runtime.ts` for the full list of constraints.
 *
 * ## Adding new polyfills
 *
 * If a future bundler version injects a new module-scope helper (e.g.
 * `__export`, `__toESM`, `__require`), add a detection + polyfill block
 * below following the same pattern as `__name`, and add a matching
 * sandbox test in `worker.runtime.test.ts`.
 */
export function getWorkerSource(): string {
  const runtimeConfig = {
    functionRefKey: FUNCTION_REF_KEY,
    maxErrorCauseDepth: MAX_ERROR_CAUSE_DEPTH,
  } as const;

  const source = `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});\n`;

  // --- Bundler helper polyfills ---
  //
  // esbuild/tsup may inject module-scope helper calls into the serialized
  // function body. These helpers exist at the top of the bundle but are NOT
  // available in the isolated worker context. We detect their presence in the
  // serialized source and prepend lightweight no-op polyfills.
  //
  // Known helpers:
  //   __name(fn, name) — injected when keepNames is enabled; preserves
  //                       Function.name during minification. The polyfill
  //                       simply returns the function unchanged.
  //
  // Why detection instead of always prepending?
  //   In dev/test (vitest runs unminified TS), these helpers are absent.
  //   Conditional prepending keeps the dev-time source clean and makes it
  //   obvious when a polyfill is actually in effect.

  let polyfills = '';

  if (source.includes('__name')) {
    polyfills += 'var __name=(fn,_n)=>fn;\n';
  }

  return polyfills ? `${polyfills}${source}` : source;
}
