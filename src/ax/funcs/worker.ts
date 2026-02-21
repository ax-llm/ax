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
 */
export function getWorkerSource(): string {
  const runtimeConfig = {
    functionRefKey: FUNCTION_REF_KEY,
    maxErrorCauseDepth: MAX_ERROR_CAUSE_DEPTH,
  } as const;

  return `(${axWorkerRuntime.toString()})(${JSON.stringify(runtimeConfig)});\n`;
}
