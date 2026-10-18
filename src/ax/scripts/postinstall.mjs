#!/usr/bin/env node

// Register one entry-point skill with bundled guides. Specialist skills are
// available through the explicit setup command; package installation never
// adds them individually. Failures must never break dependency installation.
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoSkillInstallEnabled } from './skill-config.mjs';
import { installSkills } from './skill-install.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

if (!shouldSkip()) {
  try {
    const projectRoot = findProjectRoot();
    const installed = autoSkillInstallEnabled(projectRoot)
      ? installSkills(join(__dirname, '..'), projectRoot, {
          upgradeInstalled: true,
        })
      : [];
    if (installed.length > 0 && process.stdout.isTTY) {
      console.log(
        '✓ Ax skills updated; entry point includes local reference guides.'
      );
    }
  } catch {
    // Manual recovery: npx @ax-llm/ax setup-claude
  }
}
