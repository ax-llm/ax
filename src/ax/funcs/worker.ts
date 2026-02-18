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
const _OUTPUT_MODE_RETURN = 'return';
const _OUTPUT_MODE_STDOUT = 'stdout';
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

const _formatOutputArg = (value) => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_e) {
    return String(value);
  }
};

const _captureConsoleMethod = (methodName, output) => {
  const original =
    _scope.console && typeof _scope.console[methodName] === 'function'
      ? _scope.console[methodName].bind(_scope.console)
      : null;

  const wrapped = (...args) => {
    output.push(args.map(_formatOutputArg).join(' '));
    if (original) {
      try {
        original(...args);
      } catch (_e) {
        // Ignore console passthrough failures.
      }
    }
  };

  if (!_scope.console || typeof _scope.console !== 'object') {
    _scope.console = {};
  }
  _scope.console[methodName] = wrapped;

  return () => {
    if (!_scope.console || typeof _scope.console !== 'object') {
      return;
    }
    if (original) {
      _scope.console[methodName] = original;
      return;
    }
    try {
      delete _scope.console[methodName];
    } catch (_e) {
      _scope.console[methodName] = undefined;
    }
  };
};

// Pending function-call promises keyed by call ID
const _fnPending = new Map();
let _fnCallId = 0;
let _outputMode = _OUTPUT_MODE_RETURN;
let _captureConsole = false;

const _MAX_ERROR_CAUSE_DEPTH = ${MAX_ERROR_CAUSE_DEPTH};
const _serializeError = (err, depth, seen) => {
  depth = depth || 0;
  seen = seen || new Set();
  if (depth > _MAX_ERROR_CAUSE_DEPTH) return { name: 'Error', message: '[cause chain truncated]' };
  if (err && typeof err === 'object' && seen.has(err)) return { name: 'Error', message: '[circular]' };
  if (err && typeof err === 'object') seen.add(err);
  const name = (err && err.name != null) ? String(err.name) : 'Error';
  const message = (err && err.message != null) ? String(err.message) : String(err);
  const stack = (err && typeof err.stack === 'string') ? err.stack : undefined;
  let cause;
  if (err && typeof err.cause !== 'undefined' && depth < _MAX_ERROR_CAUSE_DEPTH) {
    try {
      const c = err.cause;
      if (c instanceof Error || (c && typeof c === 'object' && ('message' in c || 'name' in c))) {
        cause = _serializeError(c, depth + 1, seen);
      } else {
        cause = { name: 'Error', message: String(c) };
      }
    } catch (_) { cause = { name: 'Error', message: String(err.cause) }; }
  }
  const out = { name, message };
  if (stack !== undefined) out.stack = stack;
  if (cause !== undefined) out.cause = cause;
  if (err && typeof err === 'object' && 'data' in err && err.data !== undefined) {
    try {
      out.data = typeof structuredClone === 'function' ? structuredClone(err.data) : err.data;
    } catch (_) {}
  }
  return out;
};
const _deserializeError = (payload) => {
  if (typeof payload === 'string') return new Error(payload);
  if (!payload || typeof payload !== 'object') return new Error(String(payload));
  const name = payload.name != null ? String(payload.name) : 'Error';
  const message = payload.message != null ? String(payload.message) : '';
  const err = new Error(message);
  err.name = name;
  if (typeof payload.stack === 'string') err.stack = payload.stack;
  if (payload.cause !== undefined) err.cause = _deserializeError(payload.cause);
  if (payload.data !== undefined) err.data = payload.data;
  return err;
};

_setOnMessage(async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    _outputMode =
      msg.outputMode === _OUTPUT_MODE_STDOUT
        ? _OUTPUT_MODE_STDOUT
        : _OUTPUT_MODE_RETURN;
    _captureConsole =
      msg.captureConsole !== undefined
        ? Boolean(msg.captureConsole)
        : _outputMode === _OUTPUT_MODE_STDOUT;

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
        pending.reject(_deserializeError(msg.error));
      } else {
        pending.resolve(msg.value);
      }
    }
    return;
  }

  if (msg.type === 'execute') {
    const { id, code } = msg;
    const output = [];
    const restoreFns = [];
    const previousPrint = _scope.print;
    const pushOutput = (...args) => {
      output.push(args.map(_formatOutputArg).join(' '));
    };

    if (_outputMode === _OUTPUT_MODE_STDOUT) {
      _scope.print = (...args) => {
        pushOutput(...args);
      };
    }
    if (_captureConsole) {
      restoreFns.push(_captureConsoleMethod('log', output));
      restoreFns.push(_captureConsoleMethod('info', output));
      restoreFns.push(_captureConsoleMethod('warn', output));
      restoreFns.push(_captureConsoleMethod('error', output));
    }

    const cleanupOutputCapture = () => {
      for (const restore of restoreFns) {
        try {
          restore();
        } catch (_e) {
          // Best effort cleanup.
        }
      }
      if (_outputMode === _OUTPUT_MODE_STDOUT) {
        if (previousPrint === undefined) {
          try {
            delete _scope.print;
          } catch (_e) {
            _scope.print = undefined;
          }
        } else {
          _scope.print = previousPrint;
        }
      }
    };

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
      let value = result;
      if (_outputMode === _OUTPUT_MODE_STDOUT) {
        const stdout = output.join('\\n').trim();
        if (stdout) {
          value = stdout;
        }
      }

      try {
        _send({ type: 'result', id, value });
      } catch {
        // Value not structured-cloneable, fall back to string
        _send({ type: 'result', id, value: String(value) });
      }
    } catch (err) {
      const isCodeError =
        err instanceof SyntaxError ||
        err instanceof TypeError ||
        err instanceof RangeError ||
        err instanceof ReferenceError ||
        err instanceof AggregateError ||
        err instanceof EvalError ||
        err instanceof URIError;
      if (isCodeError) {
        const name = (err && err.name != null) ? String(err.name) : 'Error';
        const msg = (err && err.message != null) ? String(err.message) : String(err);
        _send({ type: 'result', id, value: name + ': ' + msg });
      } else {
        _send({ type: 'result', id, error: _serializeError(err) });
      }
    } finally {
      cleanupOutputCapture();
    }
  }
});
`;
}
