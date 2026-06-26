#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKLOG_SCHEMA_VERSION = 2;
export const PORTABLE_SURFACES = new Set([
  'signature',
  'schema',
  'prompt',
  'axgen',
  'axai',
  'axagent',
  'axflow',
  'axmcp',
  'axmem',
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
  ['src/ax/mem/', 'axmem'],
];

// IR modules that implement each portable TS root. A same-PR AxIR change
// only waives the portable paths whose surface it touches; everything else
// still needs a backlog entry or the no-impact marker.
const portableRootIrModules = new Map([
  [
    'src/ax/ai/',
    ['ir/axcore/ai.axir', 'ir/axcore/provider.axir', 'ir/axcore/stream.axir'],
  ],
  [
    'src/ax/dsp/',
    [
      'ir/axcore/gen.axir',
      'ir/axcore/schema.axir',
      'ir/axcore/signature.axir',
      'ir/axcore/template.axir',
      'ir/axcore/validate.axir',
      'ir/axcore/optimize.axir',
    ],
  ],
  [
    'src/ax/agent/',
    [
      'ir/axcore/agent.axir',
      'ir/axcore/program.axir',
      'ir/axcore/api.axir',
      'ir/axcore/tool.axir',
      'ir/axcore/optimize.axir',
    ],
  ],
  ['src/ax/flow/', ['ir/axcore/flow.axir', 'ir/axcore/program.axir']],
  ['src/ax/mcp/', ['ir/axcore/mcp.axir', 'ir/axcore/tool.axir']],
  ['src/ax/mem/', ['ir/axcore/api.axir']],
]);

// Cross-cutting AxIR work counts for every surface.
const axirGlobalRoots = ['ir/axcore/data/', 'ir/conformance/', 'tools/axir/'];

const axirGlobalFiles = new Set([
  'ir/axcore/root.axir',
  'ir/axcore/core.axir',
  'scripts/axir-conformance-sync.mjs',
  'scripts/test-axir.mjs',
]);

const axirSemanticRoots = ['ir/axcore/', 'ir/conformance/', 'tools/axir/'];

const axirSemanticFiles = new Set([
  'scripts/axir-conformance-sync.mjs',
  'scripts/test-axir.mjs',
]);

function usage(code = 0) {
  const out = code === 0 ? console.log : console.error;
  out(`Usage:
  npm run axir:backlog -- add --title "..." --surface axai --impact "..." --paths src/ax/ai/openai/info.ts [--pr 525]
  npm run axir:backlog -- exempt --id webllm-browser-only --surface axai --reason "Browser-only WebLLM provider" --paths src/ax/ai/webllm --scoped-files src/ax/ai/wrap.ts --tags webllm,browser-only
  npm run axir:backlog -- list [--status open|done|all] [--surface axai]
  npm run axir:backlog -- done <id> --commit <sha> --verification "npm run test:axir"
  npm run axir:backlog -- check-pr --base origin/main --head HEAD
  npm run axir:backlog -- render
  npm run axir:backlog -- validate

check-pr passes a changed portable TS path when the same range touches the
IR modules for its surface (see portableRootIrModules), conformance
fixtures, tools/axir, or an open backlog entry covering it.
Non-portable browser/host-specific paths can be tracked with an exemption.
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
    nonPortableExemptions: [],
  };
}

export function readLedger(root = defaultRepoRoot) {
  const { backlog } = repoPaths(root);
  if (!existsSync(backlog)) return emptyLedger();
  return normalizeLedger(readJson(backlog));
}

export function writeLedger(root, ledger) {
  validateLedger(ledger);
  writeJson(repoPaths(root).backlog, sortLedger(ledger));
}

function sortLedger(ledger) {
  const normalized = normalizeLedger(ledger);
  return {
    schemaVersion: normalized.schemaVersion,
    entries: [...normalized.entries].sort((a, b) => a.id.localeCompare(b.id)),
    nonPortableExemptions: [...normalized.nonPortableExemptions].sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
  };
}

function normalizeLedger(ledger) {
  if (!ledger || typeof ledger !== 'object') return ledger;
  if (ledger.schemaVersion === 1) {
    return {
      ...ledger,
      schemaVersion: BACKLOG_SCHEMA_VERSION,
      nonPortableExemptions: ledger.nonPortableExemptions ?? [],
    };
  }
  return {
    ...ledger,
    nonPortableExemptions: ledger.nonPortableExemptions ?? [],
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

function parseTags(flags) {
  return splitList([...flagValues(flags, 'tags'), ...flagValues(flags, 'tag')]);
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

export function validateNonPortableExemption(exemption) {
  const errors = [];
  const id = exemption?.id ?? '<unknown>';
  for (const key of ['id', 'surface', 'reason']) {
    if (typeof exemption?.[key] !== 'string' || exemption[key].trim() === '') {
      errors.push(`nonPortableExemption ${id} missing string ${key}`);
    }
  }
  if (exemption?.surface && !PORTABLE_SURFACES.has(exemption.surface)) {
    errors.push(
      `nonPortableExemption ${id} has invalid surface ${exemption.surface}`
    );
  }
  for (const key of ['paths', 'scopedFiles', 'tags']) {
    if (!Array.isArray(exemption?.[key])) {
      errors.push(`nonPortableExemption ${id} ${key} must be an array`);
      continue;
    }
    for (const item of exemption[key]) {
      if (typeof item !== 'string' || item.trim() === '') {
        errors.push(`nonPortableExemption ${id} has invalid ${key} item`);
      }
    }
  }
  if (
    Array.isArray(exemption?.paths) &&
    Array.isArray(exemption?.scopedFiles) &&
    exemption.paths.length === 0 &&
    exemption.scopedFiles.length === 0
  ) {
    errors.push(`nonPortableExemption ${id} must include paths or scopedFiles`);
  }
  if (Array.isArray(exemption?.tags) && exemption.tags.length === 0) {
    errors.push(`nonPortableExemption ${id} must include at least one tag`);
  }
  return errors;
}

export function validateLedger(ledger) {
  const normalizedLedger = normalizeLedger(ledger);
  const errors = [];
  if (!normalizedLedger || typeof normalizedLedger !== 'object') {
    throw new Error('ledger must be an object');
  }
  if (normalizedLedger.schemaVersion !== BACKLOG_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${BACKLOG_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(normalizedLedger.entries)) {
    errors.push('entries must be an array');
  } else {
    const seen = new Set();
    for (const entry of normalizedLedger.entries) {
      if (seen.has(entry.id)) errors.push(`duplicate entry id ${entry.id}`);
      seen.add(entry.id);
      errors.push(...validateEntry(entry));
    }
  }
  if (!Array.isArray(normalizedLedger.nonPortableExemptions)) {
    errors.push('nonPortableExemptions must be an array');
  } else {
    const seen = new Set();
    for (const exemption of normalizedLedger.nonPortableExemptions) {
      if (seen.has(exemption.id)) {
        errors.push(`duplicate nonPortableExemption id ${exemption.id}`);
      }
      seen.add(exemption.id);
      errors.push(...validateNonPortableExemption(exemption));
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid AxIR backlog:\n${errors.map((item) => `- ${item}`).join('\n')}`
    );
  }
  return true;
}

