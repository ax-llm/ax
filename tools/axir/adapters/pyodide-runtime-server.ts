import { createRequire } from 'node:module';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

type JsonObject = Record<string, unknown>;

type ProtocolMessage = {
  id?: string | number;
  op?: string;
  session_id?: string;
  payload?: JsonObject;
};

type PyodideLike = {
  runPythonAsync(code: string, options?: JsonObject): Promise<unknown>;
  setStdout?(options: JsonObject): void;
  setStderr?(options: JsonObject): void;
};

type HostCallable = (params: unknown) => unknown | Promise<unknown>;

type RuntimePolicy = {
  allowFilesystem: boolean;
  allowNetwork: boolean;
  allowPackageLoading: boolean;
  allowMicropip: boolean;
  packageAllowlist: string[];
  maxDiagnosticsChars: number;
  maxSnapshotBytes: number;
  timeoutMs: number;
};

const DEFAULT_POLICY: RuntimePolicy = {
  allowFilesystem: false,
  allowNetwork: false,
  allowPackageLoading: false,
  allowMicropip: false,
  packageAllowlist: [],
  maxDiagnosticsChars: 8192,
  maxSnapshotBytes: 262144,
  timeoutMs: 5000,
};

function ok(id: ProtocolMessage['id'], result: unknown, extra?: JsonObject) {
  return { id, ok: true, result, ...(extra ?? {}) };
}

function fail(id: ProtocolMessage['id'], error: unknown, category?: string) {
  return {
    id,
    ok: false,
    error: {
      category: category ?? errorCategory(error),
      message: errorMessage(error),
    },
  };
}

function errorCategory(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as JsonObject;
    if (typeof value.error_category === 'string') return value.error_category;
    if (typeof value.category === 'string') return value.category;
    if (value.name === 'AbortError') return 'abort';
  }
  return 'runtime';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isModuleMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    ('code' in error
      ? (error as Error & { code?: string }).code === 'ERR_MODULE_NOT_FOUND'
      : error.message.includes('Cannot find package'))
  );
}

async function importPyodidePackage(): Promise<{
  loadPyodide: (config?: JsonObject) => Promise<PyodideLike>;
}> {
  const normalize = (mod: unknown) => {
    const value = mod as JsonObject & { default?: JsonObject };
    if (typeof value.loadPyodide === 'function') {
      return value as {
        loadPyodide: (config?: JsonObject) => Promise<PyodideLike>;
      };
    }
    if (value.default && typeof value.default.loadPyodide === 'function') {
      return value.default as {
        loadPyodide: (config?: JsonObject) => Promise<PyodideLike>;
      };
    }
    return null;
  };
  try {
    const imported = normalize(await import('pyodide'));
    if (imported) return imported;
    const esmImported = normalize(await import('pyodide/pyodide.mjs'));
    if (esmImported) return esmImported;
    throw new Error('pyodide package did not export loadPyodide');
  } catch (error) {
    const moduleRoot = process.env.AXIR_PYODIDE_MODULE_ROOT;
    if (!moduleRoot) throw error;
    const require = createRequire(
      pathToFileURL(`${moduleRoot.replace(/\/$/, '')}/package.json`)
    );
    let resolved: string;
    try {
      resolved = require.resolve('pyodide/pyodide.mjs');
    } catch {
      resolved = require.resolve('pyodide');
      if (resolved.endsWith('pyodide.js')) {
        resolved = `${resolved.slice(0, -'pyodide.js'.length)}pyodide.mjs`;
      }
    }
    const imported = normalize(await import(pathToFileURL(resolved).href));
    if (!imported)
      throw new Error(
        `pyodide package at ${resolved} did not export loadPyodide`
      );
    return imported;
  }
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(JSON.stringify(value));
}

function boolOption(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function intOption(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(1, Math.floor(parsed));
  }
  return fallback;
}

