#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const mainBranch = 'main';
const releaseManifests = [
  'package.json',
  'src/ax/package.json',
  'src/aisdk/package.json',
  'src/aws-bedrock/package.json',
  'src/tools/package.json',
];
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseSubjectPattern =
  /^chore: release v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?: \(#\d+\))?$/;
const publicationWorkflows = [
  { file: 'npm-publish.yml', fields: [] },
  {
    file: 'package-publish.yml',
    fields: ['--raw-field', 'dry_run=false'],
  },
];

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
  }).trim();
}

function run(command, args) {
  console.log(`\n> ${commandText(command, args)}`);
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function attempt(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fail(message) {
  throw new Error(message);
}

function git(...args) {
  return capture('git', args);
}

function assertClean() {
  const status = git('status', '--porcelain');
  if (status) fail(`Working tree must be clean before release:\n${status}`);
}

function assertBranch(expected) {
  const branch = git('branch', '--show-current');
  if (branch !== expected) {
    fail(
      `Release command must run on ${expected}; current branch is ${branch || '(detached)'}.`
    );
  }
}

export function readReleaseVersions(root = repoRoot) {
  return Object.fromEntries(
    releaseManifests.map((file) => {
      const manifest = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
      return [file, manifest.version];
    })
  );
}

function readReleaseVersionsAt(ref) {
  return Object.fromEntries(
    releaseManifests.map((file) => {
      const manifest = JSON.parse(git('show', `${ref}:${file}`));
      return [file, manifest.version];
    })
  );
}

export function assertAlignedReleaseVersions(versions) {
  const entries = Object.entries(versions);
  const unique = new Set(entries.map(([, version]) => version));
  if (unique.size !== 1) {
    fail(
      `Release package versions are not aligned:\n${entries
        .map(([file, version]) => `- ${file}: ${version}`)
        .join('\n')}`
    );
  }
  return entries[0][1];
}

function parseStableVersion(version, label = 'version') {
  const match = stableVersionPattern.exec(version);
  if (!match) {
    fail(
      `${label} must be a stable semantic version (for example 24.0.6); received ${version}.`
    );
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function resolveReleaseVersion(currentVersion, increment = 'patch') {
  const current = parseStableVersion(currentVersion, 'current package version');
  let next;
  if (stableVersionPattern.test(increment)) {
    next = parseStableVersion(increment, 'requested release version');
  } else if (increment === 'major') {
    next = [current[0] + 1, 0, 0];
  } else if (increment === 'minor') {
    next = [current[0], current[1] + 1, 0];
  } else if (increment === 'patch') {
    next = [current[0], current[1], current[2] + 1];
  } else {
    fail(
      'Release increment must be patch, minor, major, or an exact stable version.'
    );
  }
  if (compareVersions(next, current) <= 0) {
    fail(
      `Release version ${next.join('.')} must be newer than ${currentVersion}.`
    );
  }
  return next.join('.');
}

export function releaseBranchName(version) {
  parseStableVersion(version, 'release version');
  return `codex/release-${version.replaceAll('.', '-')}`;
}

export function releaseVersionFromSubject(subject) {
  return releaseSubjectPattern.exec(subject)?.[1] || null;
}

export function selectReleaseCommit(version, commits) {
  parseStableVersion(version, 'release version');
  const matches = commits.filter(
    ({ subject }) => releaseVersionFromSubject(subject) === version
  );
  if (matches.length === 0) {
    fail(`Release ${version} is not present in origin/${mainBranch} history.`);
  }
  if (matches.length > 1) {
    fail(
      `Release ${version} has multiple commits in origin/${mainBranch} history:\n${matches
        .map(({ sha }) => `- ${sha}`)
        .join('\n')}`
    );
  }
  return matches[0].sha;
}

function localRefExists(ref) {
  return attempt('git', ['show-ref', '--verify', '--quiet', ref]).status === 0;
}

function remoteRefs(...refs) {
  return capture('git', ['ls-remote', 'origin', ...refs], { quiet: true });
}

export function parseRemoteTagTarget(output, version) {
  const refs = new Map(
    output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.trim().split(/\s+/, 2);
        return [ref, sha];
      })
  );
  return (
    refs.get(`refs/tags/${version}^{}`) ||
    refs.get(`refs/tags/${version}`) ||
    null
  );
}

function remoteTagTarget(version) {
  return parseRemoteTagTarget(
    remoteRefs(`refs/tags/${version}`, `refs/tags/${version}^{}`),
    version
  );
}

function releaseCommitOnMain(version) {
  const commits = git('log', `origin/${mainBranch}`, '--format=%H%x00%s')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\0');
      return {
        sha: line.slice(0, separator),
        subject: line.slice(separator + 1),
      };
    });
  return selectReleaseCommit(version, commits);
}

