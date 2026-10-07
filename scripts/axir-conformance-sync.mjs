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

// Keys whose nested object key order is semantically meaningful and must be
// preserved through canonicalization (e.g. ACE playbook `sections` drive the
// order of rendered instruction blocks). Everything else is sorted so fixtures
// stay stable regardless of producer key order.
const STABLE_ORDER_PRESERVING_KEYS = new Set(['sections']);

// Keys whose whole subtree keeps its key order: validator cases compare
// schemas and arguments as written, and string-format cases write objects as
// JSON in their key order.
const ORDER_PRESERVING_SUBTREES = new Set([
  // Decisions question order and description instruction order follow the input schema.
  'request',
  'validation_cases',
  'format_cases',
  'str_cases',
]);

function stable(
  value,
  parentKey = '',
  preserveOrder = false,
  inSignature = false
) {
  const keepOrder = preserveOrder || ORDER_PRESERVING_SUBTREES.has(parentKey);
  const signature = inSignature || parentKey === 'signature_spec';
  const fieldOrder =
    signature && ['inputs', 'outputs', 'fields'].includes(parentKey);
  if (Array.isArray(value))
    return value.map((item) => stable(item, parentKey, keepOrder, signature));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(
      ([, item]) => item !== undefined
    );
    const ordered =
      keepOrder || fieldOrder || STABLE_ORDER_PRESERVING_KEYS.has(parentKey)
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [
        key,
        stable(item, key, keepOrder, signature),
      ])
    );
  }
  return value;
}

export function normalizeCatalog(catalog) {
  return stable(JSON.parse(JSON.stringify(catalog)));
}

export async function buildTypeScriptCatalog() {
  const { getPortableAIModels: axGetSupportedAIModels } = await import(
    '../tools/axir/extractors/portable-ai-catalog.ts'
  );
  return normalizeCatalog({
    all: axGetSupportedAIModels(),
    text: axGetSupportedAIModels({ type: 'text' }),
    embeddings: axGetSupportedAIModels({ type: 'embeddings' }),
    code: axGetSupportedAIModels({ type: 'code' }),
    audio: axGetSupportedAIModels({ type: 'audio' }),
    image: axGetSupportedAIModels({ type: 'image' }),
  });
}

const providerDataFiles = {
  catalog: 'provider-model-catalog.json',
  modelIndex: 'provider-model-index.json',
  registry: 'provider-profile-registry.json',
  summary: 'provider-model-catalog-summary.json',
};

const samplingSupportFlags = [
  'samplingWithoutReasoning',
  'reasoningOffByDefault',
  'temperatureOne',
];

// The per-provider model names, aliases, isExpensive flags, notSupported
// sampling parameters and the supported flags that qualify them
// (samplingWithoutReasoning, reasoningOffByDefault, temperatureOne) from the
// catalog, in catalog order. The chat path reads this small index on every request (the
// expensive-model gate and the sampling filter), so it doesn't parse the full
// catalog.
export function buildProviderModelIndex(catalog) {
  const index = {};
  for (const provider of catalog.all ?? []) {
    index[provider.name] = (provider.models ?? []).map((model) => {
      const notSupported = Object.fromEntries(
        Object.entries(model.notSupported ?? {}).filter(([, value]) => value)
      );
      const supported = Object.fromEntries(
        samplingSupportFlags
          .filter((flag) => model.supported?.[flag] === true)
          .map((flag) => [flag, true])
      );
      return {
        name: model.name,
        ...(model.aliases?.length ? { aliases: model.aliases } : {}),
        ...(model.isExpensive ? { isExpensive: true } : {}),
        ...(Object.keys(notSupported).length > 0 ? { notSupported } : {}),
        ...(Object.keys(supported).length > 0 ? { supported } : {}),
      };
    });
  }
  return normalizeCatalog(index);
}

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

// The date data files tools/axir/extractors/date-goldens.ts writes. The
// abbreviation tables are copied from TypeScript source and always compared.
// The zone-name table is a snapshot of what V8/ICU accepts on the Node that
// wrote it (with that machine's tz database names as candidates), so it is
// compared, and rewritten, only on a Node and machine that match the source
// it records; anywhere else the check says it skipped.
const dateDataFiles = ['date-zone-abbreviations.json', 'date-time-zones.json'];
const zoneTableFile = 'date-time-zones.json';

export function sameZoneTableSource(left, right) {
  const a = left?.source ?? {};
  const b = right?.source ?? {};
  return (
    a.icu === b.icu &&
    a.tz === b.tz &&
    a.tzdata_candidates === b.tzdata_candidates
  );
}

