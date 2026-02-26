import type { AxFunction } from '../ai/types.js';
import type { AxCodeRuntime, AxCodeSession } from '../prompts/rlm.js';
import {
  DEFAULT_NODE_WORKER_POOL_SIZE,
  FUNCTION_REF_KEY,
  getWorkerSource,
  MAX_ERROR_CAUSE_DEPTH,
  MAX_NODE_WORKER_POOL_SIZE,
} from './worker.js';

/**
 * Cross-runtime RLM JavaScript interpreter architecture:
 * - Browser runtime: uses Web Workers directly.
 * - Node runtime: uses node:worker_threads via lazy dynamic import.
 * - Worker script: shared inline source that supports both runtimes.
 * - Session model: one persistent worker per session (state survives execute calls).
 * - Node pool: prewarms fresh workers to reduce startup latency while avoiding
 *   reuse of "dirty" workers across sessions.
 */
type RLMMessageEvent = { data: unknown };

/** Minimal worker facade normalized across browser and Node runtimes. */
type RLMWorker = {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  onmessage: ((event: RLMMessageEvent) => void) | null;
  onerror: ((error: Error) => void) | null;
  /** True if the underlying worker thread has exited (Node only). */
  readonly exited?: boolean;
};

/** True when the environment provides browser Web Worker primitives. */
const canUseWebWorker = () =>
  typeof Worker !== 'undefined' &&
  typeof Blob !== 'undefined' &&
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function';

/** True when running under Node.js. */
const isNodeRuntime = () =>
  typeof process !== 'undefined' && !!process.versions?.node;

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

const resolveNodeWorkerPoolSize = (override?: number): number => {
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

const isNodePoolDebugEnabled = (
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

/**
 * Maps RLM sandbox permissions to Deno worker permissions.
 *
 * Conservative mapping:
 * - NETWORK => net: true
 * - Others currently have no direct Deno permission equivalent
 *
 * Default is "none" for a tighter sandbox when running in Deno.
 */
const mapRlmPermissionsToDenoPermissions = (
  permissions: readonly AxJSRuntimePermission[]
): unknown => {
  const granted = new Set(permissions);
  const denoPermissions: Record<string, unknown> = {};

  if (granted.has(AxJSRuntimePermission.NETWORK)) {
    denoPermissions.net = true;
  }

  return Object.keys(denoPermissions).length > 0 ? denoPermissions : 'none';
};

const createDenoWorker = (
  url: string,
  permissions: readonly AxJSRuntimePermission[]
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
          permissions: mapRlmPermissionsToDenoPermissions(permissions),
        },
      } as WorkerOptions);
    } catch {
      // Fallback for runtimes that do not accept `deno` WorkerOptions yet.
    }
  }

  return new Worker(url, { type: 'module' });
};