function policyFrom(
  raw: unknown,
  base: RuntimePolicy = DEFAULT_POLICY
): RuntimePolicy {
  const value = raw && typeof raw === 'object' ? (raw as JsonObject) : {};
  return {
    allowFilesystem: boolOption(value.allowFilesystem, base.allowFilesystem),
    allowNetwork: boolOption(value.allowNetwork, base.allowNetwork),
    allowPackageLoading: boolOption(
      value.allowPackageLoading,
      base.allowPackageLoading
    ),
    allowMicropip: boolOption(value.allowMicropip, base.allowMicropip),
    packageAllowlist: Array.isArray(value.packageAllowlist)
      ? value.packageAllowlist.map(String)
      : [...base.packageAllowlist],
    maxDiagnosticsChars: intOption(
      value.maxDiagnosticsChars,
      base.maxDiagnosticsChars
    ),
    maxSnapshotBytes: intOption(value.maxSnapshotBytes, base.maxSnapshotBytes),
    timeoutMs: intOption(value.timeoutMs, base.timeoutMs),
  };
}

function policyFromEnv(): RuntimePolicy {
  const raw = process.env.AXIR_PYODIDE_RUNTIME_POLICY;
  if (!raw) return { ...DEFAULT_POLICY };
  try {
    return policyFrom(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `invalid AXIR_PYODIDE_RUNTIME_POLICY JSON: ${errorMessage(error)}`
    );
  }
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit))}...[truncated]`;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function enforceSnapshotLimit(
  bindings: JsonObject,
  maxBytes: number
): JsonObject {
  if (jsonByteLength(bindings) <= maxBytes) return bindings;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(bindings)) {
    out[key] = value;
    if (jsonByteLength(out) > maxBytes) {
      delete out[key];
      out.__ax_snapshot_truncated = true;
      break;
    }
  }
  return out;
}

function safeBindings(bindings: JsonObject, reserved: Set<string>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(bindings)) {
    if (reserved.has(key) || key.startsWith('__ax_')) continue;
    if (typeof value === 'function' || typeof value === 'undefined') continue;
    if (
      value &&
      typeof value === 'object' &&
      (value as JsonObject).__ax_host_callable === true
    )
      continue;
    try {
      JSON.stringify(value);
      out[key] = value;
    } catch {
      // Non-JSON-safe values are intentionally omitted from portable state.
    }
  }
  return out;
}

class PyodideSession {
  private bindings: JsonObject;
  private readonly reserved = new Set<string>();
  private closed = false;

  constructor(
    private readonly pyodide: PyodideLike,
    private readonly sessionId: string,
    globals: JsonObject,
    options: JsonObject,
    private readonly policy: RuntimePolicy,
    private readonly hostCallables: Map<string, HostCallable>,
    private readonly diagnostics: JsonObject[]
  ) {
    this.bindings = { ...globals };
    const reservedNames = options.reservedNames;
    if (Array.isArray(reservedNames)) {
      for (const name of reservedNames) this.reserved.add(String(name));
    }
    for (const [key, value] of Object.entries(this.bindings)) {
      if (
        value &&
        typeof value === 'object' &&
        (value as JsonObject).__ax_host_callable === true
      ) {
        this.reserved.add(key);
      }
    }
    for (const name of this.hostCallables.keys()) {
      this.reserved.add(name);
      if (!(name in this.bindings)) {
        this.bindings[name] = { __ax_host_callable: true, native: true };
      }
    }
  }

  async execute(code: string, options: JsonObject = {}): Promise<unknown> {
    if (this.closed) {
      return {
        kind: 'error',
        is_error: true,
        error_category: 'session_closed',
        error: 'session closed',
      };
    }
    try {
      const script = this.executionScript(code);
      void options;
      const raw = String(await this.pyodide.runPythonAsync(script));
      const response = JSON.parse(raw) as JsonObject;
      if (Array.isArray(response.diagnostics)) {
        this.diagnostics.push(...(response.diagnostics as JsonObject[]));
      }
      if (response.ok === false) {
        return {
          kind: 'error',
          is_error: true,
          error_category: String(response.category ?? 'runtime'),
          error: String(response.error ?? 'Pyodide runtime error'),
          diagnostics: this.flushDiagnostics(),
        };
      }
      const safeNext =
        response.bindings && typeof response.bindings === 'object'
          ? (response.bindings as JsonObject)
          : {};
      const preserved: JsonObject = {};
      for (const name of this.reserved) {
        if (name in this.bindings) preserved[name] = this.bindings[name];
      }
      this.bindings = { ...preserved, ...safeNext };
      const result = response.result as JsonObject;
      if (this.diagnostics.length > 0 && result && typeof result === 'object') {
        result.diagnostics = this.flushDiagnostics();
      }
      return result;
    } catch (error) {
      return {
        kind: 'error',
        is_error: true,
        error_category: errorCategory(error),
        error: errorMessage(error),
        diagnostics: this.flushDiagnostics(),
      };
    }
  }

  inspectGlobals(): unknown {
    return safeBindings(this.bindings, this.reserved);
  }

  snapshotGlobals(): unknown {
    const bindings = enforceSnapshotLimit(
      safeBindings(this.bindings, this.reserved),
      this.policy.maxSnapshotBytes
    );
    return { version: 1, bindings, globals: bindings };
  }

  patchGlobals(snapshot: JsonObject): unknown {
    const next =
      snapshot.bindings && typeof snapshot.bindings === 'object'
        ? (snapshot.bindings as JsonObject)
        : snapshot;
    const preserved: JsonObject = {};
    for (const name of this.reserved) {
      if (name in this.bindings) preserved[name] = this.bindings[name];
    }
    this.bindings = { ...preserved };
    for (const [key, value] of Object.entries(next)) {
      if (this.reserved.has(key) || key.startsWith('__ax_')) continue;
      this.bindings[key] = value;
    }
    return this.snapshotGlobals();
  }

  close(): unknown {
    this.closed = true;
    return { closed: true };
  }

  callHost(name: string, paramsJson: string): string {
    const handler = this.hostCallables.get(name);
    if (!handler) {
      return JSON.stringify({
        ok: false,
        category: 'runtime',
        error: `unknown Pyodide host callable: ${name}`,
      });
    }
    try {
      const params = paramsJson ? JSON.parse(paramsJson) : null;
      const result = handler(params);
      if (result instanceof Promise) {
        return JSON.stringify({
          ok: false,
          category: 'runtime',
          error: `async Pyodide host callable is not supported in alpha: ${name}`,
        });
      }
      return JSON.stringify({ ok: true, result: result ?? null });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        category: errorCategory(error),
        error: errorMessage(error),
      });
    }
  }

  private flushDiagnostics(): JsonObject[] {
    const out = this.diagnostics.splice(0).map((item) => {
      const next = { ...item };
      if (typeof next.text === 'string') {
        next.text = truncateText(next.text, this.policy.maxDiagnosticsChars);
      }
      return next;
    });
    return out;
  }

  private executionScript(code: string): string {
    const reserved = Array.from(this.reserved);
    return `