function assertRefAvailable(version, branch) {
  if (localRefExists(`refs/tags/${version}`)) {
    fail(
      `Local tag ${version} already exists. Do not rerun a prepared release.`
    );
  }
  if (localRefExists(`refs/heads/${branch}`)) {
    fail(
      `Local release branch ${branch} already exists. Resume that release instead.`
    );
  }
  const remote = remoteRefs(
    `refs/heads/${branch}`,
    `refs/tags/${version}`,
    `refs/tags/${version}^{}`
  );
  if (remote) fail(`Remote release ref already exists:\n${remote}`);
}

function assertMainSynchronized() {
  run('git', ['fetch', '--prune', 'origin', mainBranch]);
  const head = git('rev-parse', 'HEAD');
  const remoteHead = git('rev-parse', `origin/${mainBranch}`);
  if (head !== remoteHead) {
    fail(
      `Local ${mainBranch} (${head}) must exactly match origin/${mainBranch} (${remoteHead}).`
    );
  }
  return head;
}

function verifyPreparedRelease(version, branch) {
  assertClean();
  assertBranch(branch);
  const aligned = assertAlignedReleaseVersions(readReleaseVersions());
  if (aligned !== version)
    fail(`Prepared package version is ${aligned}; expected ${version}.`);
  const subject = git('log', '-1', '--format=%s');
  if (subject !== `chore: release v${version}`) {
    fail(
      `Prepared commit subject is ${JSON.stringify(subject)}; expected chore: release v${version}.`
    );
  }
  run('npm', ['run', 'axir:check-packages']);
  run('npm', ['run', 'build']);
  run('git', ['diff', '--check', `origin/${mainBranch}...HEAD`]);
}

function releasePullRequestBody(version) {
  return [
    `## Release ${version}`,
    '',
    'This PR was prepared by the protected-main release workflow.',
    '',
    '- aligns all publishable package versions',
    '- regenerates the checked-in AxIR packages',
    '- updates the changelog',
    '- creates no tag or GitHub Release before merge',
    '',
    'After merge, successful main-branch CI publishes this release automatically.',
    'If that automation needs recovery, publish with:',
    '',
    '```sh',
    `npm run release:publish -- ${version}`,
    '```',
  ].join('\n');
}

export function parseReleaseArguments(argv) {
  const [mode = 'prepare', value, ...rest] = argv;
  if (
    !['prepare', 'publish', 'publish-merged'].includes(mode) ||
    rest.length > 0
  ) {
    fail(
      'Usage: release.mjs prepare [patch|minor|major|VERSION] | publish [VERSION] | publish-merged SHA'
    );
  }
  if (mode === 'publish-merged' && !value)
    fail('publish-merged requires a SHA.');
  return { mode, value };
}

export function publishFetchArguments() {
  return ['fetch', '--prune', 'origin', mainBranch];
}

function prepare(increment = 'patch') {
  assertClean();
  assertBranch(mainBranch);
  const currentVersion = assertAlignedReleaseVersions(readReleaseVersions());
  const version = resolveReleaseVersion(currentVersion, increment);
  const branch = releaseBranchName(version);
  assertMainSynchronized();
  assertRefAvailable(version, branch);

  run('git', ['switch', '--create', branch]);
  run('npm', [
    'run',
    'release',
    '--workspaces',
    '--if-present',
    '--',
    version,
    '--ci',
  ]);
  run('npm', ['run', 'axir:generate-packages']);
  run('npm', ['exec', '--', 'release-it', '--no-increment', '--ci']);
  verifyPreparedRelease(version, branch);

  run('git', ['push', '--set-upstream', 'origin', branch]);
  const url = capture('gh', [
    'pr',
    'create',
    '--base',
    mainBranch,
    '--head',
    branch,
    '--title',
    `chore: release v${version}`,
    '--body',
    releasePullRequestBody(version),
  ]);
  console.log(`\nRelease ${version} prepared: ${url}`);
  console.log(
    `After it merges, successful main-branch CI will publish ${version} automatically.`
  );
}

function githubReleaseExists(version) {
  const result = attempt('gh', ['release', 'view', version]);
  if (result.status === 0) return true;
  if (/release not found/i.test(result.stderr)) return false;
  fail(`Could not check GitHub Release ${version}:\n${result.stderr.trim()}`);
}