function addExemption(root, flags) {
  const id = flagValue(flags, 'id');
  const reason = flagValue(flags, 'reason');
  const paths = parsePaths(flags);
  const scopedFiles = splitList([
    ...flagValues(flags, 'scoped-files'),
    ...flagValues(flags, 'scoped-file'),
  ]).map(normalizePath);
  const tags = parseTags(flags);
  if (!id || !reason || tags.length === 0) {
    throw new Error('exempt requires --id, --reason, and --tags');
  }
  if (paths.length === 0 && scopedFiles.length === 0) {
    throw new Error('exempt requires --paths or --scoped-files');
  }
  const surface = flagValue(
    flags,
    'surface',
    inferSurface([...paths, ...scopedFiles])
  );
  if (!PORTABLE_SURFACES.has(surface)) {
    throw new Error(`invalid --surface ${surface}`);
  }

  const ledger = readLedger(root);
  if (ledger.nonPortableExemptions.some((item) => item.id === id)) {
    throw new Error(`AxIR non-portable exemption already exists: ${id}`);
  }

  ledger.nonPortableExemptions.push({
    id,
    surface,
    paths,
    scopedFiles,
    tags,
    reason,
    createdAt: today(),
  });
  writeLedger(root, ledger);
  renderDocsToDisk(root);
  console.log(`Added AxIR non-portable exemption ${id}`);
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

  const exemptions = ledger.nonPortableExemptions.filter((item) => {
    if (surface && item.surface !== surface) return false;
    return true;
  });
  if (status === 'open' && exemptions.length > 0) {
    console.log('\nNon-portable exemptions:');
    for (const exemption of exemptions) {
      console.log(
        `     ${exemption.id} [${exemption.surface}] ${exemption.reason}`
      );
    }
  }
}

