import {
  type AxJSRuntimePermission,
  type AxJSRuntimeResourceLimits,
  canonicalizeForHash,
  mapRlmPermissionsToDenoPermissions,
} from './jsRuntimeSecurity.js';
import {
  DEFAULT_NODE_WORKER_POOL_SIZE,
  MAX_NODE_WORKER_POOL_SIZE,
} from './worker.js';

export type RLMMessageEvent = { data: unknown };

/** Minimal worker facade normalized across browser and Node runtimes. */
export type RLMWorker = {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  ref?: () => void;
  unref?: () => void;
  onmessage: ((event: RLMMessageEvent) => void) | null;
  onerror: ((error: Error) => void) | null;
  /** True if the underlying worker thread has exited (Node only). */
  readonly exited?: boolean;
};

/** True when the environment provides browser Web Worker primitives. */
export const canUseWebWorker = () =>
  typeof Worker !== 'undefined' &&
  typeof Blob !== 'undefined' &&
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function';

/** True when running under Bun. */
const isBunRuntime = () =>
  !!(globalThis as { process?: { versions?: { bun?: string } } }).process
    ?.versions?.bun;

/** True when running under Node.js, excluding Bun's Node compatibility layer. */
export const isNodeRuntime = () =>
  typeof process !== 'undefined' && !!process.versions?.node && !isBunRuntime();

/** True when running under Deno.js. */
const isDenoRuntime = () =>
  !!(globalThis as { Deno?: { version?: { deno?: string } } }).Deno?.version
    ?.deno;

const getDenoVersion = (): string | null =>
  (globalThis as { Deno?: { version?: { deno?: string } } }).Deno?.version
    ?.deno ?? null;

const parseSemver = (
  version: string
): { major: number; minor: number; patch: number } | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const clampNodeWorkerPoolSize = (value: number): number =>
  Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_NODE_WORKER_POOL_SIZE, Math.floor(value)))
    : DEFAULT_NODE_WORKER_POOL_SIZE;

const getNodeAvailableParallelism = (): number | null => {
  if (!isNodeRuntime()) {
    return null;
  }

  const processWithBuiltinModule = (
    globalThis as {
      process?: { getBuiltinModule?: (specifier: string) => unknown };
    }
  ).process;

  const getBuiltinModule = processWithBuiltinModule?.getBuiltinModule;
  if (typeof getBuiltinModule !== 'function') {
    return null;
  }

  const osMod = getBuiltinModule('node:os') as {
    availableParallelism?: () => number;
  } | null;

  const availableParallelism = osMod?.availableParallelism;
  if (typeof availableParallelism !== 'function') {
    return null;
  }

  const value = availableParallelism();
  return Number.isFinite(value) && value > 0 ? value : null;
};

export const resolveNodeWorkerPoolSize = (override?: number): number => {
  if (override !== undefined) {
    return clampNodeWorkerPoolSize(override);
  }

  const parallelism = getNodeAvailableParallelism();
  if (parallelism) {
    // Keep pool conservative: prewarm about half the parallelism budget.
    return clampNodeWorkerPoolSize(Math.ceil(parallelism / 2));
  }

  return DEFAULT_NODE_WORKER_POOL_SIZE;
};

export const isNodePoolDebugEnabled = (
  options?: Readonly<{ debugNodeWorkerPool?: boolean }>
): boolean => {
  if (options?.debugNodeWorkerPool) {
    return true;
  }
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ?? {};
  return env.AX_RLM_DEBUG_NODE_POOL === '1';
};

const createDenoWorker = (
  url: string,
  permissions: readonly AxJSRuntimePermission[],
  allowDenoRemoteImport?: boolean
): Worker => {
  // WorkerOptions.deno is documented as unstable. Prefer capability probing
  // via try/catch over strict version gating.
  const denoVersion = getDenoVersion();
  const parsed = denoVersion ? parseSemver(denoVersion) : null;
  const canAttemptDenoOptions = parsed ? parsed.major >= 1 : true;

  if (canAttemptDenoOptions) {
    try {
      return new Worker(url, {
        type: 'module',
        deno: {
          permissions: mapRlmPermissionsToDenoPermissions(permissions, {
            allowDenoRemoteImport,
          }),
        },
      } as WorkerOptions);
    } catch {
      // Fallback for runtimes that do not accept `deno` WorkerOptions yet.
    }
  }

  return new Worker(url, { type: 'module' });
};

