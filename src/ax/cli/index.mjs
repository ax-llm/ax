#!/usr/bin/env node

/**
 * CLI for @ax-llm/ax
 *
 * Commands:
 *   setup-claude [--force]   Install/upgrade Claude Code skills to .claude/skills/ax/ (project-local)
 *   remove-claude            Remove all Claude Code skills
 *
 * Usage:
 *   npx @ax-llm/ax setup-claude           # Install or upgrade if newer version
 *   npx @ax-llm/ax setup-claude --force   # Force overwrite regardless of version
 *   npx @ax-llm/ax remove-claude          # Remove all skills
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Skill files directory in the package
const SKILLS_SOURCE_DIR = join(__dirname, '..', 'skills');

// Target location in current working directory (project-local)
const SKILL_TARGET_DIR = join(process.cwd(), '.claude', 'skills', 'ax');

/**
 * Get all *.md skill files from the source directory
 */
function getSkillFiles() {
  if (!existsSync(SKILLS_SOURCE_DIR)) {
    return [];
  }
  return readdirSync(SKILLS_SOURCE_DIR).filter((f) => f.endsWith('.md'));
}

/**
 * Compare semver versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareSemver(a, b) {
  const parseVersion = (v) => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      Number.parseInt(match[3], 10),
    ];
  };

  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/**
 * Get the installed skill version from a file
 */
function getInstalledVersion(targetPath) {
  if (!existsSync(targetPath)) {
    return null;
  }

  try {
    const content = readFileSync(targetPath, 'utf8');
    const match = content.match(/^version:\s*["']?([^"'\n\r]+)/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Get the package version from a skill source file
 */
function getPackageVersion(sourcePath) {
  if (!existsSync(sourcePath)) {
    // Fallback: try to read from package.json
    const packageJsonPath = join(__dirname, '..', 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        return pkg.version || null;
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    const content = readFileSync(sourcePath, 'utf8');
    const match = content.match(/^version:\s*["']?([^"'\n\r]+)/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Install or upgrade Claude Code skills
 */
function setupClaude(force = false) {
  const skillFiles = getSkillFiles();

  if (skillFiles.length === 0) {
    console.error('Error: No skill files found. The package may be corrupted.');
    process.exit(1);
  }

  let allUpToDate = true;

  for (const file of skillFiles) {
    const skillSource = join(SKILLS_SOURCE_DIR, file);
    const skillTarget = join(SKILL_TARGET_DIR, file);

    const packageVersion = getPackageVersion(skillSource);
    const installedVersion = getInstalledVersion(skillTarget);

    // Determine if we should install
    let shouldInstall = false;
    let action = 'Installed';

    if (!existsSync(skillTarget)) {
      shouldInstall = true;
    } else if (force) {
      shouldInstall = true;
      action = installedVersion ? 'Reinstalled' : 'Installed';
    } else if (installedVersion && packageVersion) {
      const comparison = compareSemver(packageVersion, installedVersion);
      if (comparison > 0) {
        shouldInstall = true;
        action = 'Upgraded';
      } else if (comparison === 0) {
        console.log(`${file} is up to date (v${installedVersion})`);
        continue;
      } else {
        console.log(
          `${file} is already at v${installedVersion} (package has v${packageVersion})`
        );
        continue;
      }
    } else if (!installedVersion && existsSync(skillTarget)) {
      shouldInstall = true;
      action = 'Upgraded';
    }

    if (!shouldInstall) {
      console.log(`${file} is up to date (v${installedVersion || 'unknown'})`);
      continue;
    }

    allUpToDate = false;

    // Create target directory if it doesn't exist
    if (!existsSync(SKILL_TARGET_DIR)) {
      mkdirSync(SKILL_TARGET_DIR, { recursive: true });
    }

    try {
      const content = readFileSync(skillSource, 'utf8');
      writeFileSync(skillTarget, content, 'utf8');

      if (action === 'Upgraded' && installedVersion && packageVersion) {
        console.log(
          `\u2713 ${action} ${file} (v${installedVersion} \u2192 v${packageVersion})`
        );
      } else {
        console.log(
          `\u2713 ${action} ${file} (v${packageVersion || 'unknown'})`
        );
      }
    } catch (err) {
      console.error(`Error installing ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  if (allUpToDate) {
    console.log('All Ax Claude Code skills are up to date.');
  }
}

/**
 * Remove all Claude Code skills
 */
function removeClaude() {
  if (!existsSync(SKILL_TARGET_DIR)) {
    console.log('Ax Claude Code skills are not installed.');
    return;
  }

  try {
    const installedFiles = readdirSync(SKILL_TARGET_DIR).filter((f) =>
      f.endsWith('.md')
    );

    if (installedFiles.length === 0) {
      console.log('Ax Claude Code skills are not installed.');
      return;
    }

    for (const file of installedFiles) {
      rmSync(join(SKILL_TARGET_DIR, file), { force: true });
    }

    // Try to remove the directory if empty
    try {
      const remaining = readdirSync(SKILL_TARGET_DIR);
      if (remaining.length === 0) {
        rmSync(SKILL_TARGET_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors when trying to clean up directory
    }

    const noun = installedFiles.length === 1 ? 'skill' : 'skills';
    console.log(
      `\u2713 Removed ${installedFiles.length} Ax Claude Code ${noun}`
    );
  } catch (err) {
    console.error(`Error removing skills: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
@ax-llm/ax CLI

Usage:
  npx @ax-llm/ax <command> [options]

Commands:
  setup-claude [--force]   Install/upgrade Claude Code skills
  remove-claude            Remove all Claude Code skills
  help                     Show this help message

Options:
  --force                  Force reinstall regardless of version

Examples:
  npx @ax-llm/ax setup-claude           # Install or upgrade
  npx @ax-llm/ax setup-claude --force   # Force reinstall
  npx @ax-llm/ax remove-claude          # Remove skills
`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);

switch (command) {
  case 'setup-claude':
    setupClaude(flags.includes('--force'));
    break;
  case 'remove-claude':
    removeClaude();
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  case undefined:
    showHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "npx @ax-llm/ax help" for usage information.');
    process.exit(1);
}
