import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function parseSkillFrontmatter(markdown) {
  const text = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!text) return {};
  const field = (key) =>
    text.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'))?.[1];
  return {
    name: field('name'),
    description: field('description'),
    version: field('version'),
  };
}

export function stripSkillFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)(?:\r?\n)*/, '');
}

// The source docs remain independently installable. The entry point bundles
// those same docs as ordinary references, so only one skill needs registering.
export function readTypeScriptSkillBundles(skillsRoot, version) {
  const sources = readdirSync(skillsRoot)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => {
      const content = readFileSync(join(skillsRoot, file), 'utf8').replace(
        /^version:\s*["']?__VERSION__["']?/m,
        `version: "${version}"`
      );
      const metadata = parseSkillFrontmatter(content);
      if (!metadata.name || !metadata.description) {
        throw new Error(`${file} is missing skill name or description`);
      }
      return { ...metadata, file, content };
    });
  const byFile = new Map(sources.map((skill) => [skill.file, skill]));
  return sources.map((skill) => {
    const files = {};
    const addReference = (file) => {
      const key = `references/${file}`;
      if (files[key]) return;
      const source = byFile.get(file);
      if (!source) throw new Error(`Missing skill reference: ${file}`);
      files[key] = stripSkillFrontmatter(source.content);
      for (const match of files[key].matchAll(
        /\]\((ax-[\w-]+\.md)(?:#[^)]*)?\)/g
      )) {
        addReference(match[1]);
      }
    };
    const content = skill.content.replace(
      /\]\((ax-[\w-]+\.md)((?:#[^)]*)?)\)/g,
      (_, file, anchor) => {
        addReference(file);
        return `](references/${file}${anchor})`;
      }
    );
    if (skill.name === 'ax-llm') {
      for (const source of sources) {
        if (source.name !== skill.name) addReference(source.file);
      }
      files['references/quickstart.md'] = readFileSync(
        join(skillsRoot, 'references', 'quickstart.md'),
        'utf8'
      );
    }
    return { ...skill, content, files: { 'SKILL.md': content, ...files } };
  });
}