import json
import io
import sys
import traceback
from js import globalThis

__ax_bindings = json.loads(${jsonLiteral(this.bindings)})
__ax_reserved = set(json.loads(${jsonLiteral(reserved)}))
__ax_session_id = json.loads(${jsonLiteral(this.sessionId)})
__ax_code = json.loads(${jsonLiteral(code)})

def __ax_is_host_callable(value):
    return isinstance(value, dict) and value.get("__ax_host_callable") is True

def __ax_complete(value):
    __ax_globals["__ax_completion"] = value
    return value

def final(*args):
    return __ax_complete({"type": "final", "args": list(args)})

def askClarification(*args):
    return __ax_complete({"type": "askClarification", "args": list(args)})

def discover(request):
    return __ax_complete({"kind": "discover", "discover": request})

def recall(request):
    return __ax_complete({"kind": "recall", "recall": request})

def used(id_or_request, reason=None):
    payload = dict(id_or_request) if isinstance(id_or_request, dict) else {"id": id_or_request}
    if reason is not None:
        payload["reason"] = str(reason)
    return __ax_complete({"kind": "used", "used": payload})

def reportSuccess(message=""):
    return __ax_complete({"kind": "status", "status": {"type": "success", "message": str(message)}})

def reportFailure(message=""):
    return __ax_complete({"kind": "status", "status": {"type": "failed", "message": str(message)}})

def guideAgent(guidance=""):
    return __ax_complete({"type": "guide_agent", "guidance": str(guidance)})

