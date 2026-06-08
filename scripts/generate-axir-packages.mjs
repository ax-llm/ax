#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');
const runAxirScript = path.join(scriptDir, 'run-axir.mjs');
const packagesRoot = path.join(repoRoot, 'packages');
const targets = ['python', 'java', 'cpp', 'go', 'rust'];
const cacheRoot = process.env.GOCACHE || path.join(tmpdir(), 'go-build');
const modCacheRoot =
  process.env.GOMODCACHE ||
  (process.env.CI ? path.join(tmpdir(), 'go-mod') : '');
const env = { ...process.env, GOCACHE: cacheRoot };
if (modCacheRoot) env.GOMODCACHE = modCacheRoot;

await mkdir(cacheRoot, { recursive: true });
if (modCacheRoot) await mkdir(modCacheRoot, { recursive: true });
const stageRoot = await mkdtemp(path.join(tmpdir(), 'axir-packages-'));

try {
  for (const target of targets) {
    const outDir = path.join(stageRoot, target);
    run(
      process.execPath,
      [runAxirScript, 'compile', '--target', target, '--out', outDir, rootAxir],
      {
        cwd: repoRoot,
        env,
      }
    );
  }

  await mkdir(packagesRoot, { recursive: true });
  for (const target of targets) {
    const dest = path.join(packagesRoot, target);
    await rm(dest, { recursive: true, force: true });
    await cp(path.join(stageRoot, target), dest, {
      recursive: true,
      filter: shouldCopyGeneratedFile,
    });
    console.log(`generated packages/${target}`);
  }
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}

function shouldCopyGeneratedFile(src) {
  const base = path.basename(src);
  return !isGeneratedCachePath(base);
}

function isGeneratedCachePath(name) {
  if (
    [
      '__pycache__',
      '.DS_Store',
      '.gradle',
      '.pytest_cache',
      'CMakeCache.txt',
      'CMakeFiles',
      'cmake_install.cmake',
      'cpp-cmake-build',
      'cpp-install',
      'cpp-run',
      'cpp-run-build',
      'go-build',
      'go-run',
      'java-classes',
      'node_modules',
      'target',
    ].includes(name)
  ) {
    return true;
  }
  return /\.(a|class|dylib|exe|o|pyc|so)$/.test(name);
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
