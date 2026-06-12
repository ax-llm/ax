#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..');

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Usage:
  npm run axir:conformance:check
  npm run axir:conformance:write

The check command runs TS-derived extractors in a temp directory and compares
their output to checked-in AxIR fixtures without editing tracked files.`);
  process.exit(code);
}

function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      positional.push(item);
      continue;
    }
    const raw = item.slice(2);
    const eq = raw.indexOf('=');
    let key;
    let value;
    if (eq >= 0) {
      key = raw.slice(0, eq);
      value = raw.slice(eq + 1);
    } else {
      key = raw;
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        index++;
      } else {
        value = true;
      }
    }
    flags[key] = value;
  }
  return { positional, flags };
}

function flagValue(flags, key, fallback = undefined) {
  return flags[key] === undefined ? fallback : flags[key];
}

function stable(value) {
  if (Array.isArray(value)) return value.map((item) => stable(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

export function normalizeCatalog(catalog) {
  return stable(JSON.parse(JSON.stringify(catalog)));
}

export async function buildTypeScriptCatalog() {
  const catalogModule = await import('../src/ax/ai/catalog.ts');
  const { axGetSupportedAIModels } = catalogModule;
  return normalizeCatalog({
    all: axGetSupportedAIModels(),
    text: axGetSupportedAIModels({ type: 'text' }),
    embeddings: axGetSupportedAIModels({ type: 'embeddings' }),
    code: axGetSupportedAIModels({ type: 'code' }),
    audio: axGetSupportedAIModels({ type: 'audio' }),
  });
}

const providerDataFiles = {
  catalog: 'provider-model-catalog.json',
  registry: 'provider-profile-registry.json',
  summary: 'provider-model-catalog-summary.json',
};

export function providerDataPath(repoRoot, kind) {
  const file = providerDataFiles[kind];
  if (!file) {
    throw new Error(`unknown provider data kind ${kind}`);
  }
  return path.join(repoRoot, 'ir', 'axcore', 'data', file);
}

export function readProviderDataJson(repoRoot, kind) {
  return normalizeCatalog(
    JSON.parse(readFileSync(providerDataPath(repoRoot, kind), 'utf8'))
  );
}

export function writeProviderDataJson(repoRoot, kind, value) {
  writeFileSync(
    providerDataPath(repoRoot, kind),
    JSON.stringify(normalizeCatalog(value))
  );
}

export function compareValues(actual, expected, label = '$') {
  const diffs = [];
  compareAt(actual, expected, label, diffs);
  return diffs;
}

function compareAt(actual, expected, label, diffs) {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      diffs.push(
        `${label}: expected ${typeOf(expected)}, got ${typeOf(actual)}`
      );
      return;
    }
    if (actual.length !== expected.length) {
      diffs.push(
        `${label}: expected ${expected.length} items, got ${actual.length}`
      );
      return;
    }
    for (let index = 0; index < expected.length; index++) {
      compareAt(actual[index], expected[index], `${label}[${index}]`, diffs);
      if (diffs.length >= 20) return;
    }
    return;
  }
  if (isObject(actual) || isObject(expected)) {
    if (!isObject(actual) || !isObject(expected)) {
      diffs.push(
        `${label}: expected ${typeOf(expected)}, got ${typeOf(actual)}`
      );
      return;
    }
    const keys = [
      ...new Set([...Object.keys(actual), ...Object.keys(expected)]),
    ].sort();
    for (const key of keys) {
      if (!(key in actual)) {
        diffs.push(`${label}.${key}: missing from actual`);
      } else if (!(key in expected)) {
        diffs.push(`${label}.${key}: unexpected in actual`);
      } else {
        compareAt(actual[key], expected[key], `${label}.${key}`, diffs);
      }
      if (diffs.length >= 20) return;
    }
    return;
  }
  if (actual !== expected) {
    diffs.push(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function normalizeJsonText(text) {
  return `${JSON.stringify(stable(JSON.parse(text)), null, 2)}\n`;
}

function runConformanceExtractor(repoRoot, outRoot, extractorName, label) {
  const extractor = path.join(
    repoRoot,
    'tools',
    'axir',
    'extractors',
    extractorName
  );
  const result = spawnSync(process.execPath, ['--import=tsx', extractor], {
    cwd: repoRoot,
    env: { ...process.env, AXIR_CONFORMANCE_OUT_ROOT: outRoot },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${label} extractor failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    );
  }
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function compareGeneratedFixtures(repoRoot, generatedRoot, suite, write) {
  const generatedDir = path.join(generatedRoot, 'ir', 'conformance', suite);
  const repoDir = path.join(repoRoot, 'ir', 'conformance', suite);
  const failures = [];

  for (const name of listJsonFiles(generatedDir)) {
    const generatedPath = path.join(generatedDir, name);
    const repoPath = path.join(repoDir, name);
    const generated = normalizeJsonText(readFileSync(generatedPath, 'utf8'));
    if (write) {
      const current = existsSync(repoPath)
        ? normalizeJsonText(readFileSync(repoPath, 'utf8'))
        : null;
      if (current !== generated) writeFileSync(repoPath, generated);
      continue;
    }
    if (!existsSync(repoPath)) {
      failures.push(
        `missing checked-in fixture ir/conformance/${suite}/${name}`
      );
      continue;
    }
    const current = normalizeJsonText(readFileSync(repoPath, 'utf8'));
    if (current !== generated) {
      failures.push(`stale fixture ir/conformance/${suite}/${name}`);
    }
  }

  return failures;
}

function readGeneratedFixtureExpected(generatedRoot, fixtureName) {
  const fixturePath = path.join(
    generatedRoot,
    'ir',
    'conformance',
    'axai',
    `${fixtureName}.json`
  );
  return normalizeCatalog(
    JSON.parse(readFileSync(fixturePath, 'utf8')).expected_output
  );
}

async function checkProviderCatalog(repoRoot, generatedRoot, write) {
  const tsCatalog = await buildTypeScriptCatalog();
  const tsProfileRegistry = readGeneratedFixtureExpected(
    generatedRoot,
    'provider-profile-registry'
  );
  const tsCatalogSummary = readGeneratedFixtureExpected(
    generatedRoot,
    'model-catalog-audit'
  );
  if (write) {
    writeProviderDataJson(repoRoot, 'registry', tsProfileRegistry);
    writeProviderDataJson(repoRoot, 'summary', tsCatalogSummary);
    writeProviderDataJson(repoRoot, 'catalog', tsCatalog);
    return [];
  }
  const axirCatalog = readProviderDataJson(repoRoot, 'catalog');
  const axirProfileRegistry = readProviderDataJson(repoRoot, 'registry');
  const axirCatalogSummary = readProviderDataJson(repoRoot, 'summary');
  return [
    ...compareValues(
      axirCatalog,
      tsCatalog,
      'provider_model_catalog_registry'
    ).map((diff) => `AxIR provider catalog drift: ${diff}`),
    ...compareValues(
      axirProfileRegistry,
      tsProfileRegistry,
      'provider_profile_registry'
    ).map((diff) => `AxIR provider profile registry drift: ${diff}`),
    ...compareValues(
      axirCatalogSummary,
      tsCatalogSummary,
      'provider_model_catalog_summary'
    ).map((diff) => `AxIR provider catalog summary drift: ${diff}`),
  ];
}

async function runSync({ repoRoot, write }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'axir-conformance-'));
  try {
    runConformanceExtractor(repoRoot, tempRoot, 'axai-goldens.ts', 'AxAI');
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'optimize-goldens.ts',
      'AxOptimize'
    );
    const failures = [
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axai', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axoptimize', write),
      ...(await checkProviderCatalog(repoRoot, tempRoot, write)),
    ];
    if (failures.length > 0) {
      throw new Error(
        `AxIR conformance sync failed:\n${failures
          .slice(0, 30)
          .map((item) => `- ${item}`)
          .join(
            '\n'
          )}\n\nRun:\n  npm run axir:conformance:write\n  npm run test:axir`
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseCliArgs(argv);
  const command = positional[0] ?? 'check';
  const repoRoot = path.resolve(
    String(flagValue(flags, 'root', defaultRepoRoot))
  );
  if (flags.help || command === 'help') usage(0);
  if (command !== 'check' && command !== 'write') {
    throw new Error(`unknown command ${command}`);
  }
  await runSync({ repoRoot, write: command === 'write' });
  console.log(
    command === 'write'
      ? 'AxIR conformance fixtures and provider catalog refreshed.'
      : 'AxIR conformance fixtures and provider catalog are in sync.'
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
