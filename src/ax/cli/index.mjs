#!/usr/bin/env node

/**
 * CLI for @ax-llm/ax
 *
 * Commands:
 *   setup-claude [--force]   Install/upgrade Claude Code skill to ~/.claude/skills/ax/
 *   remove-claude            Remove the Claude Code skill
 *
 * Usage:
 *   npx @ax-llm/ax setup-claude           # Install or upgrade if newer version
 *   npx @ax-llm/ax setup-claude --force   # Force overwrite regardless of version
 *   npx @ax-llm/ax remove-claude          # Remove the skill
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Skill file location in the package
const SKILL_SOURCE = join(__dirname, '..', 'skills', 'ax-llm.md');

// Target location in user's home directory
const SKILL_TARGET_DIR = join(homedir(), '.claude', 'skills', 'ax');
const SKILL_TARGET = join(SKILL_TARGET_DIR, 'ax-llm.md');

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
 * Get the installed skill version from the file
 */
function getInstalledVersion() {
  if (!existsSync(SKILL_TARGET)) {
    return null;
  }

  try {
    const content = readFileSync(SKILL_TARGET, 'utf8');
    const match = content.match(/^version:\s*["']?([^"'\n\r]+)/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Get the package version from the skill source file
 */
function getPackageVersion() {
  if (!existsSync(SKILL_SOURCE)) {
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
    const content = readFileSync(SKILL_SOURCE, 'utf8');
    const match = content.match(/^version:\s*["']?([^"'\n\r]+)/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Install or upgrade the Claude Code skill
 */
function setupClaude(force = false) {
  // Check if skill source exists
  if (!existsSync(SKILL_SOURCE)) {
    console.error('Error: Skill file not found. The package may be corrupted.');
    process.exit(1);
  }

  const packageVersion = getPackageVersion();
  const installedVersion = getInstalledVersion();

  // Determine if we should install
  let shouldInstall = false;
  let action = 'Installed';

  if (!existsSync(SKILL_TARGET)) {
    // Fresh install
    shouldInstall = true;
  } else if (force) {
    // Force overwrite
    shouldInstall = true;
    action = installedVersion ? 'Reinstalled' : 'Installed';
  } else if (installedVersion && packageVersion) {
    // Compare versions
    const comparison = compareSemver(packageVersion, installedVersion);
    if (comparison > 0) {
      shouldInstall = true;
      action = `Upgraded`;
    } else if (comparison === 0) {
      console.log(`Ax Claude Code skill is up to date (v${installedVersion})`);
      return;
    } else {
      // Installed version is newer (shouldn't happen normally)
      console.log(
        `Ax Claude Code skill is already at v${installedVersion} (package has v${packageVersion})`
      );
      return;
    }
  } else if (!installedVersion && existsSync(SKILL_TARGET)) {
    // File exists but no version - upgrade
    shouldInstall = true;
    action = 'Upgraded';
  }

  if (!shouldInstall) {
    console.log(
      `Ax Claude Code skill is up to date (v${installedVersion || 'unknown'})`
    );
    return;
  }

  // Create target directory if it doesn't exist
  if (!existsSync(SKILL_TARGET_DIR)) {
    mkdirSync(SKILL_TARGET_DIR, { recursive: true });
  }

  // Copy the skill file
  try {
    const content = readFileSync(SKILL_SOURCE, 'utf8');
    writeFileSync(SKILL_TARGET, content, 'utf8');

    if (action === 'Upgraded' && installedVersion && packageVersion) {
      console.log(
        `\u2713 ${action} Ax Claude Code skill (v${installedVersion} \u2192 v${packageVersion})`
      );
    } else {
      console.log(
        `\u2713 ${action} Ax Claude Code skill (v${packageVersion || 'unknown'})`
      );
    }
  } catch (err) {
    console.error(`Error installing skill: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Remove the Claude Code skill
 */
function removeClaude() {
  if (!existsSync(SKILL_TARGET)) {
    console.log('Ax Claude Code skill is not installed.');
    return;
  }

  try {
    rmSync(SKILL_TARGET, { force: true });

    // Try to remove the directory if empty
    try {
      const dir = dirname(SKILL_TARGET);
      const files = readdirSync(dir);
      if (files.length === 0) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors when trying to clean up directory
    }

    console.log('\u2713 Removed Ax Claude Code skill');
  } catch (err) {
    console.error(`Error removing skill: ${err.message}`);
    process.exit(1);
  }
}

// Import readdirSync for cleanup
import { readdirSync } from 'node:fs';

/**
 * Show help
 */
function showHelp() {
  console.log(`
@ax-llm/ax CLI

Usage:
  npx @ax-llm/ax <command> [options]

Commands:
  setup-claude [--force]   Install/upgrade Claude Code skill
  remove-claude            Remove the Claude Code skill
  help                     Show this help message

Options:
  --force                  Force reinstall regardless of version

Examples:
  npx @ax-llm/ax setup-claude           # Install or upgrade
  npx @ax-llm/ax setup-claude --force   # Force reinstall
  npx @ax-llm/ax remove-claude          # Remove skill
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
