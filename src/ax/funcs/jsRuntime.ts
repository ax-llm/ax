import type { AxCodeRuntime, AxCodeSession } from '../agent/rlm.js';
import type { AxFunction } from '../ai/types.js';
import {
  type AxJSRuntimeNodePermissionAllowlist,
  AxJSRuntimePermission,
  type AxJSRuntimeResourceLimits,
  computeNodePermissionExecArgv,
  computeSecurityPostureHash,
} from './jsRuntimeSecurity.js';
import {
  deserializeError,
  findReservedRuntimeNameViolation,
  normalizeCodeSessionSnapshot,
  type SerializedError,
  serializeError,
  splitGlobalsForWorker,
  validateSerializableGlobals,
} from './jsRuntimeSession.js';
import {
  canUseWebWorker,
  createBrowserWorker,
  createNodeWorker,
  getNodeWorkerPool,
  isNodePoolDebugEnabled,
  isNodeRuntime,
  type RLMMessageEvent,
  type RLMWorker,
  resolveNodeWorkerPoolSize,
} from './jsRuntimeWorkers.js';
import { getWorkerSource } from './worker.js';

export { AxJSRuntimePermission };
export type { AxJSRuntimeNodePermissionAllowlist, AxJSRuntimeResourceLimits };

export type AxJSRuntimeOutputMode = 'return' | 'stdout';

/**
 * Browser-compatible JavaScript interpreter for RLM using Web Workers.
 * Creates persistent sessions where variables survive across `execute()` calls.
 */
