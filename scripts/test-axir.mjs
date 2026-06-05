#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const axirDir = path.join(repoRoot, 'tools', 'axir');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');
const cacheRoot = process.env.GOCACHE || path.join(tmpdir(), 'go-build');
const verifyDir = path.join(tmpdir(), 'axir-verify-ci');
const env = { ...process.env, GOCACHE: cacheRoot };

mkdirSync(cacheRoot, { recursive: true });

run('go', ['test', '-count=1', './...'], { cwd: axirDir, env });
run('go', ['run', '.', 'check', rootAxir], { cwd: axirDir, env });
runLower();
run(
  'go',
  [
    'run',
    '.',
    'verify',
    '--targets',
    'python,java,cpp,go',
    '--workdir',
    verifyDir,
    rootAxir,
  ],
  { cwd: axirDir, env }
);

function runLower() {
  const result = spawnSync(
    'go',
    ['run', '.', 'lower', '--to', 'core', rootAxir],
    {
      cwd: axirDir,
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

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
