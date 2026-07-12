import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDir, '..');

export const publicExampleLanguages = [
  {
    id: 'typescript',
    runner: 'typescript',
    aliases: ['ts', 'js', 'javascript'],
    label: 'TypeScript',
    dir: 'typescript',
    fence: 'typescript',
    extensions: ['.ts'],
    comment: '//',
  },
  {
    id: 'python',
    runner: 'python',
    aliases: ['py'],
    label: 'Python',
    dir: 'python',
    fence: 'python',
    extensions: ['.py'],
    comment: '#',
  },
  {
    id: 'java',
    runner: 'java',
    label: 'Java',
    dir: 'java',
    fence: 'java',
    extensions: ['.java'],
    comment: '//',
  },
  {
    id: 'cpp',
    runner: 'cpp',
    aliases: ['c++', 'cc'],
    label: 'C++',
    dir: 'cpp',
    fence: 'cpp',
    extensions: ['.cpp', '.cc', '.cxx'],
    comment: '//',
  },
  {
    id: 'go',
    runner: 'go',
    label: 'Go',
    dir: 'go',
    fence: 'go',
    extensions: ['.go'],
    comment: '//',
  },
  {
    id: 'rust',
    runner: 'rust',
    aliases: ['rs'],
    label: 'Rust',
    dir: 'rust',
    fence: 'rust',
    extensions: ['.rs'],
    comment: '//',
  },
];

export const publicExampleLanguageById = new Map(
  publicExampleLanguages.map((language) => [language.id, language])
);

export const publicExampleLanguageByRunner = new Map(
  publicExampleLanguages.flatMap((language) => [
    [language.runner, language],
    [language.id, language],
    ...(language.aliases ?? []).map((alias) => [alias, language]),
  ])
);

export const exampleGroupOrder = [
  'signatures',
  'generation',
  'short-agents',
  'long-agents',
  'flows',
  'rag',
  'audio',
  'mcp',
  'optimization',
  'providers',
];

export const exampleGroupLabels = new Map([
  ['signatures', 'Signatures'],
  ['generation', 'Generation'],
  ['short-agents', 'Agents'],
  ['long-agents', 'Long-Horizon Agents'],
  ['flows', 'Flows'],
  ['rag', 'RAG'],
  ['audio', 'Audio'],
  ['mcp', 'MCP'],
  ['optimization', 'Optimization'],
  ['providers', 'Providers'],
]);

export const requiredPublicExampleGroups = [
  'generation',
  'short-agents',
  'flows',
  'optimization',
  'audio',
  'mcp',
];

const requiredHeaderFields = new Set([
  'title',
  'group',
  'description',
  'provider',
  'env',
  'level',
]);

const exampleLevels = new Set(['beginner', 'intermediate', 'advanced']);
const exampleLevelOrder = new Map([
  ['beginner', 0],
  ['intermediate', 1],
  ['advanced', 2],
]);

const forbiddenProviderNames = new Set([
  'mock',
  'none',
  'no-key',
  'nokey',
  'scripted',
  'fixture',
]);

const forbiddenPublicExamplePatterns = [
  /\bAxMockAIService\b/,
  /\bmock-ai\b/i,
  /\bmock-model\b/i,
  /\bscripted\b/i,
  /\bno-key\b/i,
  /_no_key\b/i,
];

export async function readPublicExampleCatalog({
  repoRoot = defaultRepoRoot,
} = {}) {
  const examplesRoot = path.join(repoRoot, 'src', 'examples');
  const byLanguage = {};
  const all = [];

  for (const language of publicExampleLanguages) {
    const languageRoot = path.join(examplesRoot, language.dir);
    const files = (await exists(languageRoot))
      ? await listFiles(languageRoot)
      : [];
    const examples = [];

    for (const file of files) {
      if (!language.extensions.includes(path.extname(file))) continue;
      const source = await readFile(file, 'utf8');
      const sourcePath = path
        .relative(repoRoot, file)
        .replaceAll(path.sep, '/');
      const example = parsePublicExample(source, sourcePath, language);
      examples.push(example);
    }

    examples.sort(compareExamples);
    byLanguage[language.id] = examples;
    all.push(...examples);
  }

  validatePublicExampleCoverage(byLanguage);

  return {
    source: 'src/examples/<language> ax-example headers',
    groups: exampleGroupOrder,
    byLanguage,
    all: all.sort(compareExamples),
  };
}

export function groupPublicExamples(examples) {
  const groups = new Map();
  for (const example of examples) {
    const current = groups.get(example.group) ?? [];
    current.push(example);
    groups.set(example.group, current);
  }

  return exampleGroupOrder
    .filter((group) => groups.has(group))
    .map((group) => ({
      slug: group,
      title: exampleGroupLabels.get(group) ?? titleCase(group),
      examples: groups.get(group).sort(compareExamples),
    }));
}

export function resolvePublicExample(catalog, runnerLanguage, exampleArg) {
  const language = publicExampleLanguageByRunner.get(runnerLanguage);
  if (!language) return undefined;

  const examples = catalog.byLanguage[language.id] ?? [];
  const normalized = normalizeExampleArg(exampleArg);
  return examples.find((example) => exampleMatchesArg(example, normalized));
}

export function publicExampleCommand(example) {
  return `npm run example -- ${example.language.id} ${example.sourcePath}`;
}

