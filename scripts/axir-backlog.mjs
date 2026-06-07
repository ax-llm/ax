#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKLOG_SCHEMA_VERSION = 1;
export const PORTABLE_SURFACES = new Set([
  'signature',
  'schema',
  'prompt',
  'axgen',
  'axai',
  'axagent',
  'axflow',
  'axmcp',
  'axoptimize',
  'axprogram',
  'runtime',
  'unknown',
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..');
const noImpactMarker = 'axir-no-impact';

const portableRoots = [
  ['src/ax/ai/', 'axai'],
  ['src/ax/dsp/', 'axgen'],
  ['src/ax/agent/', 'axagent'],
  ['src/ax/flow/', 'axflow'],
  ['src/ax/mcp/', 'axmcp'],
];

const axirSemanticRoots = ['ir/axcore/', 'ir/conformance/', 'tools/axir/'];

const axirSemanticFiles = new Set([
  'scripts/axir-conformance-sync.mjs',
  'scripts/test-axir.mjs',
]);

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Usage:
  npm run axir:backlog -- add --title "..." --surface axai --impact "..." --paths src/ax/ai/openai/info.ts [--pr 525]
  npm run axir:backlog -- list [--status open|done|all] [--surface axai]
  npm run axir:backlog -- done <id> --commit <sha> --verification "npm run test:axir"
  npm run axir:backlog -- check-pr --base origin/main --head HEAD
  npm run axir:backlog -- render
  npm run axir:backlog -- validate

CI escape hatch for TS-only changes: add the PR label or commit marker '${noImpactMarker}'.`);
  process.exit(code);
}

export function parseCliArgs(argv) {
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

    if (flags[key] === undefined) {
      flags[key] = value;
    } else if (Array.isArray(flags[key])) {
      flags[key].push(value);
    } else {
      flags[key] = [flags[key], value];
    }
  }

  return { positional, flags };
}

function flagValue(flags, key, fallback = undefined) {
  const value = flags[key];
  if (Array.isArray(value)) return value.at(-1);
  return value === undefined ? fallback : value;
}

function flagValues(flags, key) {
  const value = flags[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function splitList(values) {
  return values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function repoPaths(root) {
  return {
    backlog: path.join(root, 'ir', 'axir-backlog.json'),
    docs: path.join(root, 'docs', 'AXIR_BACKLOG.md'),
  };
}

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function emptyLedger() {
  return {
    schemaVersion: BACKLOG_SCHEMA_VERSION,
    entries: [],
  };
}

export function readLedger(root = defaultRepoRoot) {
  const { backlog } = repoPaths(root);
  if (!existsSync(backlog)) return emptyLedger();
  return readJson(backlog);
}

export function writeLedger(root, ledger) {
  validateLedger(ledger);
  writeJson(repoPaths(root).backlog, sortLedger(ledger));
}

function sortLedger(ledger) {
  return {
    schemaVersion: ledger.schemaVersion,
    entries: [...ledger.entries].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function today() {
  return (
    process.env.AXIR_BACKLOG_TODAY ?? new Date().toISOString().slice(0, 10)
  );
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function currentCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function inferSurface(paths) {
  for (const filePath of paths) {
    const normalized = normalizePath(filePath);
    for (const [root, surface] of portableRoots) {
      if (normalized.startsWith(root)) return surface;
    }
  }
  return 'unknown';
}

function parsePaths(flags) {
  return splitList([
    ...flagValues(flags, 'paths'),
    ...flagValues(flags, 'path'),
  ]).map(normalizePath);
}

function parseSuggestedWork(flags) {
  const values = splitList([
    ...flagValues(flags, 'suggested'),
    ...flagValues(flags, 'suggested-axir-work'),
  ]);
  if (values.length > 0) return values;
  return [
    'Add or update the TS-derived conformance fixture.',
    'Update AxIR/Core or descriptor data to match the portable TS behavior.',
    'Run npm run axir:conformance:check and npm run test:axir.',
  ];
}

export function validateEntry(entry) {
  const errors = [];
  const requiredStrings = [
    'id',
    'status',
    'title',
    'createdAt',
    'portableSurface',
    'impact',
  ];
  for (const key of requiredStrings) {
    if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
      errors.push(`entry ${entry.id ?? '<unknown>'} missing string ${key}`);
    }
  }
  if (!['open', 'done'].includes(entry.status)) {
    errors.push(`entry ${entry.id} has invalid status ${entry.status}`);
  }
  if (!PORTABLE_SURFACES.has(entry.portableSurface)) {
    errors.push(
      `entry ${entry.id} has invalid portableSurface ${entry.portableSurface}`
    );
  }
  if (!Array.isArray(entry.tsPaths) || entry.tsPaths.length === 0) {
    errors.push(`entry ${entry.id} must include at least one tsPaths item`);
  } else {
    for (const item of entry.tsPaths) {
      if (typeof item !== 'string' || item.trim() === '') {
        errors.push(`entry ${entry.id} has invalid tsPaths item`);
      }
    }
  }
  if (!Array.isArray(entry.suggestedAxirWork)) {
    errors.push(`entry ${entry.id} suggestedAxirWork must be an array`);
  }
  if (entry.status === 'done') {
    if (!entry.completedAt)
      errors.push(`entry ${entry.id} is done without completedAt`);
    if (!entry.completedByCommit) {
      errors.push(`entry ${entry.id} is done without completedByCommit`);
    }
    if (!entry.verification)
      errors.push(`entry ${entry.id} is done without verification`);
  }
  return errors;
}

export function validateLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== 'object') {
    throw new Error('ledger must be an object');
  }
  if (ledger.schemaVersion !== BACKLOG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${BACKLOG_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(ledger.entries)) {
    errors.push('entries must be an array');
  } else {
    const seen = new Set();
    for (const entry of ledger.entries) {
      if (seen.has(entry.id)) errors.push(`duplicate entry id ${entry.id}`);
      seen.add(entry.id);
      errors.push(...validateEntry(entry));
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid AxIR backlog:\n${errors.map((item) => `- ${item}`).join('\n')}`
    );
  }
  return true;
}

