#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const axirDir = path.join(repoRoot, 'tools', 'axir');
const rootAxir = path.join(repoRoot, 'ir', 'axcore', 'root.axir');
const packagesRoot = path.join(repoRoot, 'packages');
const targets = ['python', 'java', 'cpp', 'go'];
const cacheRoot = process.env.GOCACHE || path.join(tmpdir(), 'go-build');
const env = { ...process.env, GOCACHE: cacheRoot };
const maxDiffs = 80;

await mkdir(cacheRoot, { recursive: true });
const stageRoot = await mkdtemp(path.join(tmpdir(), 'axir-packages-check-'));

try {
  for (const target of targets) {
    const outDir = path.join(stageRoot, target);
    run(
      'go',
      ['run', '.', 'compile', '--target', target, '--out', outDir, rootAxir],
      {
        cwd: axirDir,
        env,
      }
    );
  }

  const diffs = [];
  for (const target of targets) {
    const expectedRoot = path.join(stageRoot, target);
    const actualRoot = path.join(packagesRoot, target);
    if (!existsSync(actualRoot)) {
      diffs.push(`missing packages/${target}`);
      continue;
    }
    await compareDirectories(expectedRoot, actualRoot, target, diffs);
  }

  if (diffs.length > 0) {
    console.error('AxIR committed packages are stale.');
    console.error(
      'Run `npm run axir:generate-packages` and commit the result.'
    );
    console.error('');
    for (const diff of diffs.slice(0, maxDiffs)) {
      console.error(`- ${diff}`);
    }
    if (diffs.length > maxDiffs) {
      console.error(`- ...and ${diffs.length - maxDiffs} more differences`);
    }
    process.exit(1);
  }

  console.log('AxIR committed packages are up to date.');
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}

async function compareDirectories(expectedRoot, actualRoot, target, diffs) {
  const expectedFiles = await listFiles(expectedRoot);
  const actualFiles = await listFiles(actualRoot);
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);

  for (const file of expectedFiles) {
    const displayPath = `packages/${target}/${file}`;
    if (!actualSet.has(file)) {
      diffs.push(`missing ${displayPath}`);
      continue;
    }
    const expected = await readFile(path.join(expectedRoot, file));
    const actual = await readFile(path.join(actualRoot, file));
    if (!expected.equals(actual)) {
      diffs.push(`changed ${displayPath}`);
    }
  }

  for (const file of actualFiles) {
    if (!expectedSet.has(file)) {
      diffs.push(`extra packages/${target}/${file}`);
    }
  }
}

async function listFiles(root) {
  const files = [];
  await visit(root, '');
  return files.sort();

  async function visit(absDir, relDir) {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs, rel);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }
}

function shouldIgnore(name) {
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
