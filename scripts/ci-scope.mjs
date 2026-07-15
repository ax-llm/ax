#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAxirSemanticPath } from './axir-backlog.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..');
const gitMaxBuffer = 512 * 1024 * 1024;
const fullScopeSentinel = '.github/workflows/ci.yml';

const generatedLanguageRoots = [
  'packages/python/',
  'packages/java/',
  'packages/cpp/',
  'packages/go/',
  'packages/rust/',
  'src/examples/python/',
  'src/examples/java/',
  'src/examples/cpp/',
  'src/examples/go/',
  'src/examples/rust/',
];

const axirMatrixFiles = new Set([
  // Not currently tracked, but adding it can change every npm ci result.
  '.npmrc',
  '.github/workflows/ci.yml',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'scripts/ci-scope.mjs',
  'scripts/check-axir-packages.mjs',
  'scripts/example-catalog.mjs',
  'scripts/generate-axir-packages.mjs',
  'scripts/run-axir.mjs',
  'scripts/run-example.mjs',
  'scripts/test-generated-examples.mjs',
  'scripts/axir-perturb-check.mjs',
  'scripts/axir-response-perturb-check.mjs',
]);

const documentationOnlyRoots = [
  'docs/',
  'website/',
  'ir/spec/',
  'src/ax/skills/',
  'tools/axir/skills/',
  'tools/website-md/skills/',
];

const documentationOnlyFiles = new Set([
  'LICENSE',
  'README.md',
  'scripts/README.md',
  'src/aisdk/README.md',
  'src/aws-bedrock/README.md',
  'src/ax/README.md',
  'src/examples/README.md',
  'src/tools/README.md',
  'typedoc.json',
  'src/ax/typedoc.json',
  'ir/axir-backlog.json',
  'ir/behavioral-parity-ledger.json',
  'scripts/check-website-links.mjs',
  'scripts/website-hugo-build.mjs',
  'scripts/website-prepare.mjs',
]);

function normalizePath(filePath) {
  return String(filePath).replaceAll('\\', '/').replace(/^\.\//, '');
}

function isDocumentationOnlyPath(filePath) {
  const normalized = normalizePath(filePath);
  if (documentationOnlyFiles.has(normalized)) return true;
  if (documentationOnlyRoots.some((root) => normalized.startsWith(root))) {
    return true;
  }
  if (normalized.startsWith('.github/') && normalized.endsWith('.md')) {
    return true;
  }
  if (
    path.posix.dirname(normalized) === 'ir/axcore' &&
    normalized.endsWith('.md')
  ) {
    return true;
  }
  const basename = path.posix.basename(normalized);
  if (normalized.startsWith('ir/conformance/') && basename === 'README.md') {
    return true;
  }
  return (
    generatedLanguageRoots.some((root) => normalized.startsWith(root)) &&
    (basename === 'README.md' ||
      basename === 'SKILL.md' ||
      basename === 'API.md')
  );
}

export function isAxirMatrixPath(filePath) {
  const normalized = normalizePath(filePath);
  if (generatedLanguageRoots.some((root) => normalized.startsWith(root))) {
    return true;
  }
  if (isDocumentationOnlyPath(normalized)) return false;
  if (isAxirSemanticPath(normalized)) return true;
  return axirMatrixFiles.has(normalized);
}

export function axirMatrixPaths(changedFiles) {
  return changedFiles.map(normalizePath).filter(isAxirMatrixPath);
}

export function isCoreTestPath(filePath) {
  const normalized = normalizePath(filePath);
  return !isDocumentationOnlyPath(normalized);
}

export function coreTestPaths(changedFiles) {
  return changedFiles.map(normalizePath).filter(isCoreTestPath);
}

function isValidCommit(root, ref) {
  if (!ref || /^0+$/.test(ref)) return false;
  try {
    execFileSync(
      'git',
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      {
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    );
    return true;
  } catch {
    return false;
  }
}

function resolveDiffBase(root, base) {
  if (isValidCommit(root, base)) return base;
  console.warn(
    `Warning: diff base ${base || '(empty)'} is not reachable; running full CI scope.`
  );
  return null;
}

export function changedFilesFromGit(
  base,
  head = 'HEAD',
  root = defaultRepoRoot
) {
  const resolvedBase = resolveDiffBase(root, base);
  if (!resolvedBase) return [fullScopeSentinel];
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${resolvedBase}...${head}`],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: gitMaxBuffer,
    }
  );
  return output.split('\0').map(normalizePath).filter(Boolean);
}

function option(argv, name, fallback = undefined) {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

function main(argv = process.argv.slice(2)) {
  const root = path.resolve(option(argv, 'root', defaultRepoRoot));
  const base = option(argv, 'base');
  const head = option(argv, 'head', 'HEAD');
  const githubOutput = option(argv, 'github-output');
  const changedFiles = changedFilesFromGit(base, head, root);
  const axirPaths = axirMatrixPaths(changedFiles);
  const corePaths = coreTestPaths(changedFiles);
  const runAxir = axirPaths.length > 0;
  const runCore = corePaths.length > 0;

  console.log(
    runAxir
      ? `AxIR/language matrix required by:\n${axirPaths.map((file) => `- ${file}`).join('\n')}`
      : 'AxIR/language matrix skipped: no implementation inputs changed.'
  );
  console.log(
    runCore
      ? `Core build and tests required by:\n${corePaths.map((file) => `- ${file}`).join('\n')}`
      : 'Core build and tests skipped: documentation/website-only change.'
  );

  if (githubOutput) {
    appendFileSync(githubOutput, `run_axir=${runAxir}\n`);
    appendFileSync(githubOutput, `run_core=${runCore}\n`);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