function addEntry(root, flags) {
  const title = flagValue(flags, 'title');
  const impact = flagValue(flags, 'impact');
  const paths = parsePaths(flags);
  if (!title || !impact || paths.length === 0) {
    throw new Error('add requires --title, --impact, and --paths');
  }

  const portableSurface = flagValue(flags, 'surface', inferSurface(paths));
  if (!PORTABLE_SURFACES.has(portableSurface)) {
    throw new Error(`invalid --surface ${portableSurface}`);
  }

  const id = flagValue(flags, 'id', `axir-${today()}-${slugify(title)}`);
  const ledger = readLedger(root);
  if (ledger.entries.some((entry) => entry.id === id)) {
    throw new Error(`AxIR backlog entry already exists: ${id}`);
  }

  const entry = {
    id,
    status: 'open',
    title,
    createdAt: today(),
    sourcePR: parseOptionalNumber(flagValue(flags, 'pr', null)),
    sourceCommit: flagValue(flags, 'commit', currentCommit(root)),
    tsPaths: paths,
    portableSurface,
    impact,
    suggestedAxirWork: parseSuggestedWork(flags),
    completedAt: null,
    completedByCommit: null,
    verification: null,
  };

  ledger.entries.push(entry);
  writeLedger(root, ledger);
  renderDocsToDisk(root);
  console.log(`Added AxIR backlog entry ${id}`);
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected positive integer, got ${value}`);
  }
  return parsed;
}

function doneEntry(root, positional, flags) {
  const id = positional[1];
  const commit = flagValue(flags, 'commit');
  const verification = flagValue(flags, 'verification');
  if (!id || !commit || !verification) {
    throw new Error('done requires <id>, --commit, and --verification');
  }

  const ledger = readLedger(root);
  const entry = ledger.entries.find((item) => item.id === id);
  if (!entry) throw new Error(`AxIR backlog entry not found: ${id}`);
  entry.status = 'done';
  entry.completedAt = today();
  entry.completedByCommit = commit;
  entry.verification = verification;
  writeLedger(root, ledger);
  renderDocsToDisk(root);
  console.log(`Completed AxIR backlog entry ${id}`);
}

function listEntries(root, flags) {
  const status = flagValue(flags, 'status', 'open');
  const surface = flagValue(flags, 'surface', null);
  if (!['open', 'done', 'all'].includes(status)) {
    throw new Error('--status must be open, done, or all');
  }
  const ledger = readLedger(root);
  validateLedger(ledger);
  const entries = ledger.entries.filter((entry) => {
    if (status !== 'all' && entry.status !== status) return false;
    if (surface && entry.portableSurface !== surface) return false;
    return true;
  });
  if (entries.length === 0) {
    console.log('No AxIR backlog entries.');
    return;
  }
  for (const entry of entries) {
    console.log(
      `${entry.status.padEnd(4)} ${entry.id} [${entry.portableSurface}] ${entry.title}`
    );
    console.log(`     paths: ${entry.tsPaths.join(', ')}`);
  }
}

function renderDocsToDisk(root) {
  const markdown = renderMarkdown(readLedger(root));
  const { docs } = repoPaths(root);
  mkdirSync(path.dirname(docs), { recursive: true });
  writeFileSync(docs, markdown);
}

export function renderMarkdown(ledger) {
  validateLedger(ledger);
  const open = ledger.entries.filter((entry) => entry.status === 'open');
  const done = ledger.entries.filter((entry) => entry.status === 'done');
  return [
    '# AxIR Backlog',
    '',
    '<!-- Generated by `npm run axir:backlog:render`; do not edit by hand. -->',
    '',
    'This ledger tracks portable TypeScript behavior that should be migrated into AxIR/Core and generated language backends.',
    '',
    renderSection('Open', open),
    renderSection('Done', done),
  ].join('\n');
}

function renderSection(title, entries) {
  const lines = [`## ${title}`, ''];
  if (entries.length === 0) {
    lines.push('No entries.', '');
    return lines.join('\n');
  }
  for (const entry of entries) {
    lines.push(`- \`${entry.id}\` [${entry.portableSurface}] ${entry.title}`);
    lines.push(`  - Status: ${entry.status}`);
    if (entry.sourcePR) lines.push(`  - Source PR: #${entry.sourcePR}`);
    if (entry.sourceCommit)
      lines.push(`  - Source commit: \`${entry.sourceCommit}\``);
    lines.push(
      `  - TS paths: ${entry.tsPaths.map((item) => `\`${item}\``).join(', ')}`
    );
    lines.push(`  - Impact: ${entry.impact}`);
    if (entry.suggestedAxirWork.length > 0) {
      lines.push(
        `  - Suggested AxIR work: ${entry.suggestedAxirWork.join('; ')}`
      );
    }
    if (entry.status === 'done') {
      lines.push(`  - Completed at: ${entry.completedAt}`);
      lines.push(`  - Completed by: \`${entry.completedByCommit}\``);
      lines.push(`  - Verification: \`${entry.verification}\``);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function validateDocs(root) {
  const { docs } = repoPaths(root);
  const expected = renderMarkdown(readLedger(root));
  if (!existsSync(docs)) {
    throw new Error(
      'docs/AXIR_BACKLOG.md is missing; run npm run axir:backlog:render'
    );
  }
  const actual = readFileSync(docs, 'utf8');
  if (actual !== expected) {
    throw new Error(
      'docs/AXIR_BACKLOG.md is stale; run npm run axir:backlog:render'
    );
  }
}

