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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
 * Main installation function
 */
function install() {
  // Skip if needed
  if (shouldSkip()) {
    return;
  }

  try {
    // Paths
    const skillSource = join(__dirname, '..', 'skills', 'ax-llm.md');
    // When installed via npm, script runs from: node_modules/@ax-llm/ax/scripts/postinstall.mjs
    // Project root is 4 directories up: ../../../../
    const projectRoot = join(__dirname, '..', '..', '..', '..');
    const skillTargetDir = join(projectRoot, '.claude', 'skills', 'ax');
    const skillTarget = join(skillTargetDir, 'ax-llm.md');

    // Check if source exists
    if (!existsSync(skillSource)) {
      // Skill file not found - this can happen during development
      // Silently exit
      return;
    }

    const packageVersion = getPackageVersion(skillSource);
    const installedVersion = getInstalledVersion(skillTarget);

    // Determine if we should install
    let shouldInstall = false;
    let action = 'Installed';
    let versionInfo = '';

    if (!existsSync(skillTarget)) {
      // Fresh install
      shouldInstall = true;
      versionInfo = packageVersion ? ` (v${packageVersion})` : '';
    } else if (installedVersion && packageVersion) {
      // Compare versions
      const comparison = compareSemver(packageVersion, installedVersion);
      if (comparison > 0) {
        // New version is higher - upgrade
        shouldInstall = true;
        action = 'Upgraded';
        versionInfo = ` (v${installedVersion} \u2192 v${packageVersion})`;
      }
      // If same or lower version, don't install
    } else if (!installedVersion && existsSync(skillTarget)) {
      // File exists but no version - upgrade it
      shouldInstall = true;
      action = 'Upgraded';
      versionInfo = packageVersion ? ` (v${packageVersion})` : '';
    }

    if (!shouldInstall) {
      // Already up to date, silently exit
      return;
    }

    // Create target directory
    if (!existsSync(skillTargetDir)) {
      mkdirSync(skillTargetDir, { recursive: true });
    }

    // Copy skill file
    const content = readFileSync(skillSource, 'utf8');
    writeFileSync(skillTarget, content, 'utf8');

    // Only log in interactive terminals
    if (isInteractive()) {
      console.log(`\u2713 ${action} Ax Claude Code skill${versionInfo}`);
    }
  } catch {
    // Silent failure - never break npm install
    // The CLI command can be used for manual installation
  }
}

// Run installation
install();