function readJsonIfExists(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

export function compareDateData(repoRoot, generatedRoot, write) {
  const failures = [];
  for (const name of dateDataFiles) {
    const generatedPath = path.join(
      generatedRoot,
      'ir',
      'axcore',
      'data',
      name
    );
    const repoPath = path.join(repoRoot, 'ir', 'axcore', 'data', name);
    const generated = readJsonIfExists(generatedPath);
    if (generated === undefined) {
      failures.push(`date-goldens did not write ir/axcore/data/${name}`);
      continue;
    }
    const current = readJsonIfExists(repoPath);
    if (
      name === zoneTableFile &&
      current !== undefined &&
      !sameZoneTableSource(current, generated)
    ) {
      const source = (table) =>
        `ICU ${table.source?.icu} tz ${table.source?.tz} tzdata ${table.source?.tzdata_candidates}`;
      console.log(
        `skipped ir/axcore/data/${name}: it was written on ${source(current)}, this run has ${source(generated)}`
      );
      continue;
    }
    const same =
      current !== undefined &&
      JSON.stringify(current) === JSON.stringify(generated);
    if (same) continue;
    if (write) {
      writeFileSync(repoPath, readFileSync(generatedPath, 'utf8'));
    } else {
      failures.push(`stale data ir/axcore/data/${name}`);
    }
  }
  return failures;
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

function runConformanceExtractor(
  repoRoot,
  outRoot,
  extractorName,
  label,
  extraEnv = {}
) {
  const extractor = path.join(
    repoRoot,
    'tools',
    'axir',
    'extractors',
    extractorName
  );
  const result = spawnSync(process.execPath, ['--import=tsx', extractor], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AXIR_CONFORMANCE_OUT_ROOT: outRoot,
      ...extraEnv,
    },
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

export function compareGeneratedFixtures(
  repoRoot,
  generatedRoot,
  suite,
  write
) {
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
  const tsModelIndex = buildProviderModelIndex(tsCatalog);
  if (write) {
    writeProviderDataJson(repoRoot, 'summary', tsCatalogSummary);
    writeProviderDataJson(repoRoot, 'catalog', tsCatalog);
    writeProviderDataJson(repoRoot, 'modelIndex', tsModelIndex);
    const axirProfileRegistry = readProviderDataJson(repoRoot, 'registry');
    return compareValues(
      axirProfileRegistry,
      tsProfileRegistry,
      'provider_profile_registry'
    ).map(
      (diff) =>
        `AxIR provider profile registry drift: ${diff}; run npm run profiles:generate first`
    );
  }
  const axirCatalog = readProviderDataJson(repoRoot, 'catalog');
  const axirModelIndex = readProviderDataJson(repoRoot, 'modelIndex');
  const axirProfileRegistry = readProviderDataJson(repoRoot, 'registry');
  const axirCatalogSummary = readProviderDataJson(repoRoot, 'summary');
  return [
    ...compareValues(
      axirCatalog,
      tsCatalog,
      'provider_model_catalog_registry'
    ).map((diff) => `AxIR provider catalog drift: ${diff}`),
    ...compareValues(axirModelIndex, tsModelIndex, 'provider_model_index').map(
      (diff) => `AxIR provider model index drift: ${diff}`
    ),
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
      'decisions-goldens.ts',
      'OpenAI Decisions'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'signature-goldens.ts',
      'AxSignature'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'prompt-goldens.ts',
      'AxPrompt'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'schema-validation-goldens.ts',
      'AxSchema'
    );
    runConformanceExtractor(repoRoot, tempRoot, 'axgen-goldens.ts', 'AxGen');
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'axgen-streaming-goldens.ts',
      'AxGen streaming'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'axgen-audio-goldens.ts',
      'AxGen audio'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'date-goldens.ts',
      'AxGen dates'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'axgen-cache-goldens.ts',
      'AxGen cache'
    );
    runConformanceExtractor(repoRoot, tempRoot, 'flow-goldens.ts', 'AxFlow');
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'flow-cache-goldens.ts',
      'AxFlow cache'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'mcp-authorization-goldens.ts',
      'AxMCP'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'mcp-inheritance-goldens.ts',
      'AxMCP'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'mcp-task-handling-goldens.ts',
      'AxMCP'
    );
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'optimize-goldens.ts',
      'AxOptimize'
    );
    runConformanceExtractor(repoRoot, tempRoot, 'agent-goldens.ts', 'AxAgent', {
      AXIR_AGENT_PARITY_ONLY: '1',
    });
    runConformanceExtractor(
      repoRoot,
      tempRoot,
      'agent-streaming-goldens.ts',
      'AxAgent streaming'
    );
    const failures = [
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axai', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'signature', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'prompt', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'schema', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'validation', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axgen', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axflow', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axprogram', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axmcp', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axoptimize', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axagent', write),
      ...compareGeneratedFixtures(repoRoot, tempRoot, 'axagent-real', write),
      ...compareDateData(repoRoot, tempRoot, write),
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