const createBunWorker = (url: string): Worker =>
  new Worker(url, { smol: true } as WorkerOptions & { smol: true });

/** Creates a browser/Deno/Bun Web Worker and wraps it with the unified worker facade. */
export const createBrowserWorker = (
  source: string,
  permissions: readonly AxJSRuntimePermission[],
  allowDenoRemoteImport?: boolean
): RLMWorker => {
  const blob = new Blob([source], {
    type: 'application/javascript',
  });
  const url = URL.createObjectURL(blob);
  // Deno supports module workers only; Bun supports smol workers.
  const worker = isDenoRuntime()
    ? createDenoWorker(url, permissions, allowDenoRemoteImport)
    : isBunRuntime()
      ? createBunWorker(url)
      : new Worker(url);
  let isRevoked = false;
  const revoke = () => {
    if (!isRevoked) {
      URL.revokeObjectURL(url);
      isRevoked = true;
    }
  };

  const wrapped: RLMWorker = {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => {
      worker.terminate();
      // Module workers (Deno) can fail if URL is revoked immediately after spawn.
      revoke();
    },
    onmessage: null,
    onerror: null,
  };

  worker.onmessage = (event: MessageEvent) => {
    wrapped.onmessage?.({ data: event.data });
  };

  worker.onerror = (event: ErrorEvent) => {
    wrapped.onerror?.(new Error(event.message || 'Worker error'));
  };

  return wrapped;
};

/**
 * Creates a Node worker_threads worker from inline source.
 * The module specifier is built dynamically to avoid browser bundlers
 * eagerly resolving `node:*` imports.
 */
export const createNodeWorker = async (
  source: string,
  execArgv?: readonly string[],
  resourceLimits?: AxJSRuntimeResourceLimits
): Promise<RLMWorker> => {
  const nodeWorkerThreadsModule = `node:${'worker_threads'}`;
  const { Worker: NodeWorker } = (await import(
    /* @vite-ignore */
    nodeWorkerThreadsModule
  )) as typeof import('node:worker_threads');
  const workerOptions: {
    eval: true;
    execArgv?: string[];
    resourceLimits?: AxJSRuntimeResourceLimits;
  } = { eval: true };
  if (execArgv && execArgv.length > 0) {
    workerOptions.execArgv = [...execArgv];
  }
  if (resourceLimits) {
    workerOptions.resourceLimits = resourceLimits;
  }
  const nodeWorker = new NodeWorker(source, workerOptions);

  // Buffer errors/exit that fire before onerror handler is attached.
  // The worker may crash during initialization (before ensureWorker's .then()
  // or the pool's .then() sets onerror), silently dropping the error and
  // causing execute() to hang until timeout.
  let bufferedError: Error | null = null;
  let externalOnerror: ((error: Error) => void) | null = null;
  let exited = false;

  nodeWorker.on('error', (error) => {
    if (externalOnerror) {
      externalOnerror(error);
    } else {
      bufferedError = error;
    }
  });

  nodeWorker.on('exit', (code) => {
    exited = true;
    if (code !== 0 && !bufferedError) {
      const error = new Error(`Worker exited with code ${code}`);
      if (externalOnerror) {
        externalOnerror(error);
      } else {
        bufferedError = error;
      }
    }
  });

  nodeWorker.on('message', (data) => {
    wrapped.onmessage?.({ data });
  });

  const wrapped: RLMWorker = {
    postMessage: (message) => nodeWorker.postMessage(message),
    terminate: () => {
      void nodeWorker.terminate();
    },
    ref: () => {
      nodeWorker.ref();
    },
    unref: () => {
      nodeWorker.unref();
    },
    onmessage: null,
    get onerror(): ((error: Error) => void) | null {
      return externalOnerror;
    },
    set onerror(handler: ((error: Error) => void) | null) {
      externalOnerror = handler;
      // Replay buffered error from early initialization crash.
      if (handler && bufferedError) {
        const err = bufferedError;
        bufferedError = null;
        handler(err);
      }
    },
    get exited() {
      return exited;
    },
  };

  return wrapped;
};

