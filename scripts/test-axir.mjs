#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const axirDir = path.join(repoRoot, 'tools', 'axir');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');
const runAxirScript = path.join(scriptDir, 'run-axir.mjs');
const cacheRoot = process.env.GOCACHE || path.join(tmpdir(), 'go-build');
const modCacheRoot =
  process.env.GOMODCACHE ||
  (process.env.CI ? path.join(tmpdir(), 'go-mod') : '');
const cargoTargetDir =
  process.env.CARGO_TARGET_DIR || path.join(tmpdir(), 'axir-cargo-target');
const verifyDir =
  process.env.AXIR_VERIFY_WORKDIR || path.join(tmpdir(), 'axir-verify-ci');
const env = {
  ...process.env,
  GOCACHE: cacheRoot,
  CARGO_TARGET_DIR: cargoTargetDir,
};
if (modCacheRoot) env.GOMODCACHE = modCacheRoot;
const timings = [];

mkdirSync(cacheRoot, { recursive: true });
if (modCacheRoot) mkdirSync(modCacheRoot, { recursive: true });
mkdirSync(cargoTargetDir, { recursive: true });
mkdirSync(verifyDir, { recursive: true });

class CommandFailure extends Error {
  constructor(status) {
    super(`command failed with status ${status}`);
    this.status = status;
  }
}

try {
  phase('go test', () =>
    run('go', ['test', '-count=1', '-timeout=30m', './...'], {
      cwd: axirDir,
      env,
    })
  );
  phase('check', () => runAxir(['check', '--strict-types', rootAxir], { env }));
  phase('lint', () => runAxir(['lint', rootAxir], { env }));
  phase('audit provenance', () =>
    runAxir(['audit', 'provenance', rootAxir], { env })
  );
  phase('lower', runLower);
  phase('verify release', () =>
    runAxir(
      [
        'verify',
        '--mode',
        'release',
        '--jobs',
        '0',
        '--progress',
        '--targets',
        'python,java,cpp,go,rust',
        '--workdir',
        verifyDir,
        rootAxir,
      ],
      { env }
    )
  );
} catch (error) {
  writeTimingReport();
  if (error instanceof CommandFailure) process.exit(error.status);
  throw error;
}
writeTimingReport();

function runLower() {
  const result = spawnSync(
    process.execPath,
    [runAxirScript, 'lower', '--to', 'core', rootAxir],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['inherit', 'pipe', 'inherit'],
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CommandFailure(result.status ?? 1);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean).length;
  console.log(`AxIR lower ok (${lines} lines)`);
}

function runAxir(args, options) {
  run(process.execPath, [runAxirScript, ...args], {
    cwd: repoRoot,
    ...options,
  });
}

function phase(name, fn) {
  const start = Date.now();
  console.log(`[axir:test] start ${name}`);
  try {
    const result = fn();
    const durationMs = Date.now() - start;
    timings.push({ name, status: 'ok', durationMs });
    console.log(`[axir:test] ok ${name} (${formatDuration(durationMs)})`);
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    timings.push({ name, status: 'fail', durationMs });
    console.error(`[axir:test] fail ${name} (${formatDuration(durationMs)})`);
    throw error;
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new CommandFailure(result.status ?? 1);
}

function writeTimingReport() {
  const reportPath = process.env.AXIR_TIMING_REPORT;
  if (!reportPath) return;
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        verifyDir,
        cacheRoot,
        modCacheRoot: modCacheRoot || null,
        cargoTargetDir,
        timings,
      },
      null,
      2
    )}\n`
  );
}

function formatDuration(durationMs) {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}