export class AxJSRuntime implements AxCodeRuntime {
  readonly language = 'JavaScript';
  /** Sessions support patchGlobals + host-driven execute — see AxCodeRuntime. */
  readonly supportsSharedSessions = true;
  private readonly timeout: number;
  private readonly permissions: readonly AxJSRuntimePermission[];
  private readonly allowUnsafeNodeHostAccess: boolean;
  private readonly nodeWorkerPoolSize: number;
  private readonly debugNodeWorkerPool: boolean;
  private readonly outputMode: AxJSRuntimeOutputMode;
  private readonly captureConsole: boolean;
  private readonly blockDynamicImport: boolean;
  private readonly allowedModules: readonly string[];
  private readonly freezeIntrinsics: boolean;
  private readonly blockShadowRealm: boolean;
  private readonly lockWorkerIPC: boolean;
  private readonly preventGlobalThisExtensions: boolean;
  private readonly useNodePermissionModel: boolean | 'auto';
  private readonly nodePermissionAllowlist?: AxJSRuntimeNodePermissionAllowlist;
  private readonly resourceLimits?: AxJSRuntimeResourceLimits;
  private readonly allowDenoRemoteImport: boolean;

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
      /**
       * Block dynamic `import()` at execute time (language-level block on Node
       * via `node:vm` rejector; Deno relies on permission model).
       *
       * Default: true.
       */
      blockDynamicImport?: boolean;
      /**
       * Module specifier allowlist when `blockDynamicImport` is true. This is
       * a narrow dynamic-import gate: allowlisted specifiers are attempted, but
       * full Node module namespace passthrough depends on Node vm semantics.
       * Default: [].
       */
      allowedModules?: readonly string[];
      /**
       * Freeze Object.prototype / Array.prototype / Function.prototype and
       * other intrinsics to prevent prototype pollution.
       *
       * Default: true.
       */
      freezeIntrinsics?: boolean;
      /**
       * Lock `globalThis.ShadowRealm` to undefined. Default: true.
       */
      blockShadowRealm?: boolean;
      /**
       * Lock `self.postMessage` / `self.onmessage` in browser/Deno workers
       * to prevent host-function privilege escalation. Default: true.
       */
      lockWorkerIPC?: boolean;
      /**
       * Call `Object.preventExtensions(globalThis)` in the worker. Breaks
       * top-level `var/let/const` persistence — opt-in only. Default: false.
       */
      preventGlobalThisExtensions?: boolean;
      /**
       * Node-only: engage the Node Permission Model at worker spawn for
       * kernel-enforced defense-in-depth on top of the language-level
       * lockdown. Emits `--permission` on Node ≥ 23.5 (stable flag) or
       * `--experimental-permission` on Node 20–23.4 (same runtime
       * enforcement, pre-stabilization flag name).
       *
       * - 'auto' (default): engage unconditionally on any supported Node.
       *   With no FILESYSTEM/CHILD_PROCESS permission granted, fs and
       *   child_process are blocked at the OS level. Silently skips on
       *   Node < 20, Deno, and browsers (language-level defenses still
       *   apply).
       * - true: engage unconditionally; hard-fail on Node < 20.
       * - false: never engage.
       */
      useNodePermissionModel?: boolean | 'auto';
      /**
       * Fine-grained Node Permission Model allowlist (e.g. fs-read paths).
       */
      nodePermissionAllowlist?: AxJSRuntimeNodePermissionAllowlist;
      /**
       * Node-only: resource limits passed to `worker_threads.Worker`.
       */
      resourceLimits?: AxJSRuntimeResourceLimits;
      /**
       * Deno-only: allow remote module imports (`await import('https://...')`).
       * Default: false — sets `import: false` in the Deno permission set when
       * NETWORK is granted, so data-plane fetch works but remote module
       * loading is blocked at the runtime level.
       */
      allowDenoRemoteImport?: boolean;
    }>
  ) {
    this.timeout = options?.timeout ?? 900_000;
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
    this.blockDynamicImport = options?.blockDynamicImport ?? true;
    this.allowedModules = options?.allowedModules ?? [];
    this.freezeIntrinsics = options?.freezeIntrinsics ?? true;
    this.blockShadowRealm = options?.blockShadowRealm ?? true;
    this.lockWorkerIPC = options?.lockWorkerIPC ?? true;
    this.preventGlobalThisExtensions =
      options?.preventGlobalThisExtensions ?? false;
    this.useNodePermissionModel = options?.useNodePermissionModel ?? 'auto';
    this.nodePermissionAllowlist = options?.nodePermissionAllowlist;
    this.resourceLimits = options?.resourceLimits;
    this.allowDenoRemoteImport = options?.allowDenoRemoteImport ?? false;
  }

  /**
   * Computes Node execArgv for the Permission Model when it should engage,
   * otherwise returns undefined.
   *
   * - 'auto': engages unconditionally on supported Node versions; skips
   *   silently where the Node Permission Model is unavailable.
   * - true: engages unconditionally; hard-fails on Node < 20.
   * - false: never engages.
   */
  private computeNodeExecArgv(): string[] | undefined {
    return computeNodePermissionExecArgv({
      mode: this.useNodePermissionModel,
      permissions: this.permissions,
      nodePermissionAllowlist: this.nodePermissionAllowlist,
    });
  }

  private computeSecurityPostureHash(): string {
    return computeSecurityPostureHash({
      permissions: this.permissions,
      allowUnsafeNodeHostAccess: this.allowUnsafeNodeHostAccess,
      blockDynamicImport: this.blockDynamicImport,
      allowedModules: this.allowedModules,
      freezeIntrinsics: this.freezeIntrinsics,
      blockShadowRealm: this.blockShadowRealm,
      lockWorkerIPC: this.lockWorkerIPC,
      preventGlobalThisExtensions: this.preventGlobalThisExtensions,
    });
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
  createSession(
    globals?: Record<string, unknown>,
    options?: { shouldBubbleError?: (err: unknown) => boolean }
  ): AxCodeSession {
    const source = getWorkerSource();
    // Computed up front so any Node-version/permission-model misconfigurations
    // throw at session creation, not on first execute.
    const nodeExecArgv = isNodeRuntime()
      ? this.computeNodeExecArgv()
      : undefined;
    const securityPostureHash = this.computeSecurityPostureHash();
    const nodeWorkerPool = isNodeRuntime()
      ? getNodeWorkerPool(
          source,
          this.nodeWorkerPoolSize,
          securityPostureHash,
          nodeExecArgv,
          this.resourceLimits
        )
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
    let nextFnRefId = 0;
    const shouldBubbleError = options?.shouldBubbleError;
    let bubbleError: unknown = null;

    // Convert nested function values into worker-callable references.
    const { serializableGlobals, fnMap } = splitGlobalsForWorker(globals, {
      nextFnId: () => ++nextFnRefId,
    });
    validateSerializableGlobals(serializableGlobals);

    // Pending worker requests keyed by correlation ID.
    const pendingRequests = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    let nextId = 0;
    type QueuedSessionOperation = {
      started: boolean;
      settled: boolean;
      signal?: AbortSignal;
      onAbort?: () => void;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      operation: () => Promise<unknown>;
    };
    const queuedOperations: QueuedSessionOperation[] = [];
    let activeQueuedOperation: Promise<void> | null = null;

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

        const pending = pendingRequests.get(typedMsg.id);
        if (pending) {
          pendingRequests.delete(typedMsg.id);
          if (typedMsg.error !== undefined) {
            if (bubbleError) {
              const original = bubbleError as Error;
              bubbleError = null;
              pending.reject(original);
            } else {
              pending.reject(deserializeError(typedMsg.error));
            }
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
            try {
              worker?.postMessage({
                type: 'fn-result',
                id: typedMsg.id,
                value,
              });
            } catch {
              // Non-cloneable value (e.g. contains a Promise); fall back to string.
              worker?.postMessage({
                type: 'fn-result',
                id: typedMsg.id,
                value: String(value),
              });
            }
          })
          .catch((err: Error) => {
            if (shouldBubbleError?.(err)) {
              bubbleError = err;
            }
            worker?.postMessage({
              type: 'fn-result',
              id: typedMsg.id,
              error: serializeError(err) as SerializedError,
            });
          });
      }
    };

    /** Terminates the current worker, allowing a new one to be created on next execute(). */
    const resetWorker = () => {
      if (worker) {
        if (workerRuntime === 'node' && nodeWorkerPool) {
          nodeWorkerPool.release(worker);
        } else {
          worker.terminate();
        }
        worker = null;
        workerRuntime = null;
      }
      workerReady = null;
    };

    /** Permanently closes the session and rejects all pending executions. */
    const cleanup = () => {
      isClosed = true;
      resetWorker();
      for (const operation of queuedOperations) {
        if (!operation.started && !operation.settled) {
          operation.settled = true;
          if (operation.signal && operation.onAbort) {
            operation.signal.removeEventListener('abort', operation.onAbort);
          }
          operation.reject(new Error('Worker terminated'));
        }
      }
      queuedOperations.length = 0;
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error('Worker terminated'));
      }
      pendingRequests.clear();
    };

    /** Fails all pending executions when the worker errors unexpectedly. */
    const handleWorkerError = (error: Error) => {
      resetWorker();
      for (const pending of pendingRequests.values()) {
        pending.reject(error);
      }
      pendingRequests.clear();
    };

    const postInitMessage = (targetWorker: RLMWorker) => {
      targetWorker.postMessage({
        type: 'init',
        globals: serializableGlobals,
        fnNames: [...fnMap.keys()],
        permissions: [...this.permissions],
        allowUnsafeNodeHostAccess: this.allowUnsafeNodeHostAccess,
        outputMode: this.outputMode,
        captureConsole: this.captureConsole,
        blockDynamicImport: this.blockDynamicImport,
        blockShadowRealm: this.blockShadowRealm,
        freezeIntrinsics: this.freezeIntrinsics,
        lockWorkerIPC: this.lockWorkerIPC,
        preventGlobalThisExtensions: this.preventGlobalThisExtensions,
        allowedModules: [...this.allowedModules],
      });
    };

    if (canUseWebWorker()) {
      worker = createBrowserWorker(
        source,
        this.permissions,
        this.allowDenoRemoteImport
      );
      workerRuntime = 'browser';
      worker.onmessage = handleWorkerMessage;
      worker.onerror = handleWorkerError;
      try {
        postInitMessage(worker);
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
      if (canUseWebWorker()) {
        worker = createBrowserWorker(
          source,
          this.permissions,
          this.allowDenoRemoteImport
        );
        workerRuntime = 'browser';
        worker.onmessage = handleWorkerMessage;
        worker.onerror = handleWorkerError;
        try {
          postInitMessage(worker);
        } catch (error) {
          cleanup();
          throw error;
        }
        return;
      }
      if (!isNodeRuntime()) {
        throw new Error(
          'No worker runtime available: Web Worker is unavailable in this environment'
        );
      }
      if (!workerReady) {
        workerReady = (
          nodeWorkerPool
            ? nodeWorkerPool.acquire()
            : createNodeWorker(source, nodeExecArgv, this.resourceLimits)
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
            postInitMessage(worker);
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

    const dispatchWorkerRequest = (
      payload: Record<string, unknown>,
      options: Readonly<{
        signal?: AbortSignal;
        timeoutMessage: string;
      }>
    ): Promise<unknown> => {
      if (isClosed) {
        return Promise.reject(new Error('Session is closed'));
      }

      const signal = options.signal;
      if (signal?.aborted) {
        return Promise.reject(
          new Error(`Aborted: ${signal.reason ?? 'execution aborted'}`)
        );
      }

      const id = ++nextId;

      return new Promise<unknown>((resolve, reject) => {
        const originalResolve = resolve;
        const originalReject = reject;
        let timer: ReturnType<typeof setTimeout> | undefined;

        let onCleanup = () => {};
        pendingRequests.set(id, {
          resolve: (value: unknown) => {
            if (timer) {
              clearTimeout(timer);
            }
            onCleanup();
            originalResolve(value);
          },
          reject: (error: Error) => {
            if (timer) {
              clearTimeout(timer);
            }
            onCleanup();
            originalReject(error);
          },
        });

        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            pendingRequests.delete(id);
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
            timer = setTimeout(() => {
              pendingRequests.delete(id);
              resetWorker();
              for (const pending of pendingRequests.values()) {
                pending.reject(new Error('Worker terminated'));
              }
              pendingRequests.clear();
              reject(new Error(options.timeoutMessage));
            }, timeout);
            worker.postMessage({ ...payload, id });
          })
          .catch((error: Error) => {
            const pending = pendingRequests.get(id);
            if (!pending) {
              return;
            }
            pendingRequests.delete(id);
            clearTimeout(timer);
            onCleanup();
            originalReject(error);
          });
      });
    };

    const enqueueSessionRequest = <T>(
      signal: AbortSignal | undefined,
      operation: () => Promise<T>
    ): Promise<T> => {
      if (isClosed) {
        return Promise.reject(new Error('Session is closed'));
      }
      if (signal?.aborted) {
        return Promise.reject(
          new Error(`Aborted: ${signal.reason ?? 'execution aborted'}`)
        );
      }

      return new Promise<T>((resolve, reject) => {
        const queuedOperation: QueuedSessionOperation = {
          started: false,
          settled: false,
          signal,
          resolve: resolve as (value: unknown) => void,
          reject,
          operation: operation as () => Promise<unknown>,
        };

        if (signal) {
          const onAbort = () => {
            if (queuedOperation.settled) {
              return;
            }
            queuedOperation.settled = true;
            const index = queuedOperations.indexOf(queuedOperation);
            if (index !== -1) {
              queuedOperations.splice(index, 1);
            }
            signal.removeEventListener('abort', onAbort);
            reject(
              new Error(`Aborted: ${signal.reason ?? 'execution aborted'}`)
            );
          };
          queuedOperation.onAbort = onAbort;
          signal.addEventListener('abort', onAbort, { once: true });
        }

        queuedOperations.push(queuedOperation);

        const processNextQueuedOperation = () => {
          if (activeQueuedOperation) {
            return;
          }

          const nextOperation = queuedOperations.find(
            (queued) => !queued.started && !queued.settled
          );
          if (!nextOperation) {
            return;
          }

          const finish = () => {
            activeQueuedOperation = null;
            processNextQueuedOperation();
          };

          activeQueuedOperation = (async () => {
            if (nextOperation.settled) {
              return;
            }
            if (isClosed) {
              nextOperation.settled = true;
              if (nextOperation.signal && nextOperation.onAbort) {
                nextOperation.signal.removeEventListener(
                  'abort',
                  nextOperation.onAbort
                );
              }
              nextOperation.reject(new Error('Worker terminated'));
              return;
            }
            if (nextOperation.signal?.aborted) {
              nextOperation.settled = true;
              if (nextOperation.onAbort) {
                nextOperation.signal.removeEventListener(
                  'abort',
                  nextOperation.onAbort
                );
              }
              nextOperation.reject(
                new Error(
                  `Aborted: ${nextOperation.signal.reason ?? 'execution aborted'}`
                )
              );
              return;
            }

            nextOperation.started = true;

            try {
              const value = await nextOperation.operation();
              if (nextOperation.settled) {
                return;
              }
              nextOperation.settled = true;
              if (nextOperation.signal && nextOperation.onAbort) {
                nextOperation.signal.removeEventListener(
                  'abort',
                  nextOperation.onAbort
                );
              }
              nextOperation.resolve(value);
            } catch (error) {
              if (nextOperation.settled) {
                return;
              }
              nextOperation.settled = true;
              if (nextOperation.signal && nextOperation.onAbort) {
                nextOperation.signal.removeEventListener(
                  'abort',
                  nextOperation.onAbort
                );
              }
              nextOperation.reject(error as Error);
            } finally {
              const index = queuedOperations.indexOf(nextOperation);
              if (index !== -1) {
                queuedOperations.splice(index, 1);
              }
              finish();
            }
          })().catch(() => {
            finish();
          });
        };

        processNextQueuedOperation();
      });
    };

    return {
      execute(
        code: string,
        options?: {
          signal?: AbortSignal;
          reservedNames?: readonly string[];
        }
      ) {
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
          const violation = findReservedRuntimeNameViolation(code, reserved);
          if (violation) {
            return Promise.resolve(
              `[ERROR] Cannot assign to, redeclare, or shadow reserved runtime variable '${violation}'. ` +
                `Use a different local variable name (for example: \`ctx\`) or access the original via \`inputs.${violation}\`.`
            );
          }
        }

        return enqueueSessionRequest(options?.signal, () =>
          dispatchWorkerRequest(
            { type: 'execute', code },
            {
              signal: options?.signal,
              timeoutMessage: 'Execution timed out',
            }
          )
        );
      },

      inspectGlobals(options?: {
        signal?: AbortSignal;
        reservedNames?: readonly string[];
      }) {
        if (isClosed) {
          return Promise.reject(new Error('Session is closed'));
        }

        return enqueueSessionRequest(options?.signal, () =>
          dispatchWorkerRequest(
            {
              type: 'inspect-globals',
              reservedNames: options?.reservedNames,
            },
            {
              signal: options?.signal,
              timeoutMessage: 'Global inspection timed out',
            }
          ).then((value) =>
            typeof value === 'string'
              ? value
              : value === undefined
                ? ''
                : JSON.stringify(value)
          )
        );
      },

      snapshotGlobals(options?: {
        signal?: AbortSignal;
        reservedNames?: readonly string[];
      }) {
        if (isClosed) {
          return Promise.reject(new Error('Session is closed'));
        }

        return enqueueSessionRequest(options?.signal, () =>
          dispatchWorkerRequest(
            {
              type: 'snapshot-globals',
              reservedNames: options?.reservedNames,
            },
            {
              signal: options?.signal,
              timeoutMessage: 'Global snapshot timed out',
            }
          ).then(normalizeCodeSessionSnapshot)
        );
      },

      async patchGlobals(
        globals: Record<string, unknown>,
        options?: { signal?: AbortSignal }
      ) {
        if (!globals || typeof globals !== 'object' || Array.isArray(globals)) {
          throw new Error('patchGlobals expects an object');
        }

        const { serializableGlobals: serializablePatch, fnMap: patchFnMap } =
          splitGlobalsForWorker(globals, {
            nextFnId: () => ++nextFnRefId,
          });
        validateSerializableGlobals(serializablePatch);

        if (Object.keys(serializablePatch).length === 0) {
          return;
        }

        await enqueueSessionRequest(options?.signal, () =>
          dispatchWorkerRequest(
            { type: 'update-globals', globals: serializablePatch },
            {
              signal: options?.signal,
              timeoutMessage: 'Global patch timed out',
            }
          )
        );

        for (const [key, value] of Object.entries(serializablePatch)) {
          serializableGlobals[key] = value;
        }
        for (const [key, fn] of patchFnMap.entries()) {
          fnMap.set(key, fn);
        }
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
    blockDynamicImport?: boolean;
    allowedModules?: readonly string[];
    freezeIntrinsics?: boolean;
    blockShadowRealm?: boolean;
    lockWorkerIPC?: boolean;
    preventGlobalThisExtensions?: boolean;
    useNodePermissionModel?: boolean | 'auto';
    nodePermissionAllowlist?: AxJSRuntimeNodePermissionAllowlist;
    resourceLimits?: AxJSRuntimeResourceLimits;
    allowDenoRemoteImport?: boolean;
  }>
): AxJSRuntime {
  return new AxJSRuntime(options);
}
