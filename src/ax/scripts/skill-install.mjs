import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  parseSkillFrontmatter,
  readTypeScriptSkillBundles,
} from './skill-bundles.mjs';

function packageSkills(packageRoot) {
  const { version } = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8')
  );
  return readTypeScriptSkillBundles(join(packageRoot, 'skills'), version);
}

function compareVersions(a, b) {
  const parts = (value) =>
    value
      .match(/^(\d+)\.(\d+)\.(\d+)/)
      ?.slice(1)
      .map(Number) ?? [0, 0, 0];
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function installSkills(
  packageRoot,
  projectRoot,
  { all = false, names = [], force = false, upgradeInstalled = false } = {}
) {
  const skills = packageSkills(packageRoot);
  const selectedNames = all
    ? skills.map((skill) => skill.name)
    : names.length
      ? names
      : ['ax-llm'];
  if (upgradeInstalled) {
    for (const skill of skills) {
      if (
        existsSync(
          join(projectRoot, '.claude', 'skills', skill.name, 'SKILL.md')
        ) &&
        !selectedNames.includes(skill.name)
      ) {
        selectedNames.push(skill.name);
      }
    }
  }
  for (const name of selectedNames) {
    if (!skills.some((skill) => skill.name === name))
      throw new Error(`Unknown Ax skill: ${name}`);
  }
  const results = [];
  // Keep the default entry point ahead of optional upgrades, so a broken
  // specialist folder cannot prevent the main capability index installing.
  for (const name of new Set(selectedNames)) {
    const skill = skills.find((entry) => entry.name === name);
    const dir = join(projectRoot, '.claude', 'skills', skill.name);
    const target = join(dir, 'SKILL.md');
    const installed = existsSync(target)
      ? parseSkillFrontmatter(readFileSync(target, 'utf8')).version
      : undefined;
    const comparison = installed
      ? compareVersions(skill.version, installed)
      : 1;
    // Refresh equal-version legacy installs which predate bundled references.
    const missingFiles = Object.keys(skill.files).some(
      (file) => !existsSync(join(dir, file))
    );
    if (!force && (comparison < 0 || (comparison === 0 && !missingFiles)))
      continue;
    for (const [file, content] of Object.entries(skill.files)) {
      if (file === 'SKILL.md') continue;
      const dest = join(dir, file);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content, 'utf8');
    }
    // Register the skill only after every guide was successfully written.
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, skill.content, 'utf8');
    results.push(skill.name);
  }
  return results;
}

// Remove only package-defined files, preserving unrelated files in skill folders.
export function removeSkills(packageRoot, projectRoot) {
  const skills = packageSkills(packageRoot);
  const base = join(projectRoot, '.claude', 'skills');
  let removed = 0;
  for (const skill of skills) {
    const dir = join(base, skill.name);
    if (existsSync(join(dir, 'SKILL.md'))) removed++;
    for (const file of Object.keys(skill.files))
      rmSync(join(dir, file), { force: true });
    for (const folder of ['references', '']) {
      try {
        rmdirSync(join(dir, folder));
      } catch {
        /* Keep nonempty folders. */
      }
    }
  }
  const legacy = join(base, 'ax');
  if (existsSync(legacy)) {
    for (const file of readdirSync(legacy)) {
      if (skills.some((skill) => skill.file === file))
        rmSync(join(legacy, file), { force: true });
    }
  }
  return removed;
}
