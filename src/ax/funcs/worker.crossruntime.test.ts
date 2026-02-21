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
