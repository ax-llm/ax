#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const axirDir = path.join(repoRoot, 'tools', 'axir');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');
const binCacheRoot =
  process.env.AXIR_BIN_CACHE || path.join(tmpdir(), 'axir-bin-cache');
const goCacheRoot = process.env.GOCACHE || path.join(tmpdir(), 'go-build');
const env = { ...process.env, GOCACHE: goCacheRoot };

mkdirSync(binCacheRoot, { recursive: true });
mkdirSync(goCacheRoot, { recursive: true });

const args = withDefaultVerifyRoot(process.argv.slice(2));
const bin = ensureAxirBinary();
const result = spawnSync(bin, args, {
  cwd: repoRoot,
  env,
  shell: false,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

function ensureAxirBinary() {
  const hash = hashAxirSources();
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const bin = path.join(
    binCacheRoot,
    `axir-${process.platform}-${process.arch}-${hash}${suffix}`
  );
  if (existsSync(bin)) {
    console.error(`[axir] using cached binary ${bin}`);
    return bin;
  }

  console.error(`[axir] building cached binary ${bin}`);
  const tmpBin = `${bin}.${process.pid}.tmp`;
  rmSync(tmpBin, { force: true });
  const result = spawnSync('go', ['build', '-o', tmpBin, '.'], {
    cwd: axirDir,
    env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  renameSync(tmpBin, bin);
  return bin;
}

function hashAxirSources() {
  const hash = createHash('sha256');
  for (const file of axirSourceFiles()) {
    const rel = path.relative(axirDir, file);
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function axirSourceFiles() {
  const files = [];
  visit(axirDir);
  return files.sort();

  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'vendor') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile() && isGoBuildInput(abs)) {
        files.push(abs);
      }
    }
  }
}

function isGoBuildInput(file) {
  const base = path.basename(file);
  return base === 'go.mod' || base === 'go.sum' || file.endsWith('.go');
}

function withDefaultVerifyRoot(args) {
  if (args[0] !== 'verify') return args;
  if (args.includes('-h') || args.includes('--help')) return args;
  if (hasVerifyRoot(args.slice(1))) return args;
  return [...args, rootAxir];
}

function hasVerifyRoot(args) {
  const valueFlags = new Set([
    '--jobs',
    '--mode',
    '--runtime-profiles',
    '--targets',
    '--workdir',
  ]);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return i + 1 < args.length;
    if (arg.startsWith('--')) {
      if (arg.includes('=')) continue;
      if (valueFlags.has(arg)) i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    return true;
  }
  return false;
}
