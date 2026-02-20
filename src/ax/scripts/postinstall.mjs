#!/usr/bin/env node

/**
 * Postinstall script for @ax-llm/ax
 *
 * Auto-installs/upgrades the Claude Code skill on package install.
 *
 * Features:
 * - Skips in CI environments (CI, CONTINUOUS_INTEGRATION env vars)
 * - Skips if AX_SKIP_SKILL_INSTALL=1
 * - Silent failure (never breaks package installation)
 * - Cross-platform (macOS, Linux, Windows)
 * - Only logs in interactive terminals (process.stdout.isTTY)
 * - Version-aware upgrades: only upgrades if newer version available
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if we should skip installation
function shouldSkip() {
  // Skip in CI environments
  if (process.env.CI === 'true' || process.env.CI === '1') {
    return true;
  }
  if (
    process.env.CONTINUOUS_INTEGRATION === 'true' ||
    process.env.CONTINUOUS_INTEGRATION === '1'
  ) {
    return true;
  }

  // Skip if explicitly disabled
  if (
    process.env.AX_SKIP_SKILL_INSTALL === '1' ||
    process.env.AX_SKIP_SKILL_INSTALL === 'true'
  ) {
    return true;
  }

  // Common CI environment variables
  const ciEnvVars = [
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'TRAVIS',
    'JENKINS_URL',
    'BUILDKITE',
    'DRONE',
    'TEAMCITY_VERSION',
    'BITBUCKET_BUILD_NUMBER',
    'CODEBUILD_BUILD_ID',
    'TF_BUILD', // Azure Pipelines
  ];

  for (const envVar of ciEnvVars) {
    if (process.env[envVar]) {
      return true;
    }
  }

  return false;
}

// Check if we're in an interactive terminal
function isInteractive() {
  return process.stdout.isTTY === true;
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
 * Get the installed skill version from the file
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
 * Get the skill name from YAML frontmatter, falling back to filename without .md
 */
function getSkillName(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/^name:\s*["']?([^"'\n\r]+)/m);
    if (match) return match[1].trim();
  } catch {
    // Fall through to fallback
  }
  return basename(filePath, '.md');
}

/**
 * Get the package version from the skill source file
 */
function getPackageVersion(sourcePath) {
  if (!existsSync(sourcePath)) {
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
 * Find the project root by using INIT_CWD (set by npm/yarn/pnpm to the
 * directory where `install` was run), falling back to finding the
 * topmost node_modules in __dirname and taking its parent.
 */
function findProjectRoot() {
  // INIT_CWD is the most reliable — npm, yarn, and pnpm all set it
  if (process.env.INIT_CWD) {
    return process.env.INIT_CWD;
  }

  // Fallback: find the topmost node_modules segment in __dirname
  // e.g. /home/user/project/node_modules/.pnpm/@ax-llm+ax@1.0/node_modules/@ax-llm/ax/scripts
  //       → topmost node_modules is at /home/user/project/node_modules
  //       → parent is /home/user/project
  const segments = __dirname.split(sep);
  const firstNmIndex = segments.indexOf('node_modules');
  if (firstNmIndex > 0) {
    return segments.slice(0, firstNmIndex).join(sep);
  }

  // Last resort: the old heuristic (4 levels up)
  return join(__dirname, '..', '..', '..', '..');
}

/**
 * Main installation function
 */
function install() {
  // Skip if needed
  if (shouldSkip()) {
    return;
  }

  try {
    // Paths
    const skillsSourceDir = join(__dirname, '..', 'skills');
    const projectRoot = findProjectRoot();
    const skillsBaseDir = join(projectRoot, '.claude', 'skills');

    // Discover all *.md skill files
    if (!existsSync(skillsSourceDir)) {
      return;
    }

    const skillFiles = readdirSync(skillsSourceDir).filter((f) =>
      f.endsWith('.md')
    );

    if (skillFiles.length === 0) {
      return;
    }

    // Clean up legacy flat file structure (.claude/skills/ax/*.md except SKILL.md)
    const legacyDir = join(skillsBaseDir, 'ax');
    if (existsSync(legacyDir)) {
      try {
        const legacyFiles = readdirSync(legacyDir).filter(
          (f) => f.endsWith('.md') && f !== 'SKILL.md'
        );
        for (const f of legacyFiles) {
          rmSync(join(legacyDir, f), { force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }

    const results = [];

    for (const file of skillFiles) {
      const skillSource = join(skillsSourceDir, file);
      const skillName = getSkillName(skillSource);
      const skillDir = join(skillsBaseDir, skillName);
      const skillTarget = join(skillDir, 'SKILL.md');

      const packageVersion = getPackageVersion(skillSource);
      const installedVersion = getInstalledVersion(skillTarget);

      let shouldInstallFile = false;
      let action = 'Installed';
      let versionInfo = '';

      if (!existsSync(skillTarget)) {
        shouldInstallFile = true;
        versionInfo = packageVersion ? ` (v${packageVersion})` : '';
      } else if (installedVersion && packageVersion) {
        const comparison = compareSemver(packageVersion, installedVersion);
        if (comparison > 0) {
          shouldInstallFile = true;
          action = 'Upgraded';
          versionInfo = ` (v${installedVersion} \u2192 v${packageVersion})`;
        }
      } else if (!installedVersion && existsSync(skillTarget)) {
        shouldInstallFile = true;
        action = 'Upgraded';
        versionInfo = packageVersion ? ` (v${packageVersion})` : '';
      }

      if (shouldInstallFile) {
        if (!existsSync(skillDir)) {
          mkdirSync(skillDir, { recursive: true });
        }

        const content = readFileSync(skillSource, 'utf8');
        writeFileSync(skillTarget, content, 'utf8');
        results.push({ file: skillName, action, versionInfo });
      }
    }

    if (results.length > 0 && isInteractive()) {
      const noun = results.length === 1 ? 'skill' : 'skills';
      const details = results
        .map((r) => `${r.action} ${r.file}${r.versionInfo}`)
        .join(', ');
      console.log(
        `\u2713 ${results.length} Ax Claude Code ${noun}: ${details}`
      );
    }
  } catch {
    // Silent failure - never break npm install
    // The CLI command can be used for manual installation
  }
}

// Run installation
install();
