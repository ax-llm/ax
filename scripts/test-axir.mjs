#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const axirDir = path.join(repoRoot, 'tools', 'axir');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');
const runAxirScript = path.join(scriptDir, 'run-axir.mjs');
const cacheRoot = process.env.GOCACHE || path.join(tmpdir(), 'go-build');
const verifyDir = mkdtempSync(path.join(tmpdir(), 'axir-verify-ci-'));
const env = { ...process.env, GOCACHE: cacheRoot };

mkdirSync(cacheRoot, { recursive: true });

run('go', ['test', '-count=1', '-timeout=30m', './...'], { cwd: axirDir, env });
runAxir(['check', rootAxir], { env });
runLower();
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
);

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
  if (result.status !== 0) process.exit(result.status ?? 1);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean).length;
  console.log(`AxIR lower ok (${lines} lines)`);
}

function runAxir(args, options) {
  run(process.execPath, [runAxirScript, ...args], {
    cwd: repoRoot,
    ...options,
  });
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