function renderDocsToDisk(root) {
  const markdown = renderMarkdown(readLedger(root));
  const { docs } = repoPaths(root);
  mkdirSync(path.dirname(docs), { recursive: true });
  writeFileSync(docs, markdown);
}

export function renderMarkdown(ledger) {
  const normalizedLedger = normalizeLedger(ledger);
  validateLedger(normalizedLedger);
  const open = normalizedLedger.entries.filter(
    (entry) => entry.status === 'open'
  );
  const done = normalizedLedger.entries.filter(
    (entry) => entry.status === 'done'
  );
  return [
    '# AxIR Backlog',
    '',
    '<!-- Generated by `npm run axir:backlog:render`; do not edit by hand. -->',
    '',
    'This ledger tracks portable TypeScript behavior that should be migrated into AxIR/Core and generated language backends.',
    '',
    renderExemptions(normalizedLedger.nonPortableExemptions),
    renderSection('Open', open),
    renderSection('Done', done),
  ].join('\n');
}

function renderExemptions(exemptions) {
  const lines = ['## Non-Portable Exemptions', ''];
  if (exemptions.length === 0) {
    lines.push('No entries.', '');
    return lines.join('\n');
  }
  for (const exemption of exemptions) {
    lines.push(`- \`${exemption.id}\` [${exemption.surface}]`);
    lines.push(`  - Reason: ${exemption.reason}`);
    if (exemption.paths.length > 0) {
      lines.push(
        `  - Paths: ${exemption.paths.map((item) => `\`${item}\``).join(', ')}`
      );
    }
    if (exemption.scopedFiles.length > 0) {
      lines.push(
        `  - Scoped files: ${exemption.scopedFiles
          .map((item) => `\`${item}\``)
          .join(', ')}`
      );
    }
    lines.push(
      `  - Tags: ${exemption.tags.map((item) => `\`${item}\``).join(', ')}`
    );
  }
  lines.push('');
  return lines.join('\n');
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

function isValidCommit(root, ref) {
  if (!ref || /^0+$/.test(ref)) return false;
  try {
    execFileSync(
      'git',
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    return true;
  } catch {
    return false;
  }
}

// On branch creation pushes github.event.before is the all-zeros SHA, and a
// force-push parent can be unreachable; fall back so the gate still
// evaluates something instead of failing or passing vacuously.
function resolveDiffBase(root, base) {
  if (!base || isValidCommit(root, base)) return base;
  const fallback = 'HEAD~1';
  if (isValidCommit(root, fallback)) {
    console.warn(
      `Warning: diff base ${base} is not a reachable commit; falling back to ${fallback}.`
    );
    return fallback;
  }
  console.warn(
    `Warning: diff base ${base} is not a reachable commit and HEAD~1 does not exist; comparing working tree only.`
  );
  return null;
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

function changedLineRangesFromGit(root, base, head) {
  const range = base && head ? [`${base}...${head}`] : [];
  const output = execFileSync(
    'git',
    ['diff', '--unified=0', '--no-ext-diff', ...range],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  return parseChangedLineRanges(output);
}

export function parseChangedLineRanges(diffText) {
  const ranges = {};
  let currentPath = null;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentPath = normalizePath(line.slice('+++ b/'.length));
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      currentPath = null;
      continue;
    }
    if (!currentPath || !line.startsWith('@@')) continue;
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count <= 0) continue;
    const end = start + count - 1;
    ranges[currentPath] = [...(ranges[currentPath] ?? []), { start, end }];
  }
  return ranges;
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

function changedRangesFor(changedLineRanges, changedPath) {
  if (!changedLineRanges) return [];
  if (changedLineRanges instanceof Map) {
    return changedLineRanges.get(normalizePath(changedPath)) ?? [];
  }
  return changedLineRanges[normalizePath(changedPath)] ?? [];
}

function markerRangesFor(content, tags) {
  const ranges = [];
  const lines = String(content).split(/\r?\n/);
  const tagSet = new Set(tags);
  let active = null;
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const startMatch = /axir-nonportable:start\s+([A-Za-z0-9_.:-]+)/.exec(
      lines[index]
    );
    if (startMatch && tagSet.has(startMatch[1])) {
      active = { tag: startMatch[1], start: lineNumber };
      continue;
    }
    const endMatch = /axir-nonportable:end\s+([A-Za-z0-9_.:-]+)/.exec(
      lines[index]
    );
    if (endMatch && active?.tag === endMatch[1]) {
      ranges.push({ start: active.start, end: lineNumber });
      active = null;
    }
  }
  return ranges;
}

function rangeCoveredByMarkers(range, markerRanges) {
  return markerRanges.some(
    (marker) => range.start >= marker.start && range.end <= marker.end
  );
}

function fileContentFor(readFile, changedPath) {
  if (!readFile) return undefined;
  try {
    return readFile(normalizePath(changedPath));
  } catch {
    return undefined;
  }
}

function coveredByNonPortableExemption(
  changedPath,
  exemptions,
  { changedLineRanges, readFile } = {}
) {
  const normalized = normalizePath(changedPath);
  return exemptions.some((exemption) => {
    if (
      exemption.paths.some((candidate) => pathCovers(normalized, candidate))
    ) {
      return true;
    }
    if (
      !exemption.scopedFiles.some(
        (candidate) => normalizePath(candidate) === normalized
      )
    ) {
      return false;
    }
    const ranges = changedRangesFor(changedLineRanges, normalized);
    if (ranges.length === 0) return false;
    const content = fileContentFor(readFile, normalized);
    if (content === undefined) return false;
    const markerRanges = markerRangesFor(content, exemption.tags);
    if (markerRanges.length === 0) return false;
    return ranges.every((range) => rangeCoveredByMarkers(range, markerRanges));
  });
}

function portableRootOf(filePath) {
  const normalized = normalizePath(filePath);
  for (const [root] of portableRoots) {
    if (normalized.startsWith(root)) return root;
  }
  return null;
}

function isAxirGlobalPath(filePath) {
  const normalized = normalizePath(filePath);
  if (axirGlobalFiles.has(normalized)) return true;
  return axirGlobalRoots.some((root) => normalized.startsWith(root));
}

export function surfaceIrModulesFor(filePath) {
  const root = portableRootOf(filePath);
  return root ? (portableRootIrModules.get(root) ?? []) : [];
}

function coveredByAxirChange(changedPath, changedFiles) {
  if (changedFiles.some(isAxirGlobalPath)) return true;
  const modules = surfaceIrModulesFor(changedPath);
  return changedFiles.some((file) => modules.includes(normalizePath(file)));
}

export function evaluatePrCheck({
  changedFiles,
  ledger,
  noImpact = false,
  changedLineRanges,
  readFile,
}) {
  const normalizedLedger = normalizeLedger(ledger);
  validateLedger(normalizedLedger);
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
  const uncovered = changedPortable.filter(
    (item) =>
      !coveredByAxirChange(item, changedFiles) &&
      !coveredByBacklog(item, normalizedLedger.entries) &&
      !coveredByNonPortableExemption(
        item,
        normalizedLedger.nonPortableExemptions,
        {
          changedLineRanges,
          readFile,
        }
      )
  );
  if (uncovered.length === 0) {
    return {
      ok: true,
      reason:
        'Surface-matching AxIR changes, open backlog entries, or non-portable exemptions cover every changed portable TS path.',
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

export function staleOpenEntries(ledger, todayDate, thresholdDays = 30) {
  const normalizedLedger = normalizeLedger(ledger);
  const now = Date.parse(todayDate);
  if (Number.isNaN(now)) return [];
  return normalizedLedger.entries
    .filter((entry) => entry.status === 'open')
    .map((entry) => {
      const created = Date.parse(entry.createdAt);
      const ageDays = Number.isNaN(created)
        ? Number.POSITIVE_INFINITY
        : Math.floor((now - created) / 86_400_000);
      return { entry, ageDays };
    })
    .filter(({ ageDays }) => ageDays > thresholdDays);
}

function printStaleWarnings(ledger) {
  const stale = staleOpenEntries(ledger, today());
  if (stale.length === 0) return;
  console.warn(
    `\nWarning: ${stale.length} open AxIR backlog ${
      stale.length === 1 ? 'entry is' : 'entries are'
    } older than 30 days and still waive their TS paths:`
  );
  for (const { entry, ageDays } of stale) {
    console.warn(
      `- ${entry.id} (${ageDays} days old): ${entry.tsPaths.join(', ')}`
    );
  }
  console.warn(
    'Migrate them, or close them with: npm run axir:backlog -- done <id> --commit <sha> --verification "..."\n'
  );
}

function checkPr(root, flags) {
  const explicitChanged = flagValues(flags, 'changed-file').map(normalizePath);
  const base = resolveDiffBase(root, flagValue(flags, 'base', null));
  const head = flagValue(flags, 'head', null);
  const changedFiles =
    explicitChanged.length > 0
      ? explicitChanged
      : changedFilesFromGit(root, base, head);
  const changedLineRanges =
    explicitChanged.length > 0
      ? {}
      : changedLineRangesFromGit(root, base, head);
  const noImpact =
    Boolean(flagValue(flags, 'no-impact', false)) ||
    eventHasNoImpactLabel() ||
    commitMessages(root, base, head).includes(noImpactMarker);
  const ledger = readLedger(root);
  const result = evaluatePrCheck({
    changedFiles,
    ledger,
    noImpact,
    changedLineRanges,
    readFile: (filePath) => readFileSync(path.join(root, filePath), 'utf8'),
  });
  printStaleWarnings(ledger);

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

  const moduleHints = [
    ...new Set(result.uncovered.flatMap(surfaceIrModulesFor)),
  ];

  console.error(`AxIR backlog check failed.

Uncovered portable TypeScript paths:
${result.uncovered.map((item) => `- ${item}`).join('\n')}

These paths can affect generated Python/Java/C++/Go/Rust behavior. The check passes when the same change also touches the IR modules for their surface (${moduleHints.join(', ') || 'see portableRootIrModules'}), conformance fixtures, tools/axir, a matching open backlog entry, or a scoped non-portable exemption. Otherwise add a tracked backlog item:

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
    case 'exempt':
      addExemption(root, flags);
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
    case 'validate': {
      const ledger = readLedger(root);
      validateLedger(ledger);
      validateDocs(root);
      printStaleWarnings(ledger);
      console.log('AxIR backlog is valid.');
      break;
    }
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
