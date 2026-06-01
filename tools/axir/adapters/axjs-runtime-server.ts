import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';

import { AxJSRuntime } from '../../../src/ax/funcs/jsRuntime.js';

type JsonObject = Record<string, unknown>;

type ProtocolMessage = {
  id?: string | number;
  op?: string;
  session_id?: string;
  payload?: JsonObject;
};

type RuntimeSession = {
  execute(code: string, options?: JsonObject): Promise<unknown>;
  inspectGlobals?(options?: JsonObject): Promise<unknown>;
  snapshotGlobals?(options?: JsonObject): Promise<unknown>;
  patchGlobals?(globals: JsonObject, options?: JsonObject): Promise<unknown>;
  close(): void;
};

type RuntimeLike = {
  readonly language?: string;
  getUsageInstructions(): string;
  createSession(globals?: JsonObject, options?: JsonObject): RuntimeSession;
};

function errorCategory(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
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

function withRuntimePrimitives(globals: JsonObject): JsonObject {
  return {
    ...globals,
    final: (...args: unknown[]) => ({ type: 'final', args }),
    askClarification: (...args: unknown[]) => ({
      type: 'askClarification',
      args,
    }),
    discover: (request: unknown) => ({ kind: 'discover', discover: request }),
    recall: (request: unknown) => ({ kind: 'recall', recall: request }),
    used: (idOrRequest: unknown, reason?: string) => ({
      kind: 'used',
      used:
        idOrRequest && typeof idOrRequest === 'object'
          ? idOrRequest
          : { id: idOrRequest, ...(reason ? { reason } : {}) },
    }),
    reportSuccess: (message: string) => ({
      kind: 'status',
      status: { type: 'success', message },
    }),
    reportFailure: (message: string) => ({
      kind: 'status',
      status: { type: 'failed', message },
    }),
    guideAgent: (guidance: string) => ({
      type: 'guide_agent',
      guidance,
    }),
  };
}

class FixtureSession implements RuntimeSession {
  private globals: JsonObject;
  private closed = false;

  constructor(globals: JsonObject) {
    this.globals = { ...globals };
  }

  async execute(code: string): Promise<unknown> {
    if (this.closed)
      throw Object.assign(new Error('session closed'), {
        category: 'session_closed',
      });
    if (code === 'timeout()')
      throw Object.assign(new Error('fixture timeout'), {
        category: 'timeout',
      });
    this.globals.answer = 'fixture';
    if (code.includes('askClarification')) {
      return { type: 'askClarification', args: [{ question: 'Need detail?' }] };
    }
    return { type: 'final', args: [{ answer: this.globals.answer }] };
  }

  async inspectGlobals(): Promise<unknown> {
    return { ...this.globals };
  }

  async snapshotGlobals(): Promise<unknown> {
    return {
      version: 1,
      entries: [],
      bindings: { ...this.globals },
      globals: { ...this.globals },
      closed: this.closed,
    };
  }

  async patchGlobals(globals: JsonObject): Promise<unknown> {
    const bindings =
      globals.bindings && typeof globals.bindings === 'object'
        ? (globals.bindings as JsonObject)
        : globals;
    this.globals = { ...bindings };
    return this.snapshotGlobals();
  }

  close(): void {
    this.closed = true;
  }
}

class FixtureRuntime implements RuntimeLike {
  readonly language = 'JavaScript';

  getUsageInstructions(): string {
    return 'Fixture runtime for deterministic AxIR adapter protocol tests.';
  }

  createSession(globals?: JsonObject): RuntimeSession {
    return new FixtureSession(globals ?? {});
  }
}

class RuntimeProtocolServer {
  private readonly sessions = new Map<string, RuntimeSession>();
  private nextSessionId = 0;

  constructor(private readonly runtime: RuntimeLike) {}

  async handle(message: ProtocolMessage): Promise<unknown> {
    try {
      switch (message.op) {
        case 'capabilities':
          return ok(message.id, {
            language: this.runtime.language ?? 'JavaScript',
            usage_instructions: this.runtime.getUsageInstructions(),
            inspect: true,
            snapshot: true,
            patch: true,
            abort: true,
          });
        case 'create_session': {
          const payload = message.payload ?? {};
          const sessionId = `s${++this.nextSessionId}`;
          const globals = withRuntimePrimitives(
            (payload.globals && typeof payload.globals === 'object'
              ? payload.globals
              : {}) as JsonObject
          );
          const session = this.runtime.createSession(
            globals,
            (payload.options && typeof payload.options === 'object'
              ? payload.options
              : {}) as JsonObject
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
        case 'inspect_globals': {
          const session = this.session(message);
          if (!session.inspectGlobals) {
            return fail(
              message.id,
              new Error('inspectGlobals unavailable'),
              'unavailable'
            );
          }
          const result = await session.inspectGlobals(message.payload ?? {});
          return ok(message.id, result, { session_id: message.session_id });
        }
        case 'snapshot_globals': {
          const session = this.session(message);
          if (!session.snapshotGlobals) {
            return fail(
              message.id,
              new Error('snapshotGlobals unavailable'),
              'unavailable'
            );
          }
          const result = await session.snapshotGlobals(message.payload ?? {});
          return ok(message.id, result, { session_id: message.session_id });
        }
        case 'patch_globals': {
          const session = this.session(message);
          if (!session.patchGlobals) {
            return fail(
              message.id,
              new Error('patchGlobals unavailable'),
              'unavailable'
            );
          }
          const payload = message.payload ?? {};
          const result = await session.patchGlobals(
            (payload.globals && typeof payload.globals === 'object'
              ? payload.globals
              : {}) as JsonObject,
            (payload.options && typeof payload.options === 'object'
              ? payload.options
              : {}) as JsonObject
          );
          const patched =
            result ??
            (session.snapshotGlobals
              ? await session.snapshotGlobals(payload.options as JsonObject)
              : { patched: true });
          return ok(message.id, patched, {
            session_id: message.session_id,
          });
        }
        case 'close': {
          const session = this.session(message);
          session.close();
          if (message.session_id) this.sessions.delete(message.session_id);
          return ok(
            message.id,
            { closed: true },
            { session_id: message.session_id }
          );
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

  private session(message: ProtocolMessage): RuntimeSession {
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
  const server = new RuntimeProtocolServer(
    new AxJSRuntime({ outputMode: 'return' }) as unknown as RuntimeLike
  );
  const created = (await server.handle({
    id: '1',
    op: 'create_session',
    payload: {
      globals: { inputs: { question: 'adapter' } },
      options: { reservedNames: ['inputs', 'final'] },
    },
  })) as JsonObject;
  const sessionId = String(created.session_id);
  const execute = async (id: string, code: string) =>
    (await server.handle({
      id,
      op: 'execute',
      session_id: sessionId,
      payload: {
        code,
        options: { reservedNames: ['inputs', 'final'] },
      },
    })) as JsonObject;
  const expect = async (
    id: string,
    code: string,
    key: string,
    value: string
  ) => {
    const executed = await execute(id, code);
    const result = executed.result as JsonObject;
    if (result[key] !== value) {
      throw new Error(
        `self-test expected ${key}=${value}, got ${JSON.stringify(executed)}`
      );
    }
    return result;
  };
  await expect(
    '2',
    'answer = inputs.question; await final({ answer })',
    'type',
    'final'
  );
  const counter1 = (
    await execute(
      '3',
      "counter = (typeof counter === 'undefined' ? 0 : counter) + 1; await final({ counter })"
    )
  ).result as JsonObject;
  const counter2 = (
    await execute('4', 'counter = counter + 1; await final({ counter })')
  ).result as JsonObject;
  const counterPayload = (counter2.args as JsonObject[])[0] as JsonObject;
  if (counterPayload.counter !== 2) {
    throw new Error(
      `self-test persistent state failed: ${JSON.stringify(counter1)} ${JSON.stringify(counter2)}`
    );
  }
  await expect(
    '5',
    "await askClarification('more?')",
    'type',
    'askClarification'
  );
  await expect(
    '6',
    "await discover({ tools: ['search'] })",
    'kind',
    'discover'
  );
  await expect('7', "await recall({ query: 'docs' })", 'kind', 'recall');
  await expect('8', "await used('mem1', 'helpful')", 'kind', 'used');
  await expect('9', "await reportSuccess('ok')", 'kind', 'status');
  await expect('10', "await reportFailure('bad')", 'kind', 'status');
  await expect('11', "await guideAgent('try this')", 'type', 'guide_agent');
  const snapshot = (await server.handle({
    id: '12',
    op: 'snapshot_globals',
    session_id: sessionId,
  })) as JsonObject;
  if (!snapshot.ok) throw new Error('self-test snapshot failed');
  await server.handle({
    id: '13',
    op: 'patch_globals',
    session_id: sessionId,
    payload: {
      globals: (snapshot.result as JsonObject).bindings as JsonObject,
    },
  });
  await server.handle({ id: '14', op: 'close', session_id: sessionId });
  const closed = (await server.handle({
    id: '15',
    op: 'execute',
    session_id: sessionId,
    payload: { code: 'await final({})' },
  })) as JsonObject;
  if (closed.ok !== false) throw new Error('self-test closed session failed');
  await server.handle({ id: '16', op: 'shutdown' });

  const fixture = new RuntimeProtocolServer(new FixtureRuntime());
  const fixtureSession = (await fixture.handle({
    id: 'f1',
    op: 'create_session',
    payload: { globals: { inputs: {} } },
  })) as JsonObject;
  const fixtureOut = (await fixture.handle({
    id: 'f2',
    op: 'execute',
    session_id: String(fixtureSession.session_id),
    payload: { code: 'final()' },
  })) as JsonObject;
  if ((fixtureOut.result as JsonObject).type !== 'final') {
    throw new Error('fixture mode self-test failed');
  }
  console.log('axjs-runtime-server-self-test-ok');
}

async function runServer(fixtureMode: boolean): Promise<void> {
  const runtime = fixtureMode
    ? new FixtureRuntime()
    : (new AxJSRuntime({ outputMode: 'return' }) as unknown as RuntimeLike);
  const server = new RuntimeProtocolServer(runtime);
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
const npmFixture = process.env.npm_config_fixture === 'true';
if (args.has('--self-test') || npmSelfTest) {
  await selfTest();
} else {
  await runServer(args.has('--fixture') || npmFixture);
}