/**
 * Pool of *fresh* Node workers for startup latency reduction.
 *
 * Important: workers are NOT reused after a session finishes, because sessions can
 * mutate worker global state. Instead, this pool prewarms "next" workers so that
 * acquire() usually returns quickly while preserving session isolation.
 */
class AxNodeFreshWorkerPool {
  private readonly source: string;
  private readonly maxSize: number;
  private readonly execArgv?: readonly string[];
  private readonly resourceLimits?: AxJSRuntimeResourceLimits;
  private readonly idle: RLMWorker[] = [];
  private pendingCreates = 0;

  constructor(
    source: string,
    maxSize: number,
    execArgv?: readonly string[],
    resourceLimits?: AxJSRuntimeResourceLimits
  ) {
    this.source = source;
    this.maxSize = maxSize;
    this.execArgv = execArgv;
    this.resourceLimits = resourceLimits;
  }

  /** Best-effort background prewarm up to maxSize idle workers. */
  warm(): void {
    if (!isNodeRuntime()) {
      return;
    }

    while (this.idle.length + this.pendingCreates < this.maxSize) {
      this.pendingCreates += 1;
      void createNodeWorker(this.source, this.execArgv, this.resourceLimits)
        .then((worker) => {
          // Workers in the idle pool are detached from session handlers.
          worker.onmessage = null;
          worker.onerror = null;
          // Idle prewarmed workers should not keep short-lived scripts alive.
          worker.unref?.();
          this.idle.push(worker);
        })
        .catch(() => {
          // Best-effort warmup; failed creations are ignored.
        })
        .finally(() => {
          this.pendingCreates -= 1;
        });
    }
  }

  /** Gets a fresh worker, preferring a prewarmed idle one. */
  async acquire(): Promise<RLMWorker> {
    // Skip dead workers that crashed during warmup initialization.
    while (this.idle.length > 0) {
      const worker = this.idle.pop()!;
      if (!worker.exited) {
        worker.ref?.();
        this.warm();
        return worker;
      }
      // Dead worker: discard and try next.
    }

    this.warm();
    return createNodeWorker(this.source, this.execArgv, this.resourceLimits);
  }

  /** Disposes used workers and replenishes the pool asynchronously. */
  release(worker: RLMWorker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    this.warm();
  }
}

const nodeWorkerPools = new Map<string, AxNodeFreshWorkerPool>();

const getNodeWorkerPoolKey = (
  source: string,
  maxSize: number,
  securityPostureHash: string,
  execArgvHash: string,
  resourceLimitsHash: string
): string =>
  `${maxSize}:${securityPostureHash}:${execArgvHash}:${resourceLimitsHash}:${source}`;

/** Returns (or creates) a per-source Node worker pool. */
export const getNodeWorkerPool = (
  source: string,
  maxSize: number,
  securityPostureHash: string,
  execArgv?: readonly string[],
  resourceLimits?: AxJSRuntimeResourceLimits
): AxNodeFreshWorkerPool => {
  const execArgvHash = canonicalizeForHash(execArgv ?? []);
  const resourceLimitsHash = canonicalizeForHash(resourceLimits ?? {});
  const key = getNodeWorkerPoolKey(
    source,
    maxSize,
    securityPostureHash,
    execArgvHash,
    resourceLimitsHash
  );
  const existingPool = nodeWorkerPools.get(key);
  if (existingPool) {
    return existingPool;
  }

  const pool = new AxNodeFreshWorkerPool(
    source,
    maxSize,
    execArgv,
    resourceLimits
  );
  nodeWorkerPools.set(key, pool);
  return pool;
};