def loadPackage(*names):
    allowed = set(json.loads(${jsonLiteral(this.policy.packageAllowlist)}))
    package_loading = bool(json.loads(${jsonLiteral(this.policy.allowPackageLoading)}))
    requested = []
    for name in names:
        if isinstance(name, (list, tuple)):
            requested.extend([str(item) for item in name])
        else:
            requested.append(str(name))
    if not package_loading:
        return {"kind": "error", "is_error": True, "error_category": "runtime", "error": "Pyodide package loading is disabled by runtimePolicy"}
    denied = [name for name in requested if name not in allowed]
    if denied:
        return {"kind": "error", "is_error": True, "error_category": "runtime", "error": "Pyodide package not allowed by runtimePolicy: " + ", ".join(denied)}
    return {"kind": "status", "status": {"type": "success", "message": "package request allowed: " + ", ".join(requested)}}

def micropipInstall(*names):
    if not bool(json.loads(${jsonLiteral(this.policy.allowMicropip)})):
        return {"kind": "error", "is_error": True, "error_category": "runtime", "error": "Pyodide micropip is disabled by runtimePolicy"}
    return loadPackage(*names)

def __ax_make_host_callable(name):
    def __ax_call(params=None):
        raw = globalThis.__ax_host_call(__ax_session_id, name, json.dumps(params))
        response = json.loads(str(raw))
        if response.get("ok"):
            return response.get("result")
        return {
            "kind": "error",
            "is_error": True,
            "error_category": str(response.get("category") or "runtime"),
            "error": str(response.get("error") or ("host callable failed: " + name)),
        }
    return __ax_call

def __ax_json_safe_bindings(values):
    out = {}
    for key, value in list(values.items()):
        if key.startswith("__ax_") or key in __ax_reserved:
            continue
        if callable(value) or __ax_is_host_callable(value):
            continue
        try:
            json.dumps(value)
            out[key] = value
        except Exception:
            pass
    return out

__ax_globals = dict(__ax_bindings)
__ax_globals.update({
    "final": final,
    "askClarification": askClarification,
    "discover": discover,
    "recall": recall,
    "used": used,
    "reportSuccess": reportSuccess,
    "reportFailure": reportFailure,
    "guideAgent": guideAgent,
    "loadPackage": loadPackage,
    "micropipInstall": micropipInstall,
    "__ax_completion": None,
})

for __ax_name, __ax_value in list(__ax_globals.items()):
    if __ax_is_host_callable(__ax_value):
        __ax_globals[__ax_name] = __ax_make_host_callable(__ax_name)

try:
    __ax_stdout = io.StringIO()
    __ax_stderr = io.StringIO()
    __ax_old_stdout = sys.stdout
    __ax_old_stderr = sys.stderr
    sys.stdout = __ax_stdout
    sys.stderr = __ax_stderr
    exec(__ax_code, __ax_globals, __ax_globals)
    sys.stdout = __ax_old_stdout
    sys.stderr = __ax_old_stderr
    __ax_diagnostics = []
    if __ax_stdout.getvalue():
        __ax_diagnostics.append({"stream": "stdout", "text": __ax_stdout.getvalue()})
    if __ax_stderr.getvalue():
        __ax_diagnostics.append({"stream": "stderr", "text": __ax_stderr.getvalue()})
    __ax_result = __ax_globals.get("__ax_completion")
    if __ax_result is None:
        __ax_result = {"kind": "result", "result": None}
    __ax_response_json = json.dumps({
        "ok": True,
        "result": __ax_result,
        "bindings": __ax_json_safe_bindings(__ax_globals),
        "diagnostics": __ax_diagnostics,
    })
except Exception as __ax_error:
    try:
        sys.stdout = __ax_old_stdout
        sys.stderr = __ax_old_stderr
        __ax_diagnostics = []
        if __ax_stdout.getvalue():
            __ax_diagnostics.append({"stream": "stdout", "text": __ax_stdout.getvalue()})
        if __ax_stderr.getvalue():
            __ax_diagnostics.append({"stream": "stderr", "text": __ax_stderr.getvalue()})
    except Exception:
        __ax_diagnostics = []
    __ax_response_json = json.dumps({
        "ok": False,
        "category": "runtime",
        "error": str(__ax_error),
        "traceback": traceback.format_exc(),
        "bindings": __ax_json_safe_bindings(__ax_globals),
        "diagnostics": __ax_diagnostics,
    })
