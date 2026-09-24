// Published agent-skill mirrors under
// website/static/<language>/.well-known/agent-skills/. website-prepare.mjs
// writes them and check-skills.mjs verifies the committed copies; both build
// the expected files here so they cannot drift apart.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const skillDiscoverySchema =
  'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

export function skillMirrorRoot(repoRoot, languageId) {
  return path.join(
    repoRoot,
    'website',
    'static',
    languageId,
    '.well-known',
    'agent-skills'
  );
}

// Returns { [languageId]: skills }, where each skill carries the exact
// content of its published SKILL.md. TypeScript skills come from
// src/ax/skills/*.md with the root package version injected; the generated
// languages publish packages/<language>/skills/**/SKILL.md as is.
export async function readSkillMirrorSources(repoRoot, languageIds) {
  const rootPackage = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf8')
  );
  const version = String(rootPackage.version ?? '0.1.0');
  const out = {};
  for (const languageId of languageIds) {
    const skills = [];
    for (const source of await skillSourceFiles(repoRoot, languageId)) {
      let content = await readFile(path.join(repoRoot, source), 'utf8');
      if (languageId === 'typescript') {
        content = content.replace(
          /^version:\s*["']?__VERSION__["']?/m,
          `version: "${version}"`
        );
      }
      if (!content.endsWith('\n')) content += '\n';
      const frontmatter = parseSkillFrontmatter(content);
      if (!frontmatter.name || !frontmatter.description) {
        throw new Error(`${source} is missing skill name or description`);
      }
      skills.push({ ...frontmatter, content, source });
    }
    out[languageId] = skills;
  }
  return out;
}

export function skillIndexEntry(skill) {
  return {
    name: skill.name,
    type: 'skill-md',
    description: skill.description,
    url: `${skill.name}/SKILL.md`,
    digest: sha256Digest(skill.content),
  };
}

export function parseSkillFrontmatter(markdown) {
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

export function sha256Digest(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

async function skillSourceFiles(repoRoot, languageId) {
  if (languageId === 'typescript') {
    const files = await readdir(path.join(repoRoot, 'src/ax/skills'));
    return files
      .filter((file) => file.endsWith('.md'))
      .sort()
      .map((file) => `src/ax/skills/${file}`);
  }
  const root = `packages/${languageId}/skills`;
  const files = await readdir(path.join(repoRoot, root), { recursive: true });
  return files
    .filter((file) => path.basename(file) === 'SKILL.md')
    .map((file) => `${root}/${file.replaceAll(path.sep, '/')}`)
    .sort();
}

function frontmatterField(frontmatterText, key) {
  const match = frontmatterText.match(
    new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm')
  );
  return match?.[1]?.trim();
}
