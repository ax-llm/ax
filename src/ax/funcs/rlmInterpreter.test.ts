import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AxJSInterpreter,
  AxJSInterpreterPermission,
} from './rlmInterpreter.js';

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

describe('AxJSInterpreterPermission', () => {
  it('has expected string values', () => {
    expect(AxJSInterpreterPermission.NETWORK).toBe('network');
    expect(AxJSInterpreterPermission.STORAGE).toBe('storage');
    expect(AxJSInterpreterPermission.CODE_LOADING).toBe('code-loading');
    expect(AxJSInterpreterPermission.COMMUNICATION).toBe('communication');
    expect(AxJSInterpreterPermission.TIMING).toBe('timing');
    expect(AxJSInterpreterPermission.WORKERS).toBe('workers');
  });
});

describe('AxJSInterpreter', () => {
  it('sends empty permissions by default', () => {
    const interp = new AxJSInterpreter();
    interp.createSession();

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.type).toBe('init');
    expect(initMsg.permissions).toEqual([]);
  });

  it('sends custom permissions in init message', () => {
    const interp = new AxJSInterpreter({
      permissions: [
        AxJSInterpreterPermission.NETWORK,
        AxJSInterpreterPermission.STORAGE,
      ],
    });
    interp.createSession();

    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.permissions).toEqual(['network', 'storage']);
  });

  it('worker source contains _PERM_GLOBALS with expected globals', () => {
    const interp = new AxJSInterpreter();
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
      expect(source).toContain(`'${name}'`);
    }
  });

  it('close() calls worker.terminate()', () => {
    const interp = new AxJSInterpreter();
    const session = interp.createSession();

    expect(mockTerminate).not.toHaveBeenCalled();
    session.close();
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('close() rejects pending executions', async () => {
    const interp = new AxJSInterpreter();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    session.close();

    await expect(promise).rejects.toThrow('Worker terminated');
  });

  it('toFunction() executes code and closes session', async () => {
    const interp = new AxJSInterpreter();
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

    const interp = new AxJSInterpreter({
      permissions: [AxJSInterpreterPermission.NETWORK],
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