/** Creates a browser/Deno Web Worker and wraps it with the unified worker facade. */
const createBrowserWorker = (
  source: string,
  permissions: readonly AxJSRuntimePermission[]
): RLMWorker => {
  const blob = new Blob([source], {
    type: 'application/javascript',
  });
  const url = URL.createObjectURL(blob);
  // Deno supports module workers only; browsers support both.
  const worker = isDenoRuntime()
    ? createDenoWorker(url, permissions)
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
const createNodeWorker = async (source: string): Promise<RLMWorker> => {
  const nodeWorkerThreadsModule = `node:${'worker_threads'}`;
  const { Worker: NodeWorker } = (await import(
    nodeWorkerThreadsModule
  )) as typeof import('node:worker_threads');
  const nodeWorker = new NodeWorker(source, { eval: true });

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
  private readonly idle: RLMWorker[] = [];
  private pendingCreates = 0;

  constructor(source: string, maxSize: number) {
    this.source = source;
    this.maxSize = maxSize;
  }

  /** Best-effort background prewarm up to maxSize idle workers. */
  warm(): void {
    if (!isNodeRuntime()) {
      return;
    }

    while (this.idle.length + this.pendingCreates < this.maxSize) {
      this.pendingCreates += 1;
      void createNodeWorker(this.source)
        .then((worker) => {
          // Workers in the idle pool are detached from session handlers.
          worker.onmessage = null;
          worker.onerror = null;
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
        this.warm();
        return worker;
      }
      // Dead worker — discard and try next.
    }

    this.warm();
    return createNodeWorker(this.source);
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

const getNodeWorkerPoolKey = (source: string, maxSize: number): string =>
  `${maxSize}:${source}`;

/** Returns (or creates) a per-source Node worker pool. */
const getNodeWorkerPool = (
  source: string,
  maxSize: number
): AxNodeFreshWorkerPool => {
  const key = getNodeWorkerPoolKey(source, maxSize);
  const existingPool = nodeWorkerPools.get(key);
  if (existingPool) {
    return existingPool;
  }

  const pool = new AxNodeFreshWorkerPool(source, maxSize);
  nodeWorkerPools.set(key, pool);
  return pool;
};

const splitGlobalsForWorker = (globals?: Record<string, unknown>) => {
  const serializableGlobals: Record<string, unknown> = {};
  const fnMap = new Map<string, (...args: unknown[]) => unknown>();
  let nextFnId = 0;
  const seen = new WeakMap<object, unknown>();

  const toSerializable = (value: unknown, path: string): unknown => {
    if (typeof value === 'function') {
      const ref = `fn_${++nextFnId}_${path || 'root'}`;
      fnMap.set(ref, value as (...args: unknown[]) => unknown);
      return { [FUNCTION_REF_KEY]: ref };
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value as object)) {
      return seen.get(value as object);
    }

    if (Array.isArray(value)) {
      const arr: unknown[] = [];
      seen.set(value, arr);
      for (let i = 0; i < value.length; i += 1) {
        arr[i] = toSerializable(value[i], `${path}[${i}]`);
      }
      return arr;
    }

    const proto = Object.getPrototypeOf(value);
    const isPlainObject = proto === Object.prototype || proto === null;
    if (!isPlainObject) {
      return value;
    }

    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(obj)) {
      out[k] = toSerializable(v, path ? `${path}.${k}` : k);
    }
    return out;
  };

  if (globals) {
    for (const [key, value] of Object.entries(globals)) {
      serializableGlobals[key] = toSerializable(value, key);
    }
  }

  return { serializableGlobals, fnMap };
};

const validateSerializableGlobals = (
  globals: Record<string, unknown>
): void => {
  if (typeof structuredClone !== 'function') {
    return;
  }

  try {
    structuredClone(globals);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`RLM globals must be structured-cloneable: ${message}`);
  }
};

/** Structured error payload sent across worker boundary (supports recursive cause). */
export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: string | SerializedError;
  /** Optional structured-cloneable payload (array, object, string, number, etc.). */
  data?: unknown;
};

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function serializeError(
  err: unknown,
  maxDepth: number = MAX_ERROR_CAUSE_DEPTH,
  depth: number = 0,
  seen: Set<object> = new Set()
): SerializedError | string {
  if (depth > maxDepth) {
    return { name: 'Error', message: '[cause chain truncated]' };
  }
  if (err !== null && typeof err === 'object') {
    if (seen.has(err as object)) {
      return { name: 'Error', message: '[circular]' };
    }
    seen.add(err as object);
  }
  const name =
    err !== null &&
    typeof err === 'object' &&
    (err as { name?: unknown }).name != null
      ? String((err as { name: unknown }).name)
      : 'Error';
  const message =
    err !== null &&
    typeof err === 'object' &&
    (err as { message?: unknown }).message != null
      ? String((err as { message: unknown }).message)
      : safeStringify(err);
  const stack =
    err !== null &&
    typeof err === 'object' &&
    typeof (err as { stack?: unknown }).stack === 'string'
      ? (err as { stack: string }).stack
      : undefined;
  let cause: string | SerializedError | undefined;
  const errObj = err as { cause?: unknown } | null;
  if (
    errObj &&
    typeof errObj === 'object' &&
    errObj.cause !== undefined &&
    depth < maxDepth
  ) {
    try {
      const c = errObj.cause;
      if (
        c instanceof Error ||
        (c !== null && typeof c === 'object' && ('message' in c || 'name' in c))
      ) {
        cause = serializeError(c, maxDepth, depth + 1, seen) as SerializedError;
      } else {
        cause = { name: 'Error', message: safeStringify(c) };
      }
    } catch {
      cause = { name: 'Error', message: safeStringify(errObj.cause) };
    }
  }
  const out: SerializedError = { name, message };
  if (stack !== undefined) out.stack = stack;
  if (cause !== undefined) out.cause = cause;
  const errWithData = err as { data?: unknown } | null;
  if (
    errWithData &&
    typeof errWithData === 'object' &&
    'data' in errWithData &&
    errWithData.data !== undefined
  ) {
    try {
      if (typeof structuredClone === 'function') {
        out.data = structuredClone(errWithData.data);
      } else {
        out.data = errWithData.data;
      }
    } catch {
      // Non-cloneable data omitted
    }
  }
  return out;
}