function changedFilesFromGit(root, base, head) {
  const range = base && head ? [`${base}...${head}`] : [];
  const output = execFileSync('git', ['diff', '--name-only', ...range], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return output.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function commitMessages(root, base, head) {
  if (!base || !head) return '';
  try {
    return execFileSync('git', ['log', '--format=%B', `${base}..${head}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function eventHasNoImpactLabel() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return false;
  try {
    const event = readJson(eventPath);
    const labels = event.pull_request?.labels ?? [];
    return labels.some((label) => label.name === noImpactMarker);
  } catch {
    return false;
  }
}

export function isPortableTsPath(filePath) {
  const normalized = normalizePath(filePath);
  return portableRoots.some(([root]) => normalized.startsWith(root));
}

export function isAxirSemanticPath(filePath) {
  const normalized = normalizePath(filePath);
  if (axirSemanticFiles.has(normalized)) return true;
  return axirSemanticRoots.some((root) => normalized.startsWith(root));
}

function pathCovers(changedPath, backlogPath) {
  const changed = normalizePath(changedPath);
  const candidate = normalizePath(backlogPath).replace(/\/+$/, '');
  return changed === candidate || changed.startsWith(`${candidate}/`);
}

function coveredByBacklog(changedPath, entries) {
  return entries.some(
    (entry) =>
      entry.status === 'open' &&
      entry.tsPaths.some((candidate) => pathCovers(changedPath, candidate))
  );
}

export function evaluatePrCheck({ changedFiles, ledger, noImpact = false }) {
  validateLedger(ledger);
  const changedPortable = changedFiles.filter(isPortableTsPath);
  if (changedPortable.length === 0) {
    return {
      ok: true,
      reason: 'No portable TypeScript paths changed.',
      changedPortable,
    };
  }
  if (noImpact) {
    return {
      ok: true,
      reason: `Explicit ${noImpactMarker} marker present.`,
      changedPortable,
    };
  }
  const hasAxirChange = changedFiles.some(isAxirSemanticPath);
  if (hasAxirChange) {
    return {
      ok: true,
      reason: 'AxIR/conformance files changed with portable TS.',
      changedPortable,
    };
  }
  const uncovered = changedPortable.filter(
    (item) => !coveredByBacklog(item, ledger.entries)
  );
  if (uncovered.length === 0) {
    return {
      ok: true,
      reason: 'Open AxIR backlog entries cover changed portable TS paths.',
      changedPortable,
    };
  }
  return {
    ok: false,
    reason: 'Portable TS changes need AxIR work or backlog entries.',
    changedPortable,
    uncovered,
  };
}

function checkPr(root, flags) {
  const explicitChanged = flagValues(flags, 'changed-file').map(normalizePath);
  const base = flagValue(flags, 'base', null);
  const head = flagValue(flags, 'head', null);
  const changedFiles =
    explicitChanged.length > 0
      ? explicitChanged
      : changedFilesFromGit(root, base, head);
  const noImpact =
    Boolean(flagValue(flags, 'no-impact', false)) ||
    eventHasNoImpactLabel() ||
    commitMessages(root, base, head).includes(noImpactMarker);
  const ledger = readLedger(root);
  const result = evaluatePrCheck({ changedFiles, ledger, noImpact });

  if (result.ok) {
    console.log(`AxIR backlog check ok: ${result.reason}`);
    return;
  }

  const surface = inferSurface(result.uncovered);
  const pathList = result.uncovered.join(',');
  const command = [
    'npm run axir:backlog -- add',
    '--title "Describe the portable TS behavior change"',
    `--surface ${surface}`,
    '--impact "Describe how generated AxIR targets can drift"',
    `--paths ${JSON.stringify(pathList)}`,
  ].join(' ');

  console.error(`AxIR backlog check failed.

Changed portable TypeScript paths:
${result.changedPortable.map((item) => `- ${item}`).join('\n')}

These paths can affect generated Python/Java/C++/Go/Rust behavior. Either update AxIR/conformance in this PR, or add a tracked backlog item:

  ${command}

If this is TS-only and has no portable behavior impact, add the PR label '${noImpactMarker}' or include '${noImpactMarker}' in a commit message.`);
  process.exit(1);
}

async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = parseCliArgs(argv);
  const root = path.resolve(String(flagValue(flags, 'root', defaultRepoRoot)));
  const command = positional[0];
  if (!command || command === 'help' || flags.help) usage(command ? 0 : 1);

  switch (command) {
    case 'add':
      addEntry(root, flags);
      break;
    case 'done':
      doneEntry(root, positional, flags);
      break;
    case 'list':
      listEntries(root, flags);
      break;
    case 'render':
      validateLedger(readLedger(root));
      renderDocsToDisk(root);
      console.log('Rendered docs/AXIR_BACKLOG.md');
      break;
    case 'validate':
      validateLedger(readLedger(root));
      validateDocs(root);
      console.log('AxIR backlog is valid.');
      break;
    case 'check-pr':
      checkPr(root, flags);
      break;
    default:
      throw new Error(`unknown command ${command}`);
  }
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