function associatedMergedPullRequest(head) {
  const repo = capture('gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]);
  const pulls = JSON.parse(
    capture('gh', ['api', `repos/${repo}/commits/${head}/pulls`])
  );
  const pull = pulls.find(
    (candidate) => candidate.merged_at && candidate.base?.ref === mainBranch
  );
  if (!pull)
    fail(
      `Commit ${head} is not associated with a merged pull request to ${mainBranch}.`
    );
  return pull;
}

function recreateLocalTag(version, head) {
  if (localRefExists(`refs/tags/${version}`)) {
    const currentTarget = git('rev-parse', `${version}^{}`);
    if (currentTarget === head) return;
    run('git', ['tag', '--delete', version]);
  }
  run('git', [
    'tag',
    '--annotate',
    version,
    '--message',
    `Release ${version}`,
    head,
  ]);
}

function assertReleaseCommit(version, head) {
  const subject = git('log', '-1', '--format=%s', head);
  const subjectVersion = releaseVersionFromSubject(subject);
  if (subjectVersion !== version) {
    fail(`Commit ${head} is not the ${version} release commit: ${subject}`);
  }
  const aligned = assertAlignedReleaseVersions(readReleaseVersionsAt(head));
  if (aligned !== version) {
    fail(`Package version at ${head} is ${aligned}; expected ${version}.`);
  }
}

function ensureRelease(version, head) {
  const existingRemoteTagTarget = remoteTagTarget(version);
  if (existingRemoteTagTarget && existingRemoteTagTarget !== head) {
    fail(
      `Remote tag ${version} points to ${existingRemoteTagTarget}; expected ${head}.`
    );
  }

  const pull = associatedMergedPullRequest(head);
  run('gh', ['pr', 'checks', String(pull.number), '--required']);
  recreateLocalTag(version, head);
  if (!existingRemoteTagTarget) {
    run('git', ['push', 'origin', `refs/tags/${version}`]);
  }
  if (!githubReleaseExists(version)) {
    run('gh', [
      'release',
      'create',
      version,
      '--verify-tag',
      '--title',
      `Release ${version}`,
      '--generate-notes',
    ]);
  }

  const publishedTagTarget = remoteTagTarget(version);
  if (publishedTagTarget !== head) {
    fail(
      `Remote tag ${version} points to ${publishedTagTarget || '(missing)'}; expected ${head}.`
    );
  }
  run('gh', ['release', 'view', version]);
}

function publicationRuns(workflow, head) {
  return JSON.parse(
    capture(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        workflow,
        '--commit',
        head,
        '--limit',
        '20',
        '--json',
        'databaseId,status,conclusion,event,url',
      ],
      { quiet: true }
    )
  );
}

function dispatchPublicationWorkflows(version, head) {
  for (const { file, fields } of publicationWorkflows) {
    const existing = publicationRuns(file, head);
    if (existing.length > 0) {
      console.log(
        `Publication workflow ${file} already has a run for ${head}; skipping duplicate dispatch.`
      );
      continue;
    }
    run('gh', ['workflow', 'run', file, '--ref', version, ...fields]);
  }
}

function publish(requestedVersion) {
  assertClean();
  assertBranch(mainBranch);
  // Remote tag identity is checked with ls-remote below. Fetching every tag can
  // fail when a checkout still has a pre-squash tag from an older release.
  run('git', publishFetchArguments());
  const currentHead = git('rev-parse', 'HEAD');
  const remoteHead = git('rev-parse', `origin/${mainBranch}`);
  if (currentHead !== remoteHead) {
    fail(
      `Local ${mainBranch} (${currentHead}) must exactly match origin/${mainBranch} (${remoteHead}).`
    );
  }

  const version =
    requestedVersion || assertAlignedReleaseVersions(readReleaseVersions());
  parseStableVersion(version, 'release version');
  const currentSubject = git('log', '-1', '--format=%s', currentHead);
  const head =
    releaseVersionFromSubject(currentSubject) === version
      ? currentHead
      : releaseCommitOnMain(version);
  assertReleaseCommit(version, head);
  ensureRelease(version, head);
  console.log(
    `\nRelease ${version} published from protected ${mainBranch} commit ${head}.`
  );
}

function publishMerged(head) {
  if (!/^[0-9a-f]{40}$/.test(head)) fail(`Invalid release commit SHA: ${head}`);
  const checkoutHead = git('rev-parse', 'HEAD');
  if (checkoutHead !== head) {
    fail(
      `Workflow checkout is ${checkoutHead}; expected release commit ${head}.`
    );
  }

  const subject = git('log', '-1', '--format=%s', head);
  const version = releaseVersionFromSubject(subject);
  if (!version) {
    console.log(`Commit ${head} is not a release commit; nothing to publish.`);
    return;
  }

  run('git', publishFetchArguments());
  const ancestry = attempt('git', [
    'merge-base',
    '--is-ancestor',
    head,
    `origin/${mainBranch}`,
  ]);
  if (ancestry.status !== 0) {
    fail(`Release commit ${head} is not contained in origin/${mainBranch}.`);
  }

  assertReleaseCommit(version, head);
  ensureRelease(version, head);
  dispatchPublicationWorkflows(version, head);
  console.log(
    `\nRelease ${version} automatically published from protected ${mainBranch} commit ${head}.`
  );
}

function main(argv) {
  const { mode, value } = parseReleaseArguments(argv);
  if (mode === 'prepare') prepare(value);
  else if (mode === 'publish') publish(value);
  else publishMerged(value);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`\nRelease failed safely: ${error.message}`);
    process.exitCode = 1;
  }
}
