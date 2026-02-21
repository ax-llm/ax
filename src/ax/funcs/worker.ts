import { axWorkerRuntime } from './worker.runtime.js';

/** Default number of prewarmed Node workers kept per worker-source key. */
export const DEFAULT_NODE_WORKER_POOL_SIZE = 4;
export const MAX_NODE_WORKER_POOL_SIZE = 16;
export const FUNCTION_REF_KEY = '__ax_rlm_fn_ref__';

/** Maximum depth for recursive error cause chains. */
export const MAX_ERROR_CAUSE_DEPTH = 16;

/**
 * Returns the inline source code for the Web Worker.
 * The worker handles `init` and `execute` messages, proxies function calls
 * back to the main thread, and supports both sync and async code paths.
 *
 * IMPORTANT: axWorkerRuntime is serialized via .toString() and evaluated in
 * an isolated worker context. The function body must be fully self-contained
 * and must NOT use bare `require`/`import` that bundlers (esbuild/tsup)
 * can rewrite into module-scope polyfill variables. See the comment block
 * at the top of axWorkerRuntime() in worker.runtime.ts for full rules.
 */
export function getWorkerSource(): string {
  const runtimeConfig = {
    functionRefKey: FUNCTION_REF_KEY,
    maxErrorCauseDepth: MAX_ERROR_CAUSE_DEPTH,
  } as const;

  return `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});\n`;
}