function parsePublicExample(source, sourcePath, language) {
  const header = parseHeader(source, sourcePath);
  validateHeader(header.fields, source, sourcePath);

  const group = header.fields.group;
  const provider = header.fields.provider;
  const env = splitList(header.fields.env);
  const level = header.fields.level;
  const order = Number.parseInt(header.fields.order ?? '100', 10);
  const story = header.fields.story
    ? Number.parseInt(header.fields.story, 10)
    : undefined;
  const sourceStem = path.basename(sourcePath, path.extname(sourcePath));

  return {
    id: `${language.id}:${sourcePath}`,
    slug: slugify(sourceStem),
    title: header.fields.title,
    group,
    description: header.fields.description,
    provider,
    env,
    level,
    order: Number.isFinite(order) ? order : 100,
    story: Number.isFinite(story) ? story : undefined,
    sourcePath,
    file: path.basename(sourcePath),
    language,
    command: publicExampleCommand({
      language,
      sourcePath,
    }),
    code: stripExampleHeader(source, header),
  };
}

function parseHeader(source, sourcePath) {
  const lines = source.split(/\r?\n/);
  let start = -1;
  let end = -1;
  const fields = {};

  for (const [index, line] of lines.entries()) {
    const payload = commentPayload(line);
    if (payload === 'ax-example:start') {
      start = index;
      continue;
    }

    if (payload === 'ax-example:end') {
      end = index;
      break;
    }

    if (start !== -1 && payload) {
      const separator = payload.indexOf(':');
      if (separator === -1) continue;
      const key = payload.slice(0, separator).trim();
      const value = payload.slice(separator + 1).trim();
      if (key) fields[key] = value;
    }

    if (start === -1 && index > 40) break;
  }

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `${sourcePath} is missing a top-of-file ax-example metadata header`
    );
  }

  return { start, end, fields };
}

function validateHeader(fields, source, sourcePath) {
  for (const field of requiredHeaderFields) {
    if (!fields[field]) {
      throw new Error(`${sourcePath} is missing ax-example field: ${field}`);
    }
  }

  if (!exampleGroupLabels.has(fields.group)) {
    throw new Error(
      `${sourcePath} has unknown example group "${fields.group}"`
    );
  }

  if (!exampleLevels.has(fields.level)) {
    throw new Error(
      `${sourcePath} has invalid ax-example level "${fields.level}"`
    );
  }

  if (forbiddenProviderNames.has(fields.provider.toLowerCase())) {
    throw new Error(
      `${sourcePath} uses non-provider example provider "${fields.provider}"`
    );
  }

  if (splitList(fields.env).length === 0) {
    throw new Error(`${sourcePath} must list required provider env vars`);
  }

  if (/(^|\/)[^/]*(?:test|debug)[^/]*\.[^.]+$/i.test(sourcePath)) {
    throw new Error(`${sourcePath} looks like a test/debug fixture`);
  }

  for (const pattern of forbiddenPublicExamplePatterns) {
    if (pattern.test(source)) {
      throw new Error(
        `${sourcePath} contains mock/scripted/no-key fixture code`
      );
    }
  }
}

function validatePublicExampleCoverage(byLanguage) {
  for (const language of publicExampleLanguages) {
    const examples = byLanguage[language.id] ?? [];
    for (const group of requiredPublicExampleGroups) {
      const rows = examples.filter((example) => example.group === group);
      if (rows.length < 3) {
        throw new Error(
          `src/examples/${language.id}/${group} must contain at least 3 public provider-backed examples; found ${rows.length}`
        );
      }

      const levels = new Set(rows.map((example) => example.level));
      for (const level of exampleLevels) {
        if (!levels.has(level)) {
          throw new Error(
            `src/examples/${language.id}/${group} must include a ${level} example`
          );
        }
      }
    }
  }
}

function stripExampleHeader(source, header) {
  const lines = source.split(/\r?\n/);
  const withoutHeader = [
    ...lines.slice(0, header.start),
    ...lines.slice(header.end + 1),
  ];
  const withoutDocsMarkers = withoutHeader.filter(
    (line) => !/^\s*(?:\/\/|#)\s*docs:(?:start|end)\s+/.test(line)
  );

  while (withoutDocsMarkers.length > 0 && !withoutDocsMarkers[0].trim()) {
    withoutDocsMarkers.shift();
  }
  while (withoutDocsMarkers.length > 0 && !withoutDocsMarkers.at(-1)?.trim()) {
    withoutDocsMarkers.pop();
  }

  return withoutDocsMarkers.join('\n');
}

function compareExamples(left, right) {
  return (
    exampleGroupOrder.indexOf(left.group) -
      exampleGroupOrder.indexOf(right.group) ||
    (exampleLevelOrder.get(left.level) ?? 99) -
      (exampleLevelOrder.get(right.level) ?? 99) ||
    left.order - right.order ||
    left.title.localeCompare(right.title) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

function exampleMatchesArg(example, normalized) {
  const candidates = [
    example.sourcePath,
    example.file,
    path.basename(example.file, path.extname(example.file)),
    `${example.group}/${example.file}`,
    `${example.group}/${path.basename(example.file, path.extname(example.file))}`,
  ].map(normalizeExampleArg);

  return candidates.some(
    (candidate) =>
      candidate === normalized ||
      candidate.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${candidate}`)
  );
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(abs)));
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
  return files.sort();
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function commentPayload(line) {
  return line.match(/^\s*(?:\/\/|#)\s?(.*?)\s*$/)?.[1]?.trim();
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeExampleArg(value) {
  return String(value ?? '')
    .replaceAll(path.sep, '/')
    .replace(/^\.\//, '')
    .trim();
}

function titleCase(value) {
  return String(value)
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
