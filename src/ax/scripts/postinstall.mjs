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
  writeFileSync,
} from 'node:fs';
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
    const skillsSourceDir = join(__dirname, '..', 'skills');
    // When installed via npm, script runs from: node_modules/@ax-llm/ax/scripts/postinstall.mjs
    // Project root is 4 directories up: ../../../../
    const projectRoot = join(__dirname, '..', '..', '..', '..');
    const skillTargetDir = join(projectRoot, '.claude', 'skills', 'ax');

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

    const results = [];

    for (const file of skillFiles) {
      const skillSource = join(skillsSourceDir, file);
      const skillTarget = join(skillTargetDir, file);

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
        if (!existsSync(skillTargetDir)) {
          mkdirSync(skillTargetDir, { recursive: true });
        }

        const content = readFileSync(skillSource, 'utf8');
        writeFileSync(skillTarget, content, 'utf8');
        results.push({ file, action, versionInfo });
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