function deserializeError(payload: string | SerializedError): Error {
  if (typeof payload === 'string') {
    return new Error(payload);
  }
  if (!payload || typeof payload !== 'object') {
    return new Error(String(payload));
  }
  const message =
    payload.message != null ? String(payload.message) : 'Unknown error';
  const err = new Error(message);
  err.name = payload.name != null ? String(payload.name) : 'Error';
  if (typeof payload.stack === 'string') {
    err.stack = payload.stack;
  }
  if (payload.cause !== undefined) {
    (err as Error & { cause?: unknown }).cause = deserializeError(
      payload.cause
    );
  }
  if (payload.data !== undefined) {
    (err as Error & { data?: unknown }).data = payload.data;
  }
  return err;
}

/**
 * Permissions that can be granted to the RLM JS interpreter sandbox.
 * By default all dangerous globals are blocked; users opt in via this enum.
 */
export enum AxJSRuntimePermission {
  /** fetch, XMLHttpRequest, WebSocket, EventSource */
  NETWORK = 'network',
  /** indexedDB, caches */
  STORAGE = 'storage',
  /** importScripts */
  CODE_LOADING = 'code-loading',
  /** BroadcastChannel */
  COMMUNICATION = 'communication',
  /** performance */
  TIMING = 'timing',
  /**
   * Worker, SharedWorker.
   * Warning: sub-workers spawn with fresh, unlocked globals — granting
   * WORKERS without other restrictions implicitly grants all capabilities
   * (e.g. fetch, indexedDB) inside child workers.
   */
  WORKERS = 'workers',
}

export type AxJSRuntimeOutputMode = 'return' | 'stdout';

/**
 * Browser-compatible JavaScript interpreter for RLM using Web Workers.
 * Creates persistent sessions where variables survive across `execute()` calls.
 */
export class AxJSRuntime implements AxCodeRuntime {
  readonly language = 'JavaScript';
  private readonly timeout: number;
  private readonly permissions: readonly AxJSRuntimePermission[];
  private readonly allowUnsafeNodeHostAccess: boolean;
  private readonly nodeWorkerPoolSize: number;
  private readonly debugNodeWorkerPool: boolean;
  private readonly outputMode: AxJSRuntimeOutputMode;
  private readonly captureConsole: boolean;