__ax_response_json
`;
  }
}

class PyodideRuntimeServer {
  private readonly sessions = new Map<string, PyodideSession>();
  private readonly hostCallables = new Map<string, HostCallable>();
  private nextSessionId = 0;
  private readonly diagnostics: JsonObject[] = [];

  constructor(
    private readonly pyodide: PyodideLike,
    private readonly policy: RuntimePolicy
  ) {
    this.hostCallables.set('search', (params) => ({
      title: 'Docs',
      query:
        params && typeof params === 'object'
          ? String((params as JsonObject).query ?? '')
          : '',
    }));
    this.hostCallables.set('badTool', () => {
      throw new Error('tool failed');
    });
  }

  static async create(): Promise<PyodideRuntimeServer> {
    const { loadPyodide } = await importPyodidePackage();
    const policy = policyFromEnv();
    const diagnostics: JsonObject[] = [];
    const pyodide = await loadPyodide({
      stdout: (text: string) => diagnostics.push({ stream: 'stdout', text }),
      stderr: (text: string) => diagnostics.push({ stream: 'stderr', text }),
    });
    pyodide.setStdout?.({
      batched: (text: string) => diagnostics.push({ stream: 'stdout', text }),
    });
    pyodide.setStderr?.({
      batched: (text: string) => diagnostics.push({ stream: 'stderr', text }),
    });
    const server = new PyodideRuntimeServer(pyodide, policy);
    server.diagnostics.push(...diagnostics);
    (globalThis as JsonObject).__ax_host_call = (
      sessionId: string,
      name: string,
      paramsJson: string
    ) => {
      const session = server.sessions.get(String(sessionId));
      if (session) {
        return session.callHost(String(name), String(paramsJson ?? 'null'));
      }
      return JSON.stringify({
        ok: false,
        category: 'session_closed',
        error: 'no active Pyodide session',
      });
    };
    return server;
  }

  async handle(message: ProtocolMessage): Promise<unknown> {
    try {
      switch (message.op) {
        case 'capabilities':
          return ok(message.id, {
            language: 'Python',
            usage_instructions:
              'Python Pyodide runtime profile. Use final(...), askClarification(...), discover(...), recall(...), used(...), reportSuccess(...), and reportFailure(...).',
            inspect: true,
            snapshot: true,
            patch: true,
            abort: false,
            runtime_policy: this.policy,
            policy_support: {
              filesystem: false,
              network: false,
              packageLoading: 'allowlist',
              micropip: 'disabled-by-default',
              maxDiagnosticsChars: true,
              maxSnapshotBytes: true,
              timeoutMs: 'protocol-level',
            },
          });
        case 'create_session': {
          const sessionId = `p${++this.nextSessionId}`;
          const payload = message.payload ?? {};
          const globals =
            payload.globals && typeof payload.globals === 'object'
              ? (payload.globals as JsonObject)
              : {};
          const options =
            payload.options && typeof payload.options === 'object'
              ? (payload.options as JsonObject)
              : {};
          const sessionPolicy = policyFrom(options.runtimePolicy, this.policy);
          const session = new PyodideSession(
            this.pyodide,
            sessionId,
            globals,
            options,
            sessionPolicy,
            this.hostCallables,
            this.diagnostics
          );
          this.sessions.set(sessionId, session);
          return ok(
            message.id,
            { session_id: sessionId },
            { session_id: sessionId }
          );
        }
        case 'execute': {
          const session = this.session(message);
          const payload = message.payload ?? {};
          const result = await session.execute(String(payload.code ?? ''), {
            ...(payload.options && typeof payload.options === 'object'
              ? (payload.options as JsonObject)
              : {}),
          });
          return ok(message.id, result, { session_id: message.session_id });
        }
        case 'inspect_globals':
          return ok(message.id, this.session(message).inspectGlobals(), {
            session_id: message.session_id,
          });
        case 'snapshot_globals':
          return ok(message.id, this.session(message).snapshotGlobals(), {
            session_id: message.session_id,
          });
        case 'patch_globals': {
          const payload = message.payload ?? {};
          const globals =
            payload.globals && typeof payload.globals === 'object'
              ? (payload.globals as JsonObject)
              : {};
          return ok(message.id, this.session(message).patchGlobals(globals), {
            session_id: message.session_id,
          });
        }
        case 'close': {
          const session = this.session(message);
          const result = session.close();
          if (message.session_id) this.sessions.delete(message.session_id);
          return ok(message.id, result, { session_id: message.session_id });
        }
        case 'shutdown':
          for (const session of this.sessions.values()) session.close();
          this.sessions.clear();
          return ok(message.id, { shutdown: true });
        default:
          return fail(
            message.id,
            new Error(`unknown runtime protocol op: ${message.op}`),
            'protocol'
          );
      }
    } catch (error) {
      return fail(message.id, error);
    }
  }

  private session(message: ProtocolMessage): PyodideSession {
    const sessionId = message.session_id;
    if (!sessionId || !this.sessions.has(sessionId)) {
      throw Object.assign(new Error('session closed or unknown'), {
        category: 'session_closed',
      });
    }
    return this.sessions.get(sessionId)!;
  }
}

async function selfTest(): Promise<void> {
  let server: PyodideRuntimeServer;
  try {
    server = await PyodideRuntimeServer.create();
  } catch (error) {
    if (isModuleMissing(error)) {
      console.log(
        'pyodide-runtime-server-self-test-skip: pyodide package not found'
      );
      return;
    }
    throw error;
  }
  const created = (await server.handle({
    id: '1',
    op: 'create_session',
    payload: {
      globals: {
        inputs: { question: 'pyodide' },
        search: { __ax_host_callable: true, native: true },
        badTool: { __ax_host_callable: true, native: true },
      },
      options: { reservedNames: ['inputs'] },
    },
  })) as JsonObject;
  const sessionId = String(created.session_id);
  const capabilities = (await server.handle({
    id: 'cap',
    op: 'capabilities',
  })) as JsonObject;
  const capabilityPolicy = (capabilities.result as JsonObject)
    .runtime_policy as JsonObject;
  if (
    capabilityPolicy.allowFilesystem !== false ||
    capabilityPolicy.allowNetwork !== false ||
    capabilityPolicy.allowPackageLoading !== false
  ) {
    throw new Error(
      `bad default runtime policy: ${JSON.stringify(capabilities)}`
    );
  }
  const executed = (await server.handle({
    id: '2',
    op: 'execute',
    session_id: sessionId,
    payload: {
      code: "answer = inputs['question']\nfinal({'answer': answer})",
    },
  })) as JsonObject;
  const result = executed.result as JsonObject;
  if (result.type !== 'final')
    throw new Error(`expected final, got ${JSON.stringify(executed)}`);
  const execute = async (id: string, code: string) =>
    (await server.handle({
      id,
      op: 'execute',
      session_id: sessionId,
      payload: { code },
    })) as JsonObject;
  const expect = async (
    id: string,
    code: string,
    key: string,
    value: string
  ) => {
    const response = await execute(id, code);
    const responseResult = response.result as JsonObject;
    if (responseResult[key] !== value) {
      throw new Error(
        `expected ${key}=${value}, got ${JSON.stringify(response)}`
      );
    }
    return responseResult;
  };
  const counter1 = (
    await execute(
      '3',
      "counter = globals().get('counter', 0) + 1\nfinal({'counter': counter})"
    )
  ).result as JsonObject;
  const counter2 = (
    await execute('4', "counter = counter + 1\nfinal({'counter': counter})")
  ).result as JsonObject;
  const counterPayload = (counter2.args as JsonObject[])[0] as JsonObject;
  if (counterPayload.counter !== 2) {
    throw new Error(
      `persistent binding failed: ${JSON.stringify(counter1)} ${JSON.stringify(counter2)}`
    );
  }
  await expect(
    '5',
    "askClarification({'question': 'Need detail?'})",
    'type',
    'askClarification'
  );
  await expect('6', "discover({'tools': ['search']})", 'kind', 'discover');
  await expect('7', "recall({'query': 'docs'})", 'kind', 'recall');
  await expect('8', "used('mem1', 'helpful')", 'kind', 'used');
  await expect('9', "reportSuccess('ok')", 'kind', 'status');
  await expect('10', "reportFailure('bad')", 'kind', 'status');
  await expect('11', "guideAgent('try this')", 'type', 'guide_agent');
  const bridged = (await server.handle({
    id: '12',
    op: 'execute',
    session_id: sessionId,
    payload: {
      code: "hit = search({'query': inputs['question']})\nfinal({'title': hit['title']})",
    },
  })) as JsonObject;
  const bridgedResult = bridged.result as JsonObject;
  if (JSON.stringify(bridgedResult).includes('Docs') === false) {
    throw new Error(`host callable bridge failed: ${JSON.stringify(bridged)}`);
  }
  const failed = (
    await execute('13', "err = badTool({})\nfinal({'error': err['error']})")
  ).result as JsonObject;
  if (!JSON.stringify(failed).includes('tool failed')) {
    throw new Error(`host callable error failed: ${JSON.stringify(failed)}`);
  }
  const diagnostics = (
    await execute('14', "print('hello from pyodide')\nfinal({'ok': True})")
  ).result as JsonObject;
  if (!JSON.stringify(diagnostics).includes('hello from pyodide')) {
    throw new Error(
      `stdout diagnostics failed: ${JSON.stringify(diagnostics)}`
    );
  }
  const packageDenied = (
    await execute(
      '14b',
      "pkg = loadPackage('numpy')\nfinal({'error': pkg['error']})"
    )
  ).result as JsonObject;
  if (!JSON.stringify(packageDenied).includes('package loading is disabled')) {
    throw new Error(`package denial failed: ${JSON.stringify(packageDenied)}`);
  }
  const allowedCreated = (await server.handle({
    id: '14c',
    op: 'create_session',
    payload: {
      globals: {},
      options: {
        runtimePolicy: {
          allowPackageLoading: true,
          packageAllowlist: ['numpy'],
        },
      },
    },
  })) as JsonObject;
  const allowedSessionId = String(allowedCreated.session_id);
  const packageAllowed = (await server.handle({
    id: '14d',
    op: 'execute',
    session_id: allowedSessionId,
    payload: {
      code: "pkg = loadPackage('numpy')\nfinal({'kind': pkg['kind']})",
    },
  })) as JsonObject;
  if (!JSON.stringify(packageAllowed).includes('status')) {
    throw new Error(
      `package allowlist failed: ${JSON.stringify(packageAllowed)}`
    );
  }
  await server.handle({ id: '14e', op: 'close', session_id: allowedSessionId });
  const runtimeError = (await execute('15', "raise Exception('boom')"))
    .result as JsonObject;
  if (runtimeError.error_category !== 'runtime') {
    throw new Error(
      `runtime error normalization failed: ${JSON.stringify(runtimeError)}`
    );
  }
  await server.handle({
    id: '16',
    op: 'snapshot_globals',
    session_id: sessionId,
  });
  await server.handle({
    id: '17',
    op: 'patch_globals',
    session_id: sessionId,
    payload: { globals: { bindings: { safe: 9 } } },
  });
  const inspected = (await server.handle({
    id: '18',
    op: 'inspect_globals',
    session_id: sessionId,
  })) as JsonObject;
  if (!JSON.stringify(inspected).includes('"safe":9')) {
    throw new Error(`patch/inspect failed: ${JSON.stringify(inspected)}`);
  }
  await server.handle({ id: '19', op: 'close', session_id: sessionId });
  const closed = await execute('20', "final({'answer': 'closed'})");
  if (closed.ok !== false) {
    throw new Error(`closed session failed: ${JSON.stringify(closed)}`);
  }
  await server.handle({ id: '21', op: 'shutdown' });
  console.log('pyodide-runtime-server-self-test-ok');
}

async function runServer(): Promise<void> {
  const server = await PyodideRuntimeServer.create();
  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const response = await server.handle(JSON.parse(line) as ProtocolMessage);
      output.write(`${JSON.stringify(response)}\n`);
      if ((response as JsonObject).ok && (response as JsonObject).result) {
        const result = (response as JsonObject).result as JsonObject;
        if (result.shutdown) break;
      }
    } catch (error) {
      output.write(`${JSON.stringify(fail(undefined, error, 'protocol'))}\n`);
    }
  }
}

const args = new Set(process.argv.slice(2));
const npmSelfTest = process.env.npm_config_self_test === 'true';
if (args.has('--self-test') || npmSelfTest) {
  await selfTest();
} else {
  await runServer();
}
