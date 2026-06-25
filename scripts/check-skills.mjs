#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const discoverySchema =
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const generatedTargets = ['python', 'java', 'cpp', 'go', 'rust'];
const skillIds = [
  'llm',
  'ai',
  'audio',
  'signature',
  'gen',
  'agent',
  'agent-rlm',
  'agent-memory-skills',
  'agent-observability',
  'agent-optimize',
  'flow',
  'gepa',
  'refine',
];
const typeScriptSkillNames = [
  'ax-llm',
  'ax-ai',
  'ax-audio',
  'ax-signature',
  'ax-gen',
  'ax-agent',
  'ax-agent-rlm',
  'ax-agent-memory-skills',
  'ax-agent-observability',
  'ax-agent-optimize',
  'ax-flow',
  'ax-gepa',
  'ax-refine',
].sort();
const languageLabels = {
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  go: 'Go',
  rust: 'Rust',
};
const packageNames = {
  python: 'axllm',
  java: 'dev.axllm:ax',
  cpp: 'axllm',
  go: 'github.com/ax-llm/ax/packages/go',
  rust: 'axllm',
};
const packageJson = await readJson(path.join(repoRoot, 'package.json'));
const packageVersion = String(packageJson.version ?? '');

const failures = [];

await checkTypeScriptSkillNames();
for (const target of generatedTargets) {
  await checkGeneratedPackageSkills(target);
}
await checkWebsiteIndexes(['typescript', ...generatedTargets]);

if (failures.length > 0) {
  console.error('Skill validation failed:');
  for (const failure of failures.slice(0, 120)) {
    console.error(`- ${failure}`);
  }
  if (failures.length > 120) {
    console.error(`- ...and ${failures.length - 120} more`);
  }
  process.exit(1);
}

console.log('Skill validation passed.');

async function checkTypeScriptSkillNames() {
  const skillsRoot = path.join(repoRoot, 'src/ax/skills');
  const files = (await readdir(skillsRoot))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const names = [];
  for (const file of files) {
    const content = await readFile(path.join(skillsRoot, file), 'utf8');
    const frontmatter = parseSkillFrontmatter(content);
    if (!frontmatter.name || !frontmatter.description) {
      failures.push(`src/ax/skills/${file} missing name or description`);
      continue;
    }
    names.push(frontmatter.name);
  }
  names.sort();
  if (names.join('\n') !== typeScriptSkillNames.join('\n')) {
    failures.push(
      `TypeScript skill names changed. Got [${names.join(', ')}], want [${typeScriptSkillNames.join(', ')}]`
    );
  }
}

async function checkGeneratedPackageSkills(target) {
  for (const id of skillIds) {
    const name = `ax-${target}-${id}`;
    const rel = `packages/${target}/skills/${name}/SKILL.md`;
    const abs = path.join(repoRoot, rel);
    if (!(await exists(abs))) {
      failures.push(`missing ${rel}`);
      continue;
    }
    const content = await readFile(abs, 'utf8');
    const frontmatter = parseSkillFrontmatter(content);
    if (frontmatter.name !== name) {
      failures.push(`${rel} name=${frontmatter.name ?? ''}, want ${name}`);
    }
    if (!frontmatter.description) {
      failures.push(`${rel} missing description`);
    } else {
      if (!frontmatter.description.includes(languageLabels[target])) {
        failures.push(
          `${rel} description must mention ${languageLabels[target]}`
        );
      }
      if (!frontmatter.description.includes(packageNames[target])) {
        failures.push(
          `${rel} description must mention ${packageNames[target]}`
        );
      }
    }
    if (frontmatter.version !== packageVersion) {
      failures.push(
        `${rel} version=${frontmatter.version ?? ''}, want ${packageVersion}`
      );
    }
    for (const forbidden of [
      'axir-language-backend',
      'website-md-language-docs',
    ]) {
      if (content.includes(forbidden)) {
        failures.push(`${rel} leaks maintainer skill marker ${forbidden}`);
      }
    }
  }
}

async function checkWebsiteIndexes(languageIds) {
  for (const languageId of languageIds) {
    const root = path.join(
      repoRoot,
      'website/static',
      languageId,
      '.well-known',
      'agent-skills'
    );
    const indexPath = path.join(root, 'index.json');
    if (!(await exists(indexPath))) {
      failures.push(`missing ${path.relative(repoRoot, indexPath)}`);
      continue;
    }
    const index = await readJson(indexPath);
    if (index.$schema !== discoverySchema) {
      failures.push(`${path.relative(repoRoot, indexPath)} has bad $schema`);
    }
    if (!Array.isArray(index.skills) || index.skills.length === 0) {
      failures.push(`${path.relative(repoRoot, indexPath)} has no skills`);
      continue;
    }
    const expectedNames =
      languageId === 'typescript'
        ? typeScriptSkillNames
        : skillIds.map((id) => `ax-${languageId}-${id}`).sort();
    const actualNames = index.skills.map((entry) => entry.name).sort();
    if (actualNames.join('\n') !== expectedNames.join('\n')) {
      failures.push(
        `${path.relative(repoRoot, indexPath)} names [${actualNames.join(', ')}] do not match expected [${expectedNames.join(', ')}]`
      );
    }
    for (const entry of index.skills) {
      if (entry.type !== 'skill-md') {
        failures.push(
          `${languageId}/${entry.name} type=${entry.type}, want skill-md`
        );
      }
      if (
        typeof entry.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(entry.digest)
      ) {
        failures.push(`${languageId}/${entry.name} has invalid digest`);
        continue;
      }
      const skillPath = path.normalize(path.join(root, entry.url ?? ''));
      if (!skillPath.startsWith(root)) {
        failures.push(
          `${languageId}/${entry.name} has unsafe url ${entry.url}`
        );
        continue;
      }
      if (!(await exists(skillPath))) {
        failures.push(`${languageId}/${entry.name} url missing ${entry.url}`);
        continue;
      }
      const content = await readFile(skillPath);
      const digest = sha256Digest(content);
      if (digest !== entry.digest) {
        failures.push(
          `${languageId}/${entry.name} digest=${entry.digest}, want ${digest}`
        );
      }
      const frontmatter = parseSkillFrontmatter(content.toString('utf8'));
      if (frontmatter.name !== entry.name) {
        failures.push(`${languageId}/${entry.name} frontmatter name mismatch`);
      }
      if (!frontmatter.description) {
        failures.push(
          `${languageId}/${entry.name} missing frontmatter description`
        );
      }
    }
  }
}

function parseSkillFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return {};
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return {};
  const text = markdown.slice(4, end);
  return {
    name: frontmatterField(text, 'name'),
    description: frontmatterField(text, 'description'),
    version: frontmatterField(text, 'version'),
  };
}

function frontmatterField(frontmatterText, key) {
  const match = frontmatterText.match(
    new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm')
  );
  return match?.[1]?.trim();
}

function sha256Digest(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
