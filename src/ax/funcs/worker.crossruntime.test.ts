import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getWorkerSource } from './worker.js';

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

const hasRuntime = (name: string): boolean => {
  try {
    execFileSync('which', [name], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

const HAS_DENO = hasRuntime('deno');
const HAS_BUN = hasRuntime('bun');

// ---------------------------------------------------------------------------
// Harness helper
// ---------------------------------------------------------------------------

type HarnessResult = { exitCode: number; stdout: string; stderr: string };

const runHarness = (
  runtime: string,
  args: string[],
  harnessCode: string,
  harnessFilename: string,
  tmpDir: string
): HarnessResult => {
  const harnessPath = join(tmpDir, harnessFilename);
  writeFileSync(harnessPath, harnessCode, 'utf-8');

  try {
    const stdout = execFileSync(
      runtime,
      [...args, harnessPath, join(tmpDir, 'worker-source.js')],
      {
        timeout: 15_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
};

// ---------------------------------------------------------------------------
// Cross-runtime worker smoke tests
// ---------------------------------------------------------------------------

describe('cross-runtime worker smoke tests', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ax-worker-xrt-'));
    const workerSource = getWorkerSource();
    writeFileSync(join(tmpDir, 'worker-source.js'), workerSource, 'utf-8');
  });

  afterAll(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Node worker_threads
  // -------------------------------------------------------------------------

  it('works in a real Node worker_threads Worker', () => {
    const harness = `
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

const workerSourcePath = process.argv[2];
const workerSource = readFileSync(workerSourcePath, 'utf-8');

const tests = [
  { id: 1, code: '2 + 3',                     expect: (v) => v === 5,                                          label: 'sync eval' },
  { id: 2, code: 'await Promise.resolve(42)',  expect: (v) => v === 42,                                         label: 'async eval' },
  { id: 3, code: 'null.foo',                   expect: (v) => typeof v === 'string' && v.startsWith('TypeError:'), label: 'error handling' },
];

const worker = new Worker(workerSource, { eval: true });
const timeout = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 5000);

const results = new Map();

worker.on('message', (msg) => {
  if (msg.type === 'result') {
    results.set(msg.id, msg);
    if (results.size === tests.length) {
      clearTimeout(timeout);
      let ok = true;
      for (const t of tests) {
        const r = results.get(t.id);
        if (!r) {
          console.error('FAIL: no result for ' + t.label);
          ok = false;
        } else {
          const value = r.error !== undefined ? r.error.name + ': ' + r.error.message : r.value;
          if (!t.expect(value)) {
            console.error('FAIL ' + t.label + ': got ' + JSON.stringify(value));
            ok = false;
          }
        }
      }
      worker.terminate();
      process.exit(ok ? 0 : 1);
    }
  }
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
  process.exit(1);
});

worker.postMessage({ type: 'init', outputMode: 'return' });
for (const t of tests) {
  worker.postMessage({ type: 'execute', id: t.id, code: t.code });
}
`;

    const result = runHarness('node', [], harness, 'node-harness.mjs', tmpDir);
    expect(
      result.exitCode,
      `Node harness failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    ).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Deno Web Worker
  // -------------------------------------------------------------------------

  it.skipIf(!HAS_DENO)('works in a real Deno Web Worker', () => {
    const harness = `
const workerSourcePath = Deno.args[0];
const workerSource = await Deno.readTextFile(workerSourcePath);
const blob = new Blob([workerSource], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);

const tests = [
  { id: 1, code: '2 + 3',                     expect: (v) => v === 5,                                          label: 'sync eval' },
  { id: 2, code: 'await Promise.resolve(42)',  expect: (v) => v === 42,                                         label: 'async eval' },
  { id: 3, code: 'null.foo',                   expect: (v) => typeof v === 'string' && v.startsWith('TypeError:'), label: 'error handling' },
];

const worker = new Worker(blobUrl, { type: 'module' });
const timeout = setTimeout(() => { console.error('TIMEOUT'); Deno.exit(1); }, 5000);

const results = new Map();

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'result') {
    results.set(msg.id, msg);
    if (results.size === tests.length) {
      clearTimeout(timeout);
      let ok = true;
      for (const t of tests) {
        const r = results.get(t.id);
        if (!r) {
          console.error('FAIL: no result for ' + t.label);
          ok = false;
        } else {
          const value = r.error !== undefined ? r.error.name + ': ' + r.error.message : r.value;
          if (!t.expect(value)) {
            console.error('FAIL ' + t.label + ': got ' + JSON.stringify(value));
            ok = false;
          }
        }
      }
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      Deno.exit(ok ? 0 : 1);
    }
  }
};

worker.onerror = (err) => {
  console.error('Worker error:', err.message || err);
  Deno.exit(1);
};

worker.postMessage({ type: 'init', outputMode: 'return' });
for (const t of tests) {
  worker.postMessage({ type: 'execute', id: t.id, code: t.code });
}
`;

    const result = runHarness(
      'deno',
      ['run', '--allow-read', '--allow-net'],
      harness,
      'deno-harness.js',
      tmpDir
    );
    expect(
      result.exitCode,
      `Deno harness failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    ).toBe(0);
  });

  it.skipIf(!HAS_DENO)(
    'round-trips snapshots in a real Deno Web Worker without restoring locked globals',
    () => {
      const harness = `
const workerSourcePath = Deno.args[0];
const workerSource = await Deno.readTextFile(workerSourcePath);
const blob = new Blob([workerSource], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);
const worker = new Worker(blobUrl, { type: 'module' });
const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  Deno.exit(1);
}, 5000);

let nextId = 1;
const pending = new Map();

const cleanup = (code) => {
  clearTimeout(timeout);
  worker.terminate();
  URL.revokeObjectURL(blobUrl);
  Deno.exit(code);
};

const fail = (message) => {
  console.error(message);
  cleanup(1);
};

const call = (payload) =>
  new Promise((resolve, reject) => {
    const id = payload.id ?? nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id });
  });

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type !== 'result' || typeof msg.id !== 'number') {
    return;
  }
  const pendingEntry = pending.get(msg.id);
  if (!pendingEntry) {
    return;
  }
  pending.delete(msg.id);
  if (msg.error !== undefined) {
    pendingEntry.reject(msg.error);
  } else {
    pendingEntry.resolve(msg.value);
  }
};

worker.onerror = (err) => {
  console.error('Worker error:', err.message || err);
  cleanup(1);
};

worker.postMessage({ type: 'init', outputMode: 'return' });

try {
  await call({ type: 'execute', code: 'globalThis.answer = 42' });
  const snapshot = await call({ type: 'snapshot-globals', reservedNames: [] });

  if (!snapshot || typeof snapshot !== 'object') {
    fail('FAIL: snapshot response missing');
  }

  const bindings =
    snapshot && typeof snapshot === 'object' && snapshot.bindings &&
    typeof snapshot.bindings === 'object'
      ? snapshot.bindings
      : null;
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];

  if (!bindings || bindings.answer !== 42) {
    fail('FAIL: user binding missing from snapshot');
  }

  for (const name of ['SharedWorker', 'XMLHttpRequest', 'indexedDB', 'importScripts', 'require']) {
    if (Object.prototype.hasOwnProperty.call(bindings, name)) {
      fail('FAIL: locked binding leaked into snapshot: ' + name);
    }
    if (entries.some((entry) => entry?.name === name)) {
      fail('FAIL: locked entry leaked into snapshot: ' + name);
    }
  }

  await call({ type: 'update-globals', globals: bindings });
  cleanup(0);
} catch (err) {
  console.error('Harness failure:', JSON.stringify(err));
  cleanup(1);
}
`;

      const result = runHarness(
        'deno',
        ['run', '--allow-read'],
        harness,
        'deno-snapshot-harness.js',
        tmpDir
      );
      expect(
        result.exitCode,
        `Deno snapshot harness failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      ).toBe(0);
    }
  );

  // -------------------------------------------------------------------------
  // Bun Web Worker
  // -------------------------------------------------------------------------

  it.skipIf(!HAS_BUN)('works in a real Bun Web Worker', () => {
    const harness = `
import { readFileSync } from 'node:fs';

const workerSourcePath = process.argv[2];
const workerSource = readFileSync(workerSourcePath, 'utf-8');
const blob = new Blob([workerSource], { type: 'application/javascript' });
const blobUrl = URL.createObjectURL(blob);

const tests = [
  { id: 1, code: '2 + 3',                     expect: (v) => v === 5,                                          label: 'sync eval' },
  { id: 2, code: 'await Promise.resolve(42)',  expect: (v) => v === 42,                                         label: 'async eval' },
  { id: 3, code: 'null.foo',                   expect: (v) => typeof v === 'string' && v.startsWith('TypeError:'), label: 'error handling' },
];

const worker = new Worker(blobUrl);
const timeout = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 5000);

const results = new Map();

worker.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'result') {
    results.set(msg.id, msg);
    if (results.size === tests.length) {
      clearTimeout(timeout);
      let ok = true;
      for (const t of tests) {
        const r = results.get(t.id);
        if (!r) {
          console.error('FAIL: no result for ' + t.label);
          ok = false;
        } else {
          const value = r.error !== undefined ? r.error.name + ': ' + r.error.message : r.value;
          if (!t.expect(value)) {
            console.error('FAIL ' + t.label + ': got ' + JSON.stringify(value));
            ok = false;
          }
        }
      }
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      process.exit(ok ? 0 : 1);
    }
  }
};

worker.onerror = (err) => {
  console.error('Worker error:', err.message || err);
  process.exit(1);
};

worker.postMessage({ type: 'init', outputMode: 'return' });
for (const t of tests) {
  worker.postMessage({ type: 'execute', id: t.id, code: t.code });
}
`;

    const result = runHarness(
      'bun',
      ['run'],
      harness,
      'bun-harness.js',
      tmpDir
    );
    expect(
      result.exitCode,
      `Bun harness failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    ).toBe(0);
  });
});
