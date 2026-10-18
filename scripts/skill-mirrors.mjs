// Published agent-skill mirrors under
// website/static/<language>/.well-known/agent-skills/. website-prepare.mjs
// writes them and check-skills.mjs verifies the committed copies; both build
// the expected files here so they cannot drift apart.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseSkillFrontmatter,
  readTypeScriptSkillBundles,
} from '../src/ax/scripts/skill-bundles.mjs';
import { createSkillArchive } from './skill-archives.mjs';

export { parseSkillFrontmatter };

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
    if (languageId === 'typescript') {
      out[languageId] = readTypeScriptSkillBundles(
        path.join(repoRoot, 'src/ax/skills'),
        version
      ).map((skill) => ({ ...skill, source: `src/ax/skills/${skill.file}` }));
      continue;
    }
    const skills = [];
    for (const source of await skillSourceFiles(repoRoot, languageId)) {
      let content = await readFile(path.join(repoRoot, source), 'utf8');
      if (!content.endsWith('\n')) content += '\n';
      const frontmatter = parseSkillFrontmatter(content);
      if (!frontmatter.name || !frontmatter.description) {
        throw new Error(`${source} is missing skill name or description`);
      }
      const dir = path.dirname(path.join(repoRoot, source));
      const files = {};
      for (const file of (
        await readdir(dir, { recursive: true, withFileTypes: true })
      ).filter((entry) => entry.isFile())) {
        const abs = path.join(file.parentPath ?? file.path, file.name);
        files[path.relative(dir, abs).replaceAll(path.sep, '/')] =
          await readFile(abs, 'utf8');
      }
      files['SKILL.md'] = content;
      skills.push({ ...frontmatter, content, source, files });
    }
    out[languageId] = skills;
  }
  return out;
}

export function skillIndexEntry(skill) {
  const artifact = skillArtifact(skill);
  return {
    name: skill.name,
    type: artifact.type,
    description: skill.description,
    url: artifact.url,
    digest: sha256Digest(artifact.bytes),
  };
}

export function skillArtifact(skill) {
  const bundled = Object.keys(skill.files).length > 1;
  return {
    type: bundled ? 'archive' : 'skill-md',
    url: `${skill.name}/${bundled ? 'skill.tar.gz' : 'SKILL.md'}`,
    bytes: bundled
      ? createSkillArchive(skill.files)
      : Buffer.from(skill.content),
  };
}

export function sha256Digest(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

async function skillSourceFiles(repoRoot, languageId) {
  const root = `packages/${languageId}/skills`;
  const files = await readdir(path.join(repoRoot, root), { recursive: true });
  return files
    .filter((file) => path.basename(file) === 'SKILL.md')
    .map((file) => `${root}/${file.replaceAll(path.sep, '/')}`)
    .sort();
}
