export type AxWorkerRuntimeConfig = Readonly<{
  functionRefKey: string;
  maxErrorCauseDepth: number;
}>;

export function axWorkerRuntime(config: AxWorkerRuntimeConfig): void {
  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  IMPORTANT: SERIALIZED FUNCTION — READ BEFORE EDITING              ║
  // ║                                                                    ║
  // ║  This function is serialized via .toString() by getWorkerSource()  ║
  // ║  in worker.ts and evaluated as a standalone script inside a Web    ║
  // ║  Worker or Node worker_threads context.                            ║
  // ║                                                                    ║
  // ║  The serialized string has NO access to module-scope variables,    ║
  // ║  imports, or bundler-injected helpers from the original bundle.    ║
  // ║  Everything this function needs must live inside its own body.     ║
  // ║                                                                    ║
  // ║  Rules for code inside this function:                              ║
  // ║                                                                    ║
  // ║  1. NO IMPORTS — outer-scope modules/functions are NOT available   ║
  // ║     in the worker. Everything must be self-contained.              ║
  // ║                                                                    ║
  // ║  2. NO BARE `require` — esbuild/tsup replaces bare `require`      ║
  // ║     and `typeof require` with module-scope polyfill variables      ║
  // ║     that don't exist in the serialized worker context.             ║
  // ║     `globalThis['require']` is also NOT sufficient — esbuild      ║
  // ║     sees through it. Use `new Function(...)` to obtain `require`   ║
  // ║     (see _detectNodeParentPort for the correct pattern).           ║
  // ║                                                                    ║
  // ║  3. NO BARE `import()` — dynamic import() may also be rewritten   ║
  // ║     by bundlers. If needed, use indirect eval to obtain it.        ║
  // ║                                                                    ║
  // ║  4. `typeof process` is SAFE — esbuild preserves this.            ║
  // ║     `typeof self` and `typeof globalThis` are also safe.           ║
  // ║                                                                    ║
  // ║  5. BUNDLER HELPERS — esbuild may inject module-scope helpers      ║
  // ║     like `__name()` into this function body during minification.   ║
  // ║     These don't exist in the isolated worker context.              ║
  // ║     getWorkerSource() in worker.ts detects them and prepends       ║
  // ║     lightweight no-op polyfills. If you encounter a new            ║
  // ║     ReferenceError in the built bundle (but not in vitest),        ║
  // ║     it's likely a new bundler helper — add a polyfill in           ║
  // ║     getWorkerSource() and a matching test.                         ║
  // ║                                                                    ║
  // ║  HOW TO DEBUG SERIALIZATION ISSUES:                                ║
  // ║                                                                    ║
  // ║  - vitest runs unminified TS source → bundler helpers are absent.  ║
  // ║    Tests pass but the built bundle may still break at runtime.     ║
  // ║  - To catch this: `npx tsup && node -e "..."` to evaluate         ║
  // ║    getWorkerSource() output in a clean context.                    ║
  // ║  - The "isolated sandbox" test in worker.runtime.test.ts runs      ║
  // ║    getWorkerSource() in node:vm with no bundler helpers.           ║
  // ║                                                                    ║
  // ║  Tests in worker.runtime.test.ts validate these invariants.        ║
  // ╚══════════════════════════════════════════════════════════════════════╝

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

  const _scope = (typeof self !== 'undefined'
    ? self
    : globalThis) as unknown as {
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
    // Obtain a module-loading function that works in the worker context.
    //
    // Strategy 1: `process.getBuiltinModule` (Node 22.3+).
    //   Works in BOTH CJS and ESM workers, and is not rewritten by bundlers.
    //
    // Strategy 2: `new Function(...)` to obtain `require` (CJS workers only).
    //   esbuild replaces both bare `require` AND `globalThis['require']` with
    //   module-scope polyfill variables that don't exist in the serialized
    //   worker context. `new Function()` is completely opaque to esbuild.
    //   However, `require` is NOT available in ESM eval workers (when the
    //   parent module is ESM, `new Worker(source, {eval:true})` creates an
    //   ESM worker where `require` does not exist).
    //
    // We try strategy 1 first because it covers ESM workers on modern Node.

    let _loadBuiltin: ((id: string) => unknown) | undefined;

    // Strategy 1: process.getBuiltinModule (Node 22.3+, works in ESM workers)
    if (
      typeof process !== 'undefined' &&
      typeof (process as unknown as { getBuiltinModule?: unknown })
        .getBuiltinModule === 'function'
    ) {
      const _getBuiltinModule = (
        process as unknown as {
          getBuiltinModule: (specifier: string) => unknown;
        }
      ).getBuiltinModule.bind(process);
      _loadBuiltin = _getBuiltinModule;
    }

    // Strategy 2: new Function to get require (CJS workers, older Node)
    if (!_loadBuiltin) {
      try {
        _loadBuiltin = new Function(
          'return typeof require==="function"?require:undefined'
        )() as ((id: string) => unknown) | undefined;
      } catch {
        _loadBuiltin = undefined;
      }
    }

    const isNodeLike =
      typeof _loadBuiltin === 'function' &&
      typeof process !== 'undefined' &&
      !!process.versions?.node;

    if (!isNodeLike) {
      return { isNodeWorker: false, parentPort: null };
    }

    try {
      const workerThreads = _loadBuiltin!('node:worker_threads') as {
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
            head = head
              ? `${head}\n${prefixStatement};`
              : `${prefixStatement};`;
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
    const rawCandidate = lines
      .slice(start, tail + 1)
      .join('\n')
      .trim();

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

  /**
   * Extract top-level declared variable names from code.
   *
   * Character-by-character scanner that tracks brace/paren depth and skips
   * strings, template literals, and comments. Only extracts names at depth 0.
   *
   * Returns an array of binding names (simple, destructured, rest, etc.).
   * Errs on the side of NOT extracting (false negatives = safe).
   */
  const _extractTopLevelDeclaredNames = (code: string): string[] => {
    const names: string[] = [];
    const len = code.length;
    let i = 0;
    let braceDepth = 0;
    let parenDepth = 0;

    const isIdChar = (ch: string): boolean =>
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '$';

    // Skip a string literal (single, double, or template).
    const skipString = (quote: string): void => {
      i++; // skip opening quote
      if (quote === '`') {
        // Template literal: handle ${...} nesting
        let tmplDepth = 0;
        while (i < len) {
          const ch = code[i]!;
          if (ch === '\\') {
            i += 2;
            continue;
          }
          if (tmplDepth > 0) {
            if (ch === '{') {
              tmplDepth++;
            } else if (ch === '}') {
              tmplDepth--;
            }
            i++;
            continue;
          }
          if (ch === '$' && i + 1 < len && code[i + 1] === '{') {
            tmplDepth++;
            i += 2;
            continue;
          }
          if (ch === '`') {
            i++;
            return;
          }
          i++;
        }
      } else {
        while (i < len) {
          const ch = code[i]!;
          if (ch === '\\') {
            i += 2;
            continue;
          }
          if (ch === quote) {
            i++;
            return;
          }
          i++;
        }
      }
    };

    // Skip a single-line comment (// to EOL).
    const skipLineComment = (): void => {
      i += 2; // skip //
      while (i < len && code[i] !== '\n') {
        i++;
      }
    };

    // Skip a block comment (/* to */).
    const skipBlockComment = (): void => {
      i += 2; // skip /*
      while (i < len) {
        if (code[i] === '*' && i + 1 < len && code[i + 1] === '/') {
          i += 2;
          return;
        }
        i++;
      }
    };

    // Read a word (identifier) at position i.
    const readWord = (): string => {
      const start = i;
      while (i < len && isIdChar(code[i]!)) {
        i++;
      }
      return code.slice(start, i);
    };

    // Skip whitespace and comments, return true if any was skipped.
    const skipWS = (): boolean => {
      const start = i;
      while (i < len) {
        const ch = code[i]!;
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          i++;
          continue;
        }
        if (ch === '/' && i + 1 < len) {
          if (code[i + 1] === '/') {
            skipLineComment();
            continue;
          }
          if (code[i + 1] === '*') {
            skipBlockComment();
            continue;
          }
        }
        break;
      }
      return i > start;
    };

    // Extract names from a destructuring pattern (after the opening { or [).
    const extractDestructuredNames = (close: string): void => {
      let depth = 1;
      while (i < len && depth > 0) {
        skipWS();
        if (i >= len) return;
        const ch = code[i]!;
        if (ch === close) {
          depth--;
          i++;
          continue;
        }
        if (ch === '{' || ch === '[') {
          // Nested destructuring
          const nestedClose = ch === '{' ? '}' : ']';
          i++;
          depth++;
          // Continue scanning — we'll hit the nested close
          // But we need to track which close matches which open.
          // Simplified: recurse
          i--; // back up to re-read
          depth--; // undo
          i++; // skip the open brace/bracket
          extractDestructuredNames(nestedClose);
          continue;
        }
        if (
          ch === '.' &&
          i + 2 < len &&
          code[i + 1] === '.' &&
          code[i + 2] === '.'
        ) {
          // Rest element: ...name
          i += 3;
          skipWS();
          if (i < len && isIdChar(code[i]!)) {
            const name = readWord();
            if (name) names.push(name);
          }
          continue;
        }
        if (ch === ',') {
          i++;
          continue;
        }
        if (ch === '=') {
          // Default value — skip the expression
          i++;
          let eqDepth = 0;
          while (i < len) {
            const ec = code[i]!;
            if (ec === "'" || ec === '"' || ec === '`') {
              skipString(ec);
              continue;
            }
            if (ec === '(' || ec === '[' || ec === '{') {
              eqDepth++;
              i++;
              continue;
            }
            if (ec === ')' || ec === ']' || ec === '}') {
              if (eqDepth > 0) {
                eqDepth--;
                i++;
                continue;
              }
              // This is the outer close — don't consume it
              break;
            }
            if (ec === ',' && eqDepth === 0) {
              break;
            }
            i++;
          }
          continue;
        }
        if (isIdChar(ch)) {
          const word = readWord();
          skipWS();
          if (i < len && code[i] === ':') {
            // Property rename: `{ a: renamed }` or `{ a: { nested } }`
            i++; // skip colon
            skipWS();
            if (i < len) {
              const nc = code[i]!;
              if (nc === '{' || nc === '[') {
                const nestedClose = nc === '{' ? '}' : ']';
                i++;
                extractDestructuredNames(nestedClose);
              } else if (isIdChar(nc)) {
                const renamed = readWord();
                if (renamed) names.push(renamed);
              }
            }
          } else {
            // Simple binding name
            if (word) names.push(word);
          }
          continue;
        }
        // Unknown character — skip it
        i++;
      }
    };

    // After extracting a binding name or destructuring pattern,
    // skip to the next comma (for another binding) or end of statement.
    // Returns true if a comma was found (more bindings to come), false otherwise.
    const skipToCommaOrEnd = (): boolean => {
      let depth = 0;
      while (i < len) {
        const ch = code[i]!;
        if (ch === "'" || ch === '"' || ch === '`') {
          skipString(ch);
          continue;
        }
        if (ch === '/' && i + 1 < len) {
          if (code[i + 1] === '/') {
            skipLineComment();
            continue;
          }
          if (code[i + 1] === '*') {
            skipBlockComment();
            continue;
          }
        }
        if (ch === '(' || ch === '[' || ch === '{') {
          depth++;
          i++;
          continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
          if (depth > 0) {
            depth--;
            i++;
            continue;
          }
          // End of surrounding scope — stop
          return false;
        }
        if (ch === ',' && depth === 0) {
          i++; // skip comma
          return true; // more bindings follow
        }
        if (ch === ';' && depth === 0) {
          i++;
          return false; // statement ended
        }
        if (ch === '\n' && depth === 0) {
          // Could be end of statement (ASI)
          // Peek ahead: if next non-ws token isn't a comma, treat as end
          const savedI = i;
          i++;
          skipWS();
          if (i < len && code[i] === ',') {
            i++; // skip comma, continue to next binding
            return true;
          }
          // Not a comma — revert and end
          i = savedI;
          return false;
        }
        i++;
      }
      return false;
    };

    // Extract binding names after `var`/`let`/`const` keyword.
    // Handles: simple names, object destructuring, array destructuring,
    // and comma-separated bindings.
    const extractBindings = (): void => {
      while (i < len) {
        skipWS();
        if (i >= len) return;
        const ch = code[i]!;

        if (ch === '{') {
          i++;
          extractDestructuredNames('}');
          if (!skipToCommaOrEnd()) return;
          continue;
        }
        if (ch === '[') {
          i++;
          extractDestructuredNames(']');
          if (!skipToCommaOrEnd()) return;
          continue;
        }
        if (isIdChar(ch)) {
          const name = readWord();
          if (name) names.push(name);
          if (!skipToCommaOrEnd()) return;
          continue;
        }
        // Something unexpected — bail out
        return;
      }
    };

    // Check if position is at a statement boundary (start of code or preceded by
    // a newline, semicolon, or opening brace — ignoring whitespace/comments).
    const isStatementBoundary = (pos: number): boolean => {
      if (pos === 0) return true;
      let j = pos - 1;
      while (j >= 0) {
        const ch = code[j]!;
        if (ch === ' ' || ch === '\t' || ch === '\r') {
          j--;
          continue;
        }
        return ch === '\n' || ch === ';' || ch === '{' || ch === '}';
      }
      return true; // reached start
    };

    while (i < len) {
      const ch = code[i]!;

      // Skip strings
      if (ch === "'" || ch === '"' || ch === '`') {
        skipString(ch);
        continue;
      }

      // Skip comments
      if (ch === '/' && i + 1 < len) {
        if (code[i + 1] === '/') {
          skipLineComment();
          continue;
        }
        if (code[i + 1] === '*') {
          skipBlockComment();
          continue;
        }
      }

      // Track brace and paren depth
      if (ch === '{') {
        braceDepth++;
        i++;
        continue;
      }
      if (ch === '}') {
        braceDepth--;
        i++;
        continue;
      }
      if (ch === '(') {
        parenDepth++;
        i++;
        continue;
      }
      if (ch === ')') {
        parenDepth--;
        i++;
        continue;
      }

      // Only extract at top level
      if (braceDepth === 0 && parenDepth === 0 && isIdChar(ch)) {
        const wordStart = i;
        const word = readWord();
        if (
          (word === 'var' || word === 'let' || word === 'const') &&
          i < len &&
          (code[i] === ' ' || code[i] === '\t' || code[i] === '\n') &&
          isStatementBoundary(wordStart)
        ) {
          extractBindings();
          continue;
        }
        // Not a declaration keyword — skip
        continue;
      }

      i++;
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const n of names) {
      if (!seen.has(n)) {
        seen.add(n);
        unique.push(n);
      }
    }
    return unique;
  };

  /**
   * Build a persistence suffix that assigns declared names to globalThis.
   * Wrapped in try/catch so failures are silent (fail-open to current behavior).
   */
  const _buildPersistenceSuffix = (declNames: string[]): string => {
    if (declNames.length === 0) return '';
    const assignments = declNames
      .map((n) => `globalThis[${JSON.stringify(n)}] = ${n};`)
      .join(' ');
    return `\ntry { ${assignments} } catch (_ax_e) {} void 0;`;
  };

  const _formatOutputArg = (value: unknown): string => {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const _captureConsoleMethod = (
    methodName: string,
    output: string[]
  ): (() => void) => {
    const consoleObject =
      _scope.console && typeof _scope.console === 'object'
        ? _scope.console
        : null;
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
      errObject?.message != null
        ? String(errObject.message)
        : _safeStringify(err);
    const stack =
      typeof errObject?.stack === 'string' ? errObject.stack : undefined;

    let cause: SerializedError | undefined;
    if (
      typeof errObject?.cause !== 'undefined' &&
      depth < _MAX_ERROR_CAUSE_DEPTH
    ) {
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
          cause = { name: 'Error', message: _safeStringify(sourceCause) };
        }
      } catch {
        cause = { name: 'Error', message: _safeStringify(errObject.cause) };
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

  const _safeStringify = (value: unknown): string => {
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
  };

  const _formatCodeError = (err: unknown): string => {
    const typedErr = err as {
      name?: unknown;
      message?: unknown;
      cause?: unknown;
      data?: unknown;
    };
    const name = typedErr?.name != null ? String(typedErr.name) : 'Error';
    const message =
      typedErr?.message != null
        ? String(typedErr.message)
        : _safeStringify(err);
    const parts: string[] = [`${name}: ${message}`];

    if (typedErr?.data !== undefined) {
      parts.push(`Data: ${_safeStringify(typedErr.data)}`);
    }
    if (typedErr?.cause !== undefined) {
      const _fmtCause = (cause: unknown, depth: number): string => {
        if (depth > 4) return '[cause chain truncated]';
        const c = cause as typeof typedErr;
        const cName = c?.name != null ? String(c.name) : 'Error';
        const cMsg =
          c?.message != null ? String(c.message) : _safeStringify(cause);
        const cParts: string[] = [`${cName}: ${cMsg}`];
        if (c?.data !== undefined)
          cParts.push(`Data: ${_safeStringify(c.data)}`);
        if (c?.cause !== undefined)
          cParts.push(`Caused by: ${_fmtCause(c.cause, depth + 1)}`);
        return cParts.join('\n');
      };
      parts.push(`Caused by: ${_fmtCause(typedErr.cause, 1)}`);
    }

    return parts.join('\n');
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

    // Extract declarations from the ORIGINAL code (before auto-return transform).
    let declNames: string[] = [];
    try {
      declNames = _extractTopLevelDeclaredNames(code);
    } catch {
      declNames = [];
    }
    const suffix = _buildPersistenceSuffix(declNames);

    let transformedSource = fallbackSource;
    try {
      transformedSource = _injectAsyncAutoReturn(fallbackSource);
    } catch {
      transformedSource = fallbackSource;
    }

    // Inject persistence suffix.
    let withPersistence = transformedSource;
    if (suffix) {
      // If auto-return injected a `return (`, insert persistence before it.
      const returnIdx = transformedSource.lastIndexOf('\nreturn (');
      if (returnIdx !== -1) {
        withPersistence =
          transformedSource.slice(0, returnIdx) +
          suffix +
          transformedSource.slice(returnIdx);
      } else {
        // No auto-return — append at end.
        withPersistence = transformedSource + suffix;
      }
    }

    const sourceToRun = _canCompileAsyncSource(withPersistence)
      ? withPersistence
      : _canCompileAsyncSource(transformedSource)
        ? transformedSource
        : fallbackSource;

    const fn = new _AsyncFunction(sourceToRun);
    return await fn();
  };

  const _executeSyncSnippet = (code: string): unknown => {
    const syncCode = _rewriteTopLevelReturnForSyncEval(code);

    // Inject persistence for const/let/var declarations.
    let declNames: string[] = [];
    try {
      declNames = _extractTopLevelDeclaredNames(code);
    } catch {
      declNames = [];
    }
    const suffix = _buildPersistenceSuffix(declNames);
    const codeToRun = suffix ? syncCode + suffix : syncCode;

    // Indirect eval executes in worker global scope.
    // biome-ignore lint/security/noGlobalEval: intentional indirect eval for worker sandbox
    // biome-ignore lint/complexity/noCommaOperator: (0, eval) is the standard indirect eval pattern
    return (0, eval)(codeToRun);
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
