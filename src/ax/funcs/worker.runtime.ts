export type AxWorkerRuntimeConfig = Readonly<{
  functionRefKey: string;
  maxErrorCauseDepth: number;
}>;

export function axWorkerRuntime(config: AxWorkerRuntimeConfig): void {

  // Keep runtime helpers inside this function. getWorkerSource() stringifies this
  // function and injects it into worker source, so outer-scope functions are not available.

  type WorkerEvent = { data: unknown };
  type NodeParentPort = {
    postMessage: (message: unknown) => void;
    on: (event: 'message', handler: (data: unknown) => void) => void;
  };
  type FnPending = {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  };
  type SerializedError = {
    name: string;
    message: string;
    stack?: string;
    cause?: string | SerializedError;
    data?: unknown;
  };

  const _scope = (typeof self !== 'undefined' ? self : globalThis) as unknown as {
    [key: string]: unknown;
    postMessage?: (message: unknown) => void;
    onmessage?: ((event: WorkerEvent) => void) | null;
    print?: (...args: unknown[]) => void;
    console?: Record<string, unknown>;
  };
  const _AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const _FUNCTION_REF_KEY = config.functionRefKey;
  const _OUTPUT_MODE_RETURN = 'return';
  const _OUTPUT_MODE_STDOUT = 'stdout';
  const _LAST_LINE_NON_EXPRESSION_START =
    /^(if|for|while|switch|try|catch|finally|function|class|import|export|throw|return|var|let|const|break|continue|debugger)\b/;
  const _TOP_LEVEL_RETURN_ONLY = /^\s*return\s+([^\n;]+?)\s*;?\s*$/;
  const _PERM_GLOBALS = {
    network: ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
    storage: ['indexedDB', 'caches'],
    'code-loading': ['importScripts'],
    communication: ['BroadcastChannel'],
    timing: ['performance'],
    workers: ['Worker', 'SharedWorker'],
  } as const;

  const _detectNodeParentPort = (): {
    isNodeWorker: boolean;
    parentPort: NodeParentPort | null;
  } => {
    const isNodeLike =
      typeof require === 'function' &&
      typeof process !== 'undefined' &&
      !!(process.versions && process.versions.node);

    if (!isNodeLike) {
      return { isNodeWorker: false, parentPort: null };
    }

    try {
      const workerThreads = require('node:worker_threads') as {
        parentPort?: NodeParentPort | null;
      };
      return {
        isNodeWorker: true,
        parentPort: workerThreads.parentPort ?? null,
      };
    } catch {
      return { isNodeWorker: true, parentPort: null };
    }
  };

  const { isNodeWorker: _isNodeWorker, parentPort: _nodeParentPort } =
    _detectNodeParentPort();

  const _createMessageBridge = () => {
    if (!_nodeParentPort && typeof _scope.postMessage !== 'function') {
      throw new Error('Worker transport unavailable: no postMessage channel');
    }

    const send = (message: unknown): void => {
      if (_nodeParentPort) {
        _nodeParentPort.postMessage(message);
        return;
      }
      _scope.postMessage!(message);
    };

    const setOnMessage = (handler: (event: WorkerEvent) => void): void => {
      if (_nodeParentPort) {
        _nodeParentPort.on('message', (data) => handler({ data }));
        return;
      }
      _scope.onmessage = handler;
    };

    return { send, setOnMessage };
  };

  const { send: _send, setOnMessage: _setOnMessage } = _createMessageBridge();

  const _ensureTrailingNewline = (code: string): string => {
    if (!code) {
      return code;
    }
    return /\r?\n$/.test(code) ? code : `${code}\n`;
  };

  const _isCommentLikeLine = (line: string): boolean => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    );
  };

  const _findLastMeaningfulLineIndex = (lines: string[]): number => {
    let tail = lines.length - 1;
    while (tail >= 0) {
      const trimmed = lines[tail]!.trim();
      if (trimmed && !_isCommentLikeLine(trimmed)) {
        break;
      }
      tail -= 1;
    }
    return tail;
  };

  const _isNonExpressionCandidate = (expression: string): boolean => {
    if (!expression) {
      return true;
    }

    const firstMeaningfulLine = expression
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim();

    if (!firstMeaningfulLine) {
      return true;
    }

    if (_LAST_LINE_NON_EXPRESSION_START.test(firstMeaningfulLine)) {
      return true;
    }

    return (
      (firstMeaningfulLine.startsWith('{') &&
        !firstMeaningfulLine.startsWith('({')) ||
      firstMeaningfulLine === '}' ||
      firstMeaningfulLine === '};' ||
      _isCommentLikeLine(firstMeaningfulLine)
    );
  };

  const _rewriteSingleLineExpressionCandidate = (
    baseHead: string,
    rawCandidate: string
  ): { head: string; expression: string } | null => {
    let head = baseHead;
    let expression = rawCandidate.trim().replace(/;\s*$/, '');

    if (!expression) {
      return null;
    }

    const lastSemi = expression.lastIndexOf(';');
    if (lastSemi !== -1) {
      const maybeExpression = expression.slice(lastSemi + 1).trim();
      const prefixStatement = expression.slice(0, lastSemi).trim();
      if (maybeExpression) {
        if (
          maybeExpression.startsWith('//') ||
          maybeExpression.startsWith('/*')
        ) {
          if (prefixStatement) {
            expression = prefixStatement;
          }
        } else {
          if (prefixStatement) {
            head = head ? `${head}\n${prefixStatement};` : `${prefixStatement};`;
          }
          expression = maybeExpression;
        }
      }
    }

    if (_isNonExpressionCandidate(expression)) {
      return null;
    }

    return { head, expression };
  };

  const _buildAsyncAutoReturnSource = (
    lines: string[],
    start: number,
    tail: number
  ): string | null => {
    const baseHead = lines.slice(0, start).join('\n');
    const rawCandidate = lines.slice(start, tail + 1).join('\n').trim();

    if (!rawCandidate) {
      return null;
    }

    if (!rawCandidate.includes('\n')) {
      const singleLine = _rewriteSingleLineExpressionCandidate(
        baseHead,
        rawCandidate
      );
      if (!singleLine) {
        return null;
      }
      return singleLine.head
        ? `${singleLine.head}\nreturn (\n${singleLine.expression}\n);`
        : `return (\n${singleLine.expression}\n);`;
    }

    if (_isNonExpressionCandidate(rawCandidate)) {
      return null;
    }

    return baseHead
      ? `${baseHead}\nreturn (\n${rawCandidate}\n);`
      : `return (\n${rawCandidate}\n);`;
  };

  const _canCompileAsyncSource = (source: string): boolean => {
    try {
      void new _AsyncFunction(source);
      return true;
    } catch {
      return false;
    }
  };

  const _injectAsyncAutoReturn = (code: string): string => {
    const lines = code.split('\n');
    const tail = _findLastMeaningfulLineIndex(lines);
    if (tail < 0) {
      return code;
    }

    // Try progressively larger trailing slices until we find a syntactically-valid
    // expression we can wrap in `return (...)`.
    const seenCandidateSources = new Set<string>();
    for (let start = tail; start >= 0; start -= 1) {
      const startLine = lines[start] ?? '';
      if (!startLine.trim() || _isCommentLikeLine(startLine)) {
        continue;
      }

      const candidateSource = _buildAsyncAutoReturnSource(lines, start, tail);
      if (!candidateSource) {
        continue;
      }
      if (seenCandidateSources.has(candidateSource)) {
        continue;
      }
      seenCandidateSources.add(candidateSource);
      if (_canCompileAsyncSource(candidateSource)) {
        return candidateSource;
      }
    }

    return code;
  };

  const _rewriteTopLevelReturnForSyncEval = (code: string): string => {
    const match = _TOP_LEVEL_RETURN_ONLY.exec(code);
    if (!match) {
      return code;
    }
    const expression = (match[1] || '').trim();
    return expression || code;
  };

  const _formatOutputArg = (value: unknown): string => {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const _captureConsoleMethod = (
    methodName: string,
    output: string[]
  ): (() => void) => {
    const consoleObject =
      _scope.console && typeof _scope.console === 'object' ? _scope.console : null;
    const existingMethod = consoleObject?.[methodName];
    const original =
      typeof existingMethod === 'function'
        ? (...args: unknown[]) =>
            (existingMethod as (...args: unknown[]) => unknown).apply(
              consoleObject,
              args
            )
        : null;

    const wrapped = (...args: unknown[]) => {
      output.push(args.map(_formatOutputArg).join(' '));
      if (original) {
        try {
          original(...args);
        } catch {
          // Ignore console passthrough failures.
        }
      }
    };

    if (!_scope.console || typeof _scope.console !== 'object') {
      _scope.console = {};
    }
    (_scope.console as Record<string, unknown>)[methodName] = wrapped;

    return () => {
      if (!_scope.console || typeof _scope.console !== 'object') {
        return;
      }
      if (original) {
        (_scope.console as Record<string, unknown>)[methodName] = original;
        return;
      }
      try {
        delete (_scope.console as Record<string, unknown>)[methodName];
      } catch {
        (_scope.console as Record<string, unknown>)[methodName] = undefined;
      }
    };
  };

  const _captureConsoleMethods = (output: string[]): Array<() => void> => {
    const restoreFns: Array<() => void> = [];
    if (_captureConsole) {
      restoreFns.push(_captureConsoleMethod('log', output));
      restoreFns.push(_captureConsoleMethod('info', output));
      restoreFns.push(_captureConsoleMethod('warn', output));
      restoreFns.push(_captureConsoleMethod('error', output));
    }
    return restoreFns;
  };

  const _setupOutputCapture = (): {
    output: string[];
    cleanup: () => void;
  } => {
    const output: string[] = [];
    const restoreFns = _captureConsoleMethods(output);
    const previousPrint = _scope.print;

    if (_outputMode === _OUTPUT_MODE_STDOUT) {
      _scope.print = (...args: unknown[]) => {
        output.push(args.map(_formatOutputArg).join(' '));
      };
    }

    const cleanupOutputCapture = () => {
      for (const restore of restoreFns) {
        try {
          restore();
        } catch {
          // Best-effort cleanup.
        }
      }

      if (_outputMode === _OUTPUT_MODE_STDOUT) {
        if (previousPrint === undefined) {
          try {
            delete _scope.print;
          } catch {
            _scope.print = undefined;
          }
        } else {
          _scope.print = previousPrint;
        }
      }
    };

    return {
      output,
      cleanup: cleanupOutputCapture,
    };
  };

  const _lockdownGlobals = (names: readonly string[]): void => {
    for (const name of names) {
      try {
        Object.defineProperty(_scope, name, {
          value: undefined,
          writable: false,
          configurable: false,
        });
      } catch {
        // Best-effort: some globals may already be non-configurable.
      }
    }
  };

  const _applyPermissionLockdown = (permissions: unknown): void => {
    const granted = new Set(Array.isArray(permissions) ? permissions : []);
    for (const [perm, names] of Object.entries(_PERM_GLOBALS)) {
      if (!granted.has(perm)) {
        _lockdownGlobals(names);
      }
    }
  };

  const _applyNodeHostLockdown = (
    allowUnsafeNodeHostAccess: boolean | undefined
  ): void => {
    // Node runtime lockdown (safer default): hide process/require from generated code.
    if (_isNodeWorker && !allowUnsafeNodeHostAccess) {
      _lockdownGlobals(['process', 'require']);
    }
  };

  const _MAX_ERROR_CAUSE_DEPTH = config.maxErrorCauseDepth;

  const _serializeError = (
    err: unknown,
    depth: number = 0,
    seen: Set<object> = new Set()
  ): SerializedError => {
    if (depth > _MAX_ERROR_CAUSE_DEPTH) {
      return { name: 'Error', message: '[cause chain truncated]' };
    }

    if (err && typeof err === 'object') {
      if (seen.has(err)) {
        return { name: 'Error', message: '[circular]' };
      }
      seen.add(err);
    }

    const errObject = err as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
      cause?: unknown;
      data?: unknown;
    };

    const name = errObject?.name != null ? String(errObject.name) : 'Error';
    const message =
      errObject?.message != null ? String(errObject.message) : String(err);
    const stack = typeof errObject?.stack === 'string' ? errObject.stack : undefined;

    let cause: SerializedError | undefined;
    if (typeof errObject?.cause !== 'undefined' && depth < _MAX_ERROR_CAUSE_DEPTH) {
      try {
        const sourceCause = errObject.cause;
        if (
          sourceCause instanceof Error ||
          (sourceCause &&
            typeof sourceCause === 'object' &&
            ('message' in sourceCause || 'name' in sourceCause))
        ) {
          cause = _serializeError(sourceCause, depth + 1, seen);
        } else {
          cause = { name: 'Error', message: String(sourceCause) };
        }
      } catch {
        cause = { name: 'Error', message: String(errObject.cause) };
      }
    }

    const out: SerializedError = { name, message };
    if (stack !== undefined) {
      out.stack = stack;
    }
    if (cause !== undefined) {
      out.cause = cause;
    }
    if (typeof errObject?.data !== 'undefined') {
      try {
        out.data =
          typeof structuredClone === 'function'
            ? structuredClone(errObject.data)
            : errObject.data;
      } catch {
        // Non-cloneable error data is ignored.
      }
    }

    return out;
  };

  const _deserializeError = (payload: unknown): Error => {
    if (typeof payload === 'string') {
      return new Error(payload);
    }

    if (!payload || typeof payload !== 'object') {
      return new Error(String(payload));
    }

    const typedPayload = payload as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
      cause?: unknown;
      data?: unknown;
    };

    const err = new Error(
      typedPayload.message != null ? String(typedPayload.message) : ''
    );
    err.name = typedPayload.name != null ? String(typedPayload.name) : 'Error';

    if (typeof typedPayload.stack === 'string') {
      err.stack = typedPayload.stack;
    }
    if (typedPayload.cause !== undefined) {
      (err as Error & { cause?: unknown }).cause = _deserializeError(
        typedPayload.cause
      );
    }
    if (typedPayload.data !== undefined) {
      (err as Error & { data?: unknown }).data = typedPayload.data;
    }

    return err;
  };

  const _isCodeExecutionError = (err: unknown): boolean => {
    const aggregateErrorCtor = (
      globalThis as unknown as {
        AggregateError?: new (...args: unknown[]) => Error;
      }
    ).AggregateError;
    const isAggregateError =
      typeof aggregateErrorCtor === 'function' &&
      err instanceof aggregateErrorCtor;
    return (
      err instanceof SyntaxError ||
      err instanceof TypeError ||
      err instanceof RangeError ||
      err instanceof ReferenceError ||
      isAggregateError ||
      err instanceof EvalError ||
      err instanceof URIError
    );
  };

  const _formatCodeError = (err: unknown): string => {
    const typedErr = err as { name?: unknown; message?: unknown };
    const name = typedErr?.name != null ? String(typedErr.name) : 'Error';
    const message =
      typedErr?.message != null ? String(typedErr.message) : String(err);
    return `${name}: ${message}`;
  };

  // Pending function-call promises keyed by call ID.
  const _fnPending = new Map<number, FnPending>();
  let _fnCallId = 0;
  let _outputMode = _OUTPUT_MODE_RETURN;
  let _captureConsole = false;

  const _createFnProxy =
    (name: string) =>
    (...args: unknown[]): Promise<unknown> => {
      const id = ++_fnCallId;
      return new Promise((resolve, reject) => {
        _fnPending.set(id, { resolve, reject });
        _send({ type: 'fn-call', id, name, args });
      });
    };

  const _rehydrateFnRefs = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        value[i] = _rehydrateFnRefs(value[i]);
      }
      return value;
    }

    const valueObject = value as Record<string, unknown>;
    if (_FUNCTION_REF_KEY in valueObject) {
      const ref = valueObject[_FUNCTION_REF_KEY];
      if (typeof ref === 'string') {
        return _createFnProxy(ref);
      }
      return undefined;
    }

    for (const [key, innerValue] of Object.entries(valueObject)) {
      valueObject[key] = _rehydrateFnRefs(innerValue);
    }

    return value;
  };

  const _setGlobalsAndFnProxies = (msg: Record<string, unknown>): void => {
    if (msg.globals && typeof msg.globals === 'object') {
      for (const [key, value] of Object.entries(msg.globals)) {
        _scope[key] = _rehydrateFnRefs(value);
      }
    }

    // Backward compatibility: allow explicit top-level function proxies.
    if (Array.isArray(msg.fnNames)) {
      for (const name of msg.fnNames) {
        if (typeof name === 'string') {
          _scope[name] = _createFnProxy(name);
        }
      }
    }
  };

  const _executeAsyncSnippet = async (code: string): Promise<unknown> => {
    const fallbackSource = _ensureTrailingNewline(code);

    let transformedSource = fallbackSource;
    try {
      transformedSource = _injectAsyncAutoReturn(fallbackSource);
    } catch {
      transformedSource = fallbackSource;
    }

    const sourceToRun = _canCompileAsyncSource(transformedSource)
      ? transformedSource
      : fallbackSource;

    const fn = new _AsyncFunction(sourceToRun);
    return await fn();
  };

  const _executeSyncSnippet = (code: string): unknown => {
    const syncCode = _rewriteTopLevelReturnForSyncEval(code);
    // Indirect eval executes in worker global scope.
    return (0, eval)(syncCode);
  };

  const _toOutputValue = (result: unknown, output: string[]): unknown => {
    if (_outputMode !== _OUTPUT_MODE_STDOUT) {
      return result;
    }

    const stdout = output.join('\n').trim();
    return stdout ? stdout : result;
  };

  _setOnMessage(async (event) => {
    const msg = event.data as Record<string, unknown>;

    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return;
    }

    if (msg.type === 'init') {
      _outputMode =
        msg.outputMode === _OUTPUT_MODE_STDOUT
          ? _OUTPUT_MODE_STDOUT
          : _OUTPUT_MODE_RETURN;
      _captureConsole =
        msg.captureConsole !== undefined
          ? Boolean(msg.captureConsole)
          : _outputMode === _OUTPUT_MODE_STDOUT;
      const allowUnsafeNodeHostAccess = msg.allowUnsafeNodeHostAccess === true;

      _setGlobalsAndFnProxies(msg);
      _applyPermissionLockdown(msg.permissions);
      _applyNodeHostLockdown(allowUnsafeNodeHostAccess);
      return;
    }

    if (msg.type === 'fn-result') {
      if (typeof msg.id !== 'number') {
        return;
      }

      const pending = _fnPending.get(msg.id);
      if (pending) {
        _fnPending.delete(msg.id);
        if (msg.error !== undefined) {
          pending.reject(_deserializeError(msg.error));
        } else {
          pending.resolve(msg.value);
        }
      }
      return;
    }

    if (msg.type !== 'execute') {
      return;
    }

    if (typeof msg.id !== 'number' || typeof msg.code !== 'string') {
      return;
    }

    const id = msg.id;
    const code = msg.code;
    const { output, cleanup } = _setupOutputCapture();

    try {
      const result = /\bawait\b/.test(code)
        ? await _executeAsyncSnippet(code)
        : _executeSyncSnippet(code);
      const value = _toOutputValue(result, output);

      try {
        _send({ type: 'result', id, value });
      } catch {
        // Value not structured-cloneable, fall back to string.
        _send({ type: 'result', id, value: String(value) });
      }
    } catch (err) {
      if (_isCodeExecutionError(err)) {
        _send({ type: 'result', id, value: _formatCodeError(err) });
      } else {
        _send({ type: 'result', id, error: _serializeError(err) });
      }
    } finally {
      cleanup();
    }
  });
}
