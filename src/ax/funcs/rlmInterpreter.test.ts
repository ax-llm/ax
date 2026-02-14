import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AxRLMJSInterpreter,
  AxRLMJSInterpreterPermission,
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
});

// --- Tests ---

describe('AxRLMJSInterpreterPermission', () => {
  it('has expected string values', () => {
    expect(AxRLMJSInterpreterPermission.NETWORK).toBe('network');
    expect(AxRLMJSInterpreterPermission.STORAGE).toBe('storage');
    expect(AxRLMJSInterpreterPermission.CODE_LOADING).toBe('code-loading');
    expect(AxRLMJSInterpreterPermission.COMMUNICATION).toBe('communication');
    expect(AxRLMJSInterpreterPermission.TIMING).toBe('timing');
    expect(AxRLMJSInterpreterPermission.WORKERS).toBe('workers');
  });
});

describe('AxRLMJSInterpreter', () => {
  it('sends empty permissions by default', () => {
    const interp = new AxRLMJSInterpreter();
    interp.createSession();

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.type).toBe('init');
    expect(initMsg.permissions).toEqual([]);
  });

  it('sends custom permissions in init message', () => {
    const interp = new AxRLMJSInterpreter({
      permissions: [
        AxRLMJSInterpreterPermission.NETWORK,
        AxRLMJSInterpreterPermission.STORAGE,
      ],
    });
    interp.createSession();

    const initMsg = mockPostMessage.mock.calls[0]![0];
    expect(initMsg.permissions).toEqual(['network', 'storage']);
  });

  it('worker source contains _PERM_GLOBALS with expected globals', () => {
    const interp = new AxRLMJSInterpreter();
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
    const interp = new AxRLMJSInterpreter();
    const session = interp.createSession();

    expect(mockTerminate).not.toHaveBeenCalled();
    session.close();
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('close() rejects pending executions', async () => {
    const interp = new AxRLMJSInterpreter();
    const session = interp.createSession();

    const promise = session.execute('1+1');
    session.close();

    await expect(promise).rejects.toThrow('Worker terminated');
  });
});
