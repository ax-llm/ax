import type { AxFunction } from '../ai/types.js';
import type { AxCodeRuntime, AxCodeSession } from '../prompts/rlm.js';

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

/** Default number of prewarmed Node workers kept per worker-source key. */
const DEFAULT_NODE_WORKER_POOL_SIZE = 4;
const MAX_NODE_WORKER_POOL_SIZE = 16;
const FUNCTION_REF_KEY = '__ax_rlm_fn_ref__';

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

  const wrapped: RLMWorker = {
    postMessage: (message) => nodeWorker.postMessage(message),
    terminate: () => {
      void nodeWorker.terminate();
    },
    onmessage: null,
    onerror: null,
  };

  nodeWorker.on('message', (data) => {
    wrapped.onmessage?.({ data });
  });

  nodeWorker.on('error', (error) => {
    wrapped.onerror?.(error);
  });

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
    const worker = this.idle.pop();
    if (worker) {
      this.warm();
      return worker;
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

/**
 * Returns the inline source code for the Web Worker.
 * The worker handles `init` and `execute` messages, proxies function calls
 * back to the main thread, and supports both sync and async code paths.
 */
function getWorkerSource(): string {
  return `
'use strict';

const _isNodeWorker =
  typeof require === 'function' &&
  typeof process !== 'undefined' &&
  !!(process.versions && process.versions.node);

let _nodeParentPort = null;
if (_isNodeWorker) {
  try {
    _nodeParentPort = require('node:worker_threads').parentPort;
  } catch (_e) {
    _nodeParentPort = null;
  }
}

const _scope = typeof self !== 'undefined' ? self : globalThis;
const _AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const _FUNCTION_REF_KEY = '${FUNCTION_REF_KEY}';
const _LAST_LINE_NON_EXPRESSION_START =
  /^(if|for|while|switch|try|catch|finally|function|class|import|export|throw|return|var|let|const|break|continue|debugger)\\b/;
const _TOP_LEVEL_RETURN_ONLY = /^\\s*return\\s+([^\\n;]+?)\\s*;?\\s*$/;
const _injectAsyncAutoReturn = (code) => {
  const lines = code.split('\\n');
  let tail = lines.length - 1;
  while (tail >= 0 && !lines[tail].trim()) {
    tail -= 1;
  }
  if (tail < 0) {
    return code;
  }

  let head = lines.slice(0, tail).join('\\n');
  const rawLastLine = lines[tail].trim();
  let lastLine = rawLastLine.replace(/;\\s*$/, '');
  const lastSemi = lastLine.lastIndexOf(';');
  if (lastSemi !== -1) {
    const maybeExpression = lastLine.slice(lastSemi + 1).trim();
    const prefixStatement = lastLine.slice(0, lastSemi).trim();
    if (maybeExpression) {
      if (prefixStatement) {
        head = head ? \`\${head}\\n\${prefixStatement};\` : \`\${prefixStatement};\`;
      }
      lastLine = maybeExpression;
    }
  }

  if (!lastLine) {
    return code;
  }
  if (_LAST_LINE_NON_EXPRESSION_START.test(lastLine)) {
    return code;
  }
  if (lastLine === '}' || lastLine === '};') {
    return code;
  }

  return head ? \`\${head}\\nreturn (\${lastLine});\` : \`return (\${lastLine});\`;
};
const _rewriteTopLevelReturnForSyncEval = (code) => {
  const match = _TOP_LEVEL_RETURN_ONLY.exec(code);
  if (!match) {
    return code;
  }
  const expression = (match[1] || '').trim();
  return expression || code;
};
const _send = (msg) => {
  if (_nodeParentPort) {
    _nodeParentPort.postMessage(msg);
    return;
  }
  _scope.postMessage(msg);
};
const _setOnMessage = (handler) => {
  if (_nodeParentPort) {
    _nodeParentPort.on('message', (data) => handler({ data }));
    return;
  }
  _scope.onmessage = handler;
};

// Pending function-call promises keyed by call ID
const _fnPending = new Map();
let _fnCallId = 0;

_setOnMessage(async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    const _createFnProxy = (name) => (...args) => {
      const id = ++_fnCallId;
      return new Promise((resolve, reject) => {
        _fnPending.set(id, { resolve, reject });
        _send({ type: 'fn-call', id, name, args });
      });
    };

    const _rehydrateFnRefs = (value) => {
      if (!value || typeof value !== 'object') {
        return value;
      }

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          value[i] = _rehydrateFnRefs(value[i]);
        }
        return value;
      }

      if (_FUNCTION_REF_KEY in value) {
        const ref = value[_FUNCTION_REF_KEY];
        if (typeof ref === 'string') {
          return _createFnProxy(ref);
        }
        return undefined;
      }

      for (const [k, v] of Object.entries(value)) {
        value[k] = _rehydrateFnRefs(v);
      }
      return value;
    };

    // Set serializable globals on self
    if (msg.globals) {
      for (const [k, v] of Object.entries(msg.globals)) {
        _scope[k] = _rehydrateFnRefs(v);
      }
    }
    // Backward compatibility: allow explicit top-level function proxies.
    if (msg.fnNames) {
      for (const name of msg.fnNames) {
        _scope[name] = _createFnProxy(name);
      }
    }

    // Sandbox lockdown: remove dangerous globals not covered by granted permissions
    const _PERM_GLOBALS = {
      'network': ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
      'storage': ['indexedDB', 'caches'],
      'code-loading': ['importScripts'],
      'communication': ['BroadcastChannel'],
      'timing': ['performance'],
      'workers': ['Worker', 'SharedWorker'],
    };
    const _granted = new Set(msg.permissions || []);
    for (const [perm, names] of Object.entries(_PERM_GLOBALS)) {
      if (!_granted.has(perm)) {
        for (const name of names) {
          try {
            Object.defineProperty(_scope, name, {
              value: undefined,
              writable: false,
              configurable: false,
            });
          } catch (_e) {
            // Best-effort: some globals may already be non-configurable
          }
        }
      }
    }

    // Node runtime lockdown (safer default): hide process/require from generated code.
    // This is best-effort and can be opted out via allowUnsafeNodeHostAccess.
    if (_isNodeWorker && !msg.allowUnsafeNodeHostAccess) {
      for (const name of ['process', 'require']) {
        try {
          Object.defineProperty(_scope, name, {
            value: undefined,
            writable: false,
            configurable: false,
          });
        } catch (_e) {
          // Best-effort lockdown
        }
      }
    }

    return;
  }

  if (msg.type === 'fn-result') {
    const pending = _fnPending.get(msg.id);
    if (pending) {
      _fnPending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.value);
      }
    }
    return;
  }

  if (msg.type === 'execute') {
    const { id, code } = msg;
    try {
      let result;
      if (/\\bawait\\b/.test(code)) {
        // Async path: compile as async function so top-level await/return work.
        // Bare assignments persist via global object in non-strict function code.
        // Also auto-return a simple trailing expression when no explicit return.
        let asyncCode = code;
        try {
          asyncCode = _injectAsyncAutoReturn(code);
        } catch (_e) {
          asyncCode = code;
        }
        const fn = new _AsyncFunction(asyncCode);
        result = await fn();
      } else {
        // Sync path: indirect eval runs in worker global scope.
        // var declarations persist on self.
        const syncCode = _rewriteTopLevelReturnForSyncEval(code);
        result = (0, eval)(syncCode);
      }
      try {
        _send({ type: 'result', id, value: result });
      } catch {
        // Value not structured-cloneable, fall back to string
        _send({ type: 'result', id, value: String(result) });
      }
    } catch (err) {
      _send({ type: 'result', id, error: err.message || String(err) });
    }
  }
});
`;
}

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

  constructor(
    options?: Readonly<{
      timeout?: number;
      permissions?: readonly AxJSRuntimePermission[];
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
    this.nodeWorkerPoolSize = resolveNodeWorkerPoolSize(
      options?.nodeWorkerPoolSize
    );
    this.debugNodeWorkerPool = isNodePoolDebugEnabled(options);
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
        error?: string;
      };

      if (typedMsg.type === 'result') {
        if (typeof typedMsg.id !== 'number') {
          return;
        }

        const pending = pendingExecutions.get(typedMsg.id);
        if (pending) {
          pendingExecutions.delete(typedMsg.id);
          if (typedMsg.error) {
            pending.reject(new Error(typedMsg.error));
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
              error: err.message || String(err),
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
        options?: { signal?: AbortSignal }
      ): Promise<unknown> {
        if (isClosed) {
          return Promise.reject(new Error('Session is closed'));
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
    allowUnsafeNodeHostAccess?: boolean;
    nodeWorkerPoolSize?: number;
    debugNodeWorkerPool?: boolean;
  }>
): AxJSRuntime {
  return new AxJSRuntime(options);
}