  constructor(
    options?: Readonly<{
      timeout?: number;
      permissions?: readonly AxJSRuntimePermission[];
      outputMode?: AxJSRuntimeOutputMode;
      captureConsole?: boolean;
      /**
       * Warning: enables direct access to Node host globals (e.g. process/require)
       * from model-generated code in Node worker runtime.
       *
       * Defaults to false for safer behavior.
       */
      allowUnsafeNodeHostAccess?: boolean;
      /**
       * Node-only: prewarm pool size for worker_threads.
       * Defaults to an adaptive value based on availableParallelism() when available.
       */
      nodeWorkerPoolSize?: number;
      /**
       * Node-only: prints resolved worker pool size to console.debug.
       * Can also be enabled via AX_RLM_DEBUG_NODE_POOL=1.
       */
      debugNodeWorkerPool?: boolean;
    }>
  ) {
    this.timeout = options?.timeout ?? 30_000;
    this.permissions = options?.permissions ?? [];
    this.allowUnsafeNodeHostAccess =
      options?.allowUnsafeNodeHostAccess ?? false;
    this.outputMode = options?.outputMode ?? 'stdout';
    this.captureConsole =
      options?.captureConsole ?? this.outputMode === 'stdout';
    this.nodeWorkerPoolSize = resolveNodeWorkerPoolSize(
      options?.nodeWorkerPoolSize
    );
    this.debugNodeWorkerPool = isNodePoolDebugEnabled(options);
  }

  public getUsageInstructions(): string {
    const outputLines =
      this.outputMode === 'stdout'
        ? [
            'Use `console.log(...)` output is captured as the execution result so use it to inspect intermediate values between steps instead of `return`.',
          ]
        : [
            'Use `return` or a trailing expression to produce the execution result.',
          ];

    return [
      "Don't wrap async code in (async()=>{ ... })() — the runtime automatically handles async execution.",
      'State is session-scoped: all top-level declarations (`var`, `let`, `const`) persist across calls.',
      'Bare assignment (e.g. `x = 1`) also persists via `globalThis`.',
      ...outputLines,
    ]
      .map((v) => `- ${v}`)
      .join('\n');
  }

