import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AxJSRuntime, AxJSRuntimePermission } from './jsRuntime.js';

// --- Mock browser globals ---
const mockPostMessage = vi.fn();
const mockTerminate = vi.fn();
const mockWorkerInstance = {
  postMessage: mockPostMessage,
  terminate: mockTerminate,
  onmessage: null as ((e: MessageEvent) => void) | null,
};

vi.stubGlobal(
  'Worker',
  vi.fn(() => mockWorkerInstance)
);
vi.stubGlobal('Blob', vi.fn());
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkerInstance.onmessage = null;
  delete (globalThis as { Deno?: unknown }).Deno;
});

// --- Tests ---

describe('AxJSRuntimePermission', () => {
  it('has expected string values', () => {
    expect(AxJSRuntimePermission.NETWORK).toBe('network');
    expect(AxJSRuntimePermission.STORAGE).toBe('storage');
    expect(AxJSRuntimePermission.CODE_LOADING).toBe('code-loading');
    expect(AxJSRuntimePermission.COMMUNICATION).toBe('communication');
    expect(AxJSRuntimePermission.TIMING).toBe('timing');
    expect(AxJSRuntimePermission.WORKERS).toBe('workers');
  });
});

describe('AxJSRuntime', () => {
  it('provides runtime usage instructions for RLM prompts', () => {
    const interp = new AxJSRuntime();
    const instructions = interp.getUsageInstructions();

    expect(typeof instructions).toBe('string');
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain('State is session-scoped');
    expect(instructions).toContain('globalThis');
    expect(instructions).toContain('var');
  });

  it('sends empty permissions by default', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.type).toBe('init');
    expect(initMsg.permissions).toEqual([]);
  });

  it('sends custom permissions in init message', () => {
    const interp = new AxJSRuntime({
      permissions: [
        AxJSRuntimePermission.NETWORK,
        AxJSRuntimePermission.STORAGE,
      ],
    });
    interp.createSession();

    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.permissions).toEqual(['network', 'storage']);
  });

  it('uses stdout output mode by default', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.outputMode).toBe('stdout');
    expect(initMsg.captureConsole).toBe(true);
  });

  it('enables stdout capture mode when configured', () => {
    const interp = new AxJSRuntime({ outputMode: 'stdout' });
    interp.createSession();

    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.outputMode).toBe('stdout');
    expect(initMsg.captureConsole).toBe(true);
  });

  it('allows disabling console capture in stdout mode', () => {
    const interp = new AxJSRuntime({
      outputMode: 'stdout',
      captureConsole: false,
    });
    interp.createSession();

    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.outputMode).toBe('stdout');
    expect(initMsg.captureConsole).toBe(false);
  });

  it('worker source contains _PERM_GLOBALS with expected globals', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    // The Blob constructor receives the worker source as first argument
    const BlobMock = vi.mocked(globalThis.Blob);
    const blobArgs = BlobMock.mock.calls[0]![0] as string[];
    const source = blobArgs[0]!;

    // Verify the lockdown map exists with expected global names
    const expectedGlobals = [
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'indexedDB',
      'caches',
      'importScripts',
      'BroadcastChannel',
      'performance',
      'Worker',
      'SharedWorker',
    ];

    expect(source).toContain('_PERM_GLOBALS');
    for (const name of expectedGlobals) {
      expect(source).toMatch(new RegExp(`['"]${name}['"]`));
    }
  });

  it('worker source includes async trailing-expression auto-return helper', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    const BlobMock = vi.mocked(globalThis.Blob);
    const blobArgs = BlobMock.mock.calls[0]![0] as string[];
    const source = blobArgs[0]!;

    expect(source).toContain('const _injectAsyncAutoReturn = (code) =>');
    expect(source).toContain('const _buildAsyncAutoReturnSource = (');
    expect(source).toContain('const _canCompileAsyncSource = (source) =>');
    expect(source).toContain('return (');
  });

  it('worker source bootstraps serialized runtime with config payload', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    const BlobMock = vi.mocked(globalThis.Blob);
    const blobArgs = BlobMock.mock.calls[0]![0] as string[];
    const source = blobArgs[0]!;

    expect(source).toContain('function axWorkerRuntime');
    expect(source).toContain('"functionRefKey"');
    expect(source).toContain('"maxErrorCauseDepth"');
    expect(source.endsWith('\n')).toBe(true);
  });

  it('worker source rewrites top-level sync return snippets', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    const BlobMock = vi.mocked(globalThis.Blob);
    const blobArgs = BlobMock.mock.calls[0]![0] as string[];
    const source = blobArgs[0]!;

    expect(source).toContain(
      'const _rewriteTopLevelReturnForSyncEval = (code) =>'
    );
    expect(source).toContain('_TOP_LEVEL_RETURN_ONLY');
  });

  it('worker source supports stdout capture and print hint output', () => {
    const interp = new AxJSRuntime();
    interp.createSession();

    const BlobMock = vi.mocked(globalThis.Blob);
    const blobArgs = BlobMock.mock.calls[0]![0] as string[];
    const source = blobArgs[0]!;

    expect(source).toContain('_OUTPUT_MODE_STDOUT');
    expect(source).toContain('_scope.print = (...args) =>');
  });

  it('usage instructions mention output mode behavior', () => {
    const stdoutMode = new AxJSRuntime().getUsageInstructions();
    const returnMode = new AxJSRuntime({
      outputMode: 'return',
    }).getUsageInstructions();

    expect(stdoutMode).toContain('console.log(...)');
    expect(returnMode).toContain('return');
  });

  it('close() calls worker.terminate()', () => {
    const interp = new AxJSRuntime();
    const session = interp.createSession();

    expect(mockTerminate).not.toHaveBeenCalled();
    session.close();
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('close() rejects pending executions', async () => {
    const interp = new AxJSRuntime();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    session.close();

    await expect(promise).rejects.toThrow('Worker terminated');
  });

  it('result with legacy string error rejects with Error with that message', async () => {
    const interp = new AxJSRuntime();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    await Promise.resolve();
    const executeCall = mockPostMessage.mock.calls.find(
      (call) => call[0]?.type === 'execute'
    );
    const executeMsg = executeCall![0] as { type: string; id: number };
    mockWorkerInstance.onmessage?.({
      data: { type: 'result', id: executeMsg.id, error: 'something wrong' },
    } as MessageEvent);

    const err = await promise.catch((x) => x);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('something wrong');
  });

  it('result with structured error rejects with Error preserving name and message', async () => {
    const interp = new AxJSRuntime();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    await Promise.resolve();
    const executeCall = mockPostMessage.mock.calls.find(
      (call) => call[0]?.type === 'execute'
    );
    const executeMsg = executeCall![0] as { type: string; id: number };
    mockWorkerInstance.onmessage?.({
      data: {
        type: 'result',
        id: executeMsg.id,
        error: { name: 'TypeError', message: 'x is not a function' },
      },
    } as MessageEvent);

    const err = await promise.catch((x) => x);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('TypeError');
    expect((err as Error).message).toBe('x is not a function');
  });

  it('result with structured error including data rejects with data on error', async () => {
    const interp = new AxJSRuntime();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    await Promise.resolve();
    const executeCall = mockPostMessage.mock.calls.find(
      (call) => call[0]?.type === 'execute'
    );
    const executeMsg = executeCall![0] as { type: string; id: number };
    mockWorkerInstance.onmessage?.({
      data: {
        type: 'result',
        id: executeMsg.id,
        error: {
          name: 'CustomError',
          message: 'failed',
          data: { code: 'E1', args: [1, 2] },
        },
      },
    } as MessageEvent);

    const err = await promise.catch((x) => x);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('CustomError');
    expect((err as Error).message).toBe('failed');
    expect((err as Error & { data?: unknown }).data).toEqual({
      code: 'E1',
      args: [1, 2],
    });
  });

  it('result with structured error including cause rejects with cause chain', async () => {
    const interp = new AxJSRuntime();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    await Promise.resolve();
    const executeCall = mockPostMessage.mock.calls.find(
      (call) => call[0]?.type === 'execute'
    );
    const executeMsg = executeCall![0] as { type: string; id: number };
    mockWorkerInstance.onmessage?.({
      data: {
        type: 'result',
        id: executeMsg.id,
        error: {
          name: 'WaitForUserActionError',
          message: 'outer',
          cause: { name: 'AgentError', message: 'inner' },
        },
      },
    } as MessageEvent);

    const err = await promise.catch((x) => x);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('WaitForUserActionError');
    expect((err as Error).message).toBe('outer');
    const cause = (err as Error & { cause?: Error }).cause;
    expect(cause).toBeInstanceOf(Error);
    expect(cause!.name).toBe('AgentError');
    expect(cause!.message).toBe('inner');
  });

  it('toFunction() executes code and closes session', async () => {
    const interp = new AxJSRuntime();
    const fn = interp.toFunction();

    const promise = fn.func({ code: '1+1' });

    // execute is posted asynchronously after worker readiness
    await Promise.resolve();
    const executeCall = mockPostMessage.mock.calls.find(
      (call) => call[0]?.type === 'execute'
    );
    expect(executeCall).toBeDefined();
    const executeMsg = executeCall![0] as {
      type: string;
      id: number;
    };
    expect(executeMsg.type).toBe('execute');

    mockWorkerInstance.onmessage?.({
      data: { type: 'result', id: executeMsg.id, value: 2 },
    } as MessageEvent);

    await expect(promise).resolves.toBe(2);
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('uses Deno module worker options when available', () => {
    (globalThis as { Deno?: unknown }).Deno = { version: { deno: '2.6.3' } };

    const interp = new AxJSRuntime({
      permissions: [AxJSRuntimePermission.NETWORK],
    });
    interp.createSession();

    const WorkerMock = vi.mocked(
      globalThis.Worker as unknown as ReturnType<typeof vi.fn>
    );
    const workerCtorCall = WorkerMock.mock.calls[0]!;
    const workerOptions = workerCtorCall[1] as Record<string, unknown>;

    expect(workerOptions.type).toBe('module');
    expect(workerOptions.deno).toEqual({
      permissions: { net: true },
    });
  });
});
