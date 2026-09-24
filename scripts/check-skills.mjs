#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSkillFrontmatter,
  readSkillMirrorSources,
  sha256Digest,
  skillDiscoverySchema,
  skillIndexEntry,
  skillMirrorRoot,
} from './skill-mirrors.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const generatedTargets = ['python', 'java', 'cpp', 'go', 'rust'];
const websiteLanguageIds = ['typescript', ...generatedTargets];
const skillIds = [
  'llm',
  'ai',
  'typesafe',
  'audio',
  'signature',
  'gen',
  'agent',
  'agent-rlm',
  'agent-memory-skills',
  'agent-observability',
  'agent-optimize',
  'agent-context',
  'flow',
  'gepa',
  'playbook',
  'refine',
];
const typeScriptSkillNames = [
  'ax-llm',
  'ax-ai',
  'ax-typesafe',
  'ax-audio',
  'ax-signature',
  'ax-gen',
  'ax-agent',
  'ax-agent-rlm',
  'ax-agent-memory-skills',
  'ax-agent-observability',
  'ax-agent-optimize',
  'ax-agent-context',
  'ax-flow',
  'ax-mcp',
  'ax-event-runtime',
  'ax-gepa',
  'ax-playbook',
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
const staleMirrors = new Set();

await checkTypeScriptSkillNames();
for (const target of generatedTargets) {
  await checkGeneratedPackageSkills(target);
}
await checkWebsiteIndexes(websiteLanguageIds);
await checkWebsiteMirrors(websiteLanguageIds);

if (failures.length > 0) {
  console.error('Skill validation failed:');
  for (const failure of failures.slice(0, 120)) {
    console.error(`- ${failure}`);
  }
  if (failures.length > 120) {
    console.error(`- ...and ${failures.length - 120} more`);
  }
  if (staleMirrors.size > 0) {
    console.error(`\nStale published skills: ${[...staleMirrors].join(', ')}`);
    console.error(
      'Run `npm run website:prepare` to regenerate them from their sources, then commit the changes under website/static/.'
    );
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
    const root = skillMirrorRoot(repoRoot, languageId);
    const indexPath = path.join(root, 'index.json');
    if (!(await exists(indexPath))) {
      failures.push(`missing ${path.relative(repoRoot, indexPath)}`);
      continue;
    }
    const index = await readJson(indexPath);
    if (index.$schema !== skillDiscoverySchema) {
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

// website:prepare rebuilds each agent-skills directory from the skill sources,
// so every committed mirror and index entry must match what it would write now.
// This catches a source edit that skipped the regenerate, which the digest
// check above cannot: a stale mirror still matches its stale digest.
async function checkWebsiteMirrors(languageIds) {
  let sources;
  try {
    sources = await readSkillMirrorSources(repoRoot, languageIds);
  } catch (error) {
    failures.push(error.message);
    return;
  }
  for (const languageId of languageIds) {
    const stale = (name, message) => {
      staleMirrors.add(`${languageId}/${name}`);
      failures.push(`${languageId}/${name}: ${message}`);
    };
    const root = skillMirrorRoot(repoRoot, languageId);
    const indexPath = path.join(root, 'index.json');
    const indexRel = path.relative(repoRoot, indexPath);
    const index = (await exists(indexPath)) ? await readJson(indexPath) : {};
    const entries = new Map(
      (Array.isArray(index.skills) ? index.skills : []).map((entry) => [
        entry.name,
        entry,
      ])
    );

    const skills = sources[languageId];
    for (const skill of skills) {
      const mirrorPath = path.join(root, skill.name, 'SKILL.md');
      const mirrorRel = path.relative(repoRoot, mirrorPath);
      if (!(await exists(mirrorPath))) {
        stale(skill.name, `missing ${mirrorRel} for ${skill.source}`);
      } else {
        const mirror = await readFile(mirrorPath, 'utf8');
        if (mirror !== skill.content) {
          const line = firstDifferentLine(mirror, skill.content);
          stale(
            skill.name,
            `${mirrorRel} does not match ${skill.source} (first difference at line ${line})`
          );
        }
      }
      const entry = entries.get(skill.name);
      if (!entry) {
        stale(skill.name, `${indexRel} has no entry for ${skill.source}`);
        continue;
      }
      for (const [key, value] of Object.entries(skillIndexEntry(skill))) {
        if (entry[key] !== value) {
          stale(
            skill.name,
            `${indexRel} ${key} does not match ${skill.source}`
          );
        }
      }
    }

    const sourceNames = new Set(skills.map((skill) => skill.name));
    const mirrorNames = (await exists(root))
      ? (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
    for (const name of new Set([...mirrorNames, ...entries.keys()])) {
      if (!sourceNames.has(name)) {
        stale(name, 'published, but no source skill defines it');
      }
    }
  }
}

function firstDifferentLine(actual, expected) {
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const index = expectedLines.findIndex((line, i) => line !== actualLines[i]);
  return (index === -1 ? expectedLines.length : index) + 1;
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