  /**
   * Creates a persistent execution session.
   *
   * Message flow:
   * 1) Main thread sends `init` with globals, function proxies, permissions.
   * 2) Main thread sends `execute` with correlation ID and code.
   * 3) Worker returns `result` or requests host callbacks via `fn-call`.
   * 4) Host responds to callback requests with `fn-result`.
   *
   * Session closes on:
   * - explicit close(),
   * - timeout,
   * - abort signal,
   * - worker error.
   */
  createSession(globals?: Record<string, unknown>): AxCodeSession {
    const source = getWorkerSource();
    const nodeWorkerPool = isNodeRuntime()
      ? getNodeWorkerPool(source, this.nodeWorkerPoolSize)
      : null;
    if (nodeWorkerPool && this.debugNodeWorkerPool) {
      console.debug(
        `[AxJSRuntime] Node worker pool size: ${this.nodeWorkerPoolSize}`
      );
    }
    nodeWorkerPool?.warm();

    let worker: RLMWorker | null = null;
    let workerRuntime: 'browser' | 'node' | null = null;
    let workerReady: Promise<void> | null = null;
    let isClosed = false;

    const timeout = this.timeout;

    // Convert nested function values into worker-callable references.
    const { serializableGlobals, fnMap } = splitGlobalsForWorker(globals);
    validateSerializableGlobals(serializableGlobals);

    // Pending execute promises keyed by correlation ID
    const pendingExecutions = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let nextId = 0;

    /** Dispatches worker messages for execution and host-function bridging. */
    const handleWorkerMessage = (e: RLMMessageEvent) => {
      const msg = e.data;

      if (
        !msg ||
        typeof msg !== 'object' ||
        !('type' in msg) ||
        (msg as { type?: unknown }).type === undefined
      ) {
        return;
      }

      const typedMsg = msg as {
        type: string;
        id?: number;
        name?: string;
        args?: unknown[];
        value?: unknown;
        error?: string | SerializedError;
      };

      if (typedMsg.type === 'result') {
        if (typeof typedMsg.id !== 'number') {
          return;
        }

        const pending = pendingExecutions.get(typedMsg.id);
        if (pending) {
          pendingExecutions.delete(typedMsg.id);
          if (typedMsg.error !== undefined) {
            pending.reject(deserializeError(typedMsg.error));
          } else {
            pending.resolve(typedMsg.value);
          }
        }
        return;
      }

      if (typedMsg.type === 'fn-call') {
        if (
          typeof typedMsg.id !== 'number' ||
          typeof typedMsg.name !== 'string'
        ) {
          return;
        }

        const fn = fnMap.get(typedMsg.name);
        if (!fn) {
          worker?.postMessage({
            type: 'fn-result',
            id: typedMsg.id,
            error: `Function "${typedMsg.name}" not found`,
          });
          return;
        }
        Promise.resolve()
          .then(() => fn(...(typedMsg.args ?? [])))
          .then((value) => {
            worker?.postMessage({ type: 'fn-result', id: typedMsg.id, value });
          })
          .catch((err: Error) => {
            worker?.postMessage({
              type: 'fn-result',
              id: typedMsg.id,
              error: serializeError(err) as SerializedError,
            });
          });
      }
    };

    /** Terminates current session worker and rejects all pending executions. */
    const cleanup = () => {
      isClosed = true;
      if (worker) {
        if (workerRuntime === 'node' && nodeWorkerPool) {
          nodeWorkerPool.release(worker);
        } else {
          worker.terminate();
        }
        worker = null;
        workerRuntime = null;
      }
      for (const pending of pendingExecutions.values()) {
        pending.reject(new Error('Worker terminated'));
      }
      pendingExecutions.clear();
    };

    /** Fails all pending executions when the worker errors unexpectedly. */
    const handleWorkerError = (error: Error) => {
      if (worker) {
        if (workerRuntime === 'node' && nodeWorkerPool) {
          nodeWorkerPool.release(worker);
        } else {
          worker.terminate();
        }
        worker = null;
        workerRuntime = null;
      }
      for (const pending of pendingExecutions.values()) {
        pending.reject(error);
      }
      pendingExecutions.clear();
    };

    if (canUseWebWorker()) {
      worker = createBrowserWorker(source, this.permissions);
      workerRuntime = 'browser';
      worker.onmessage = handleWorkerMessage;
      worker.onerror = handleWorkerError;
      try {
        worker.postMessage({
          type: 'init',
          globals: serializableGlobals,
          fnNames: [...fnMap.keys()],
          permissions: [...this.permissions],
          allowUnsafeNodeHostAccess: this.allowUnsafeNodeHostAccess,
          outputMode: this.outputMode,
          captureConsole: this.captureConsole,
        });
      } catch (error) {
        cleanup();
        throw error;
      }
    }

    /** Lazily creates/initializes worker in the current runtime. */
    const ensureWorker = async (): Promise<void> => {
      if (worker) {
        return;
      }
      if (isClosed) {
        throw new Error('Session is closed');
      }
      if (!isNodeRuntime()) {
        throw new Error(
          'No worker runtime available: Web Worker is unavailable in this environment'
        );
      }
      if (!workerReady) {
        workerReady = (
          nodeWorkerPool ? nodeWorkerPool.acquire() : createNodeWorker(source)
        ).then((created) => {
          if (isClosed) {
            if (nodeWorkerPool) {
              nodeWorkerPool.release(created);
            } else {
              created.terminate();
            }
            throw new Error('Session is closed');
          }

          worker = created;
          workerRuntime = 'node';
          worker.onmessage = handleWorkerMessage;
          worker.onerror = handleWorkerError;
          try {
            worker.postMessage({
              type: 'init',
              globals: serializableGlobals,
              fnNames: [...fnMap.keys()],
              permissions: [...this.permissions],
              allowUnsafeNodeHostAccess: this.allowUnsafeNodeHostAccess,
              outputMode: this.outputMode,
              captureConsole: this.captureConsole,
            });
          } catch (error) {
            if (nodeWorkerPool) {
              nodeWorkerPool.release(created);
            } else {
              created.terminate();
            }
            worker = null;
            workerRuntime = null;
            throw error;
          }
        });
      }
      await workerReady;
    };

    return {
      execute(
        code: string,
        options?: {
          signal?: AbortSignal;
          reservedNames?: readonly string[];
        }
      ): Promise<unknown> {
        if (isClosed) {
          return Promise.reject(new Error('Session is closed'));
        }

        // Block "use strict" directive — it breaks the runtime sandbox
        if (/['"]use strict['"]/.test(code)) {
          return Promise.resolve(
            '[ERROR] "use strict" is not allowed in the runtime session. Remove it and try again.'
          );
        }

        // Block assignment/redeclaration of reserved runtime names.
        const reserved = options?.reservedNames;
        if (reserved) {
          for (const name of reserved) {
            const pattern = new RegExp(
              `(?:^|[;\\n])\\s*(?:(?:var|let|const)\\s+)?${name}\\s*=`
            );
            if (pattern.test(code)) {
              return Promise.resolve(
                `[ERROR] Cannot assign to or redeclare reserved runtime variable '${name}'. ` +
                  `Use a different local variable name (for example: \`ctx\`) or access the original via \`inputs.${name}\`.`
              );
            }
          }
        }

        const signal = options?.signal;
        if (signal?.aborted) {
          return Promise.reject(
            new Error(`Aborted: ${signal.reason ?? 'execution aborted'}`)
          );
        }

        const id = ++nextId;

        return new Promise<unknown>((resolve, reject) => {
          // Timeout
          const timer = setTimeout(() => {
            pendingExecutions.delete(id);
            cleanup();
            reject(new Error('Execution timed out'));
          }, timeout);

          // Wrap resolve/reject to clear timer
          const originalResolve = resolve;
          const originalReject = reject;

          pendingExecutions.set(id, {
            resolve: (v: unknown) => {
              clearTimeout(timer);
              onCleanup();
              originalResolve(v);
            },
            reject: (e: Error) => {
              clearTimeout(timer);
              onCleanup();
              originalReject(e);
            },
          });

          // AbortSignal listener
          let onCleanup = () => {};
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              pendingExecutions.delete(id);
              cleanup();
              originalReject(
                new Error(`Aborted: ${signal.reason ?? 'execution aborted'}`)
              );
            };
            signal.addEventListener('abort', onAbort, { once: true });
            onCleanup = () => {
              signal.removeEventListener('abort', onAbort);
            };
          }

          void ensureWorker()
            .then(() => {
              if (!worker) {
                throw new Error('Worker unavailable');
              }
              worker.postMessage({ type: 'execute', id, code });
            })
            .catch((error: Error) => {
              const pending = pendingExecutions.get(id);
              if (!pending) {
                return;
              }
              pendingExecutions.delete(id);
              clearTimeout(timer);
              onCleanup();
              originalReject(error);
            });
        });
      },

      close() {
        cleanup();
      },
    };
  }

  public toFunction(): AxFunction {
    return {
      name: 'javascriptInterpreter',
      description:
        'Execute JavaScript code in a persistent session and return output.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript code to execute.',
          },
        },
        required: ['code'],
      },
      func: async ({ code }: Readonly<{ code: string }>, options) => {
        const session = this.createSession();
        try {
          return await session.execute(code, { signal: options?.abortSignal });
        } finally {
          session.close();
        }
      },
    };
  }
}

/**
 * Factory function for creating an AxJSRuntime.
 */
export function axCreateJSRuntime(
  options?: Readonly<{
    timeout?: number;
    permissions?: readonly AxJSRuntimePermission[];
    outputMode?: AxJSRuntimeOutputMode;
    captureConsole?: boolean;
    allowUnsafeNodeHostAccess?: boolean;
    nodeWorkerPoolSize?: number;
    debugNodeWorkerPool?: boolean;
  }>
): AxJSRuntime {
  return new AxJSRuntime(options);
}
