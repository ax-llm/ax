import { isDeepStrictEqual } from 'node:util';

import {
  isPortableTsPath,
  portableSurfaceForPath,
  validateLedger,
} from './axir-backlog.mjs';

export const POLICY_STATUS_CONTEXT = 'External Contribution Policy';
export const POLICY_COMMENT_MARKER = '<!-- ax-external-contribution-policy -->';
export const BACKLOG_PATH = 'ir/axir-backlog.json';
export const BACKLOG_DOC_PATH = 'docs/AXIR_BACKLOG.md';
export const MAX_PR_FILES = 3000;
export const MAX_LEDGER_BYTES = 1024 * 1024;

const trustedAssociations = new Set(['OWNER', 'MEMBER']);
const typescriptExtensions = ['.ts', '.tsx', '.mts', '.cts'];
const generatedLanguageRoots = [
  'packages/python/',
  'packages/java/',
  'packages/cpp/',
  'packages/go/',
  'packages/rust/',
  'src/examples/python/',
  'src/examples/java/',
  'src/examples/cpp/',
  'src/examples/go/',
  'src/examples/rust/',
  'website/static/python/',
  'website/static/java/',
  'website/static/cpp/',
  'website/static/go/',
  'website/static/rust/',
];
const protectedRoots = [
  'ir/',
  'tools/axir/',
  'src/examples/.generated/',
  'website/.generated/',
  'website/public/',
  ...generatedLanguageRoots,
];
const protectedFiles = new Set([
  'index.ts',
  'src/ax/index.ts',
  'scripts/generateIndex.ts',
]);

function normalizePath(filePath) {
  return String(filePath).replace(/^\.\//, '');
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
}

function isSafeRepositoryPath(filePath) {
  if (
    typeof filePath !== 'string' ||
    filePath.length === 0 ||
    filePath.length > 4096 ||
    filePath.startsWith('/') ||
    filePath.includes('\\') ||
    hasControlCharacters(filePath)
  ) {
    return false;
  }
  return !filePath.split('/').some((segment) => segment === '..');
}

function isTypeScriptPath(filePath) {
  return typescriptExtensions.some((extension) => filePath.endsWith(extension));
}

function isGeneratedTypeScriptPath(filePath) {
  if (!isTypeScriptPath(filePath)) return false;
  const basename = filePath.split('/').at(-1) ?? '';
  return (
    basename.includes('.generated.') ||
    filePath.split('/').includes('.generated')
  );
}

export function isTrustedAssociation(association) {
  return trustedAssociations.has(String(association));
}

export function isTrustedAuthor({ association, login, type } = {}) {
  const normalizedLogin = String(login ?? '').toLowerCase();
  if (type === 'Bot' || normalizedLogin.endsWith('[bot]')) return false;
  return isTrustedAssociation(association);
}

function pullRequestAuthorMetadata({ context, pull, prNumber }) {
  const eventPull =
    context.eventName === 'pull_request_target'
      ? context.payload.pull_request
      : undefined;
  const eventNumber = Number(context.payload.number ?? eventPull?.number);
  if (
    eventPull &&
    eventNumber === prNumber &&
    eventPull.head?.sha === pull.head.sha
  ) {
    return {
      association: eventPull.author_association,
      login: eventPull.user?.login,
      type: eventPull.user?.type,
      source: 'signed pull_request_target event',
    };
  }
  return {
    association: pull.author_association,
    login: pull.user?.login,
    type: pull.user?.type,
    source: 'pull request API',
  };
}

export function classifyExternalPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!isSafeRepositoryPath(normalized)) {
    return { allowed: false, path: normalized, reason: 'unsafe path' };
  }
  if (normalized === BACKLOG_PATH || normalized === BACKLOG_DOC_PATH) {
    return { allowed: true, path: normalized };
  }
  if (protectedFiles.has(normalized)) {
    return {
      allowed: false,
      path: normalized,
      reason: 'generated or generator-maintenance file',
    };
  }
  if (protectedRoots.some((root) => normalized.startsWith(root))) {
    return {
      allowed: false,
      path: normalized,
      reason: 'AxIR or generated-language surface',
    };
  }
  if (isGeneratedTypeScriptPath(normalized)) {
    return {
      allowed: false,
      path: normalized,
      reason: 'generated TypeScript file',
    };
  }
  if (!isTypeScriptPath(normalized)) {
    return {
      allowed: false,
      path: normalized,
      reason: 'external PRs may change only handwritten TypeScript',
    };
  }
  return { allowed: true, path: normalized };
}

function filePaths(file) {
  const paths = [file?.filename];
  if (file?.previous_filename) paths.push(file.previous_filename);
  return paths.filter((item) => typeof item === 'string');
}

export function evaluateChangedFiles({ files, changedFilesCount }) {
  const violations = [];
  if (!Number.isInteger(changedFilesCount) || changedFilesCount < 0) {
    violations.push({
      code: 'incomplete-file-list',
      message: 'GitHub did not provide a valid changed-file count.',
    });
  } else if (changedFilesCount > MAX_PR_FILES) {
    violations.push({
      code: 'file-limit',
      message: `PR changes ${changedFilesCount} files; the policy fails closed above GitHub's ${MAX_PR_FILES}-file API limit.`,
    });
  } else if (!Array.isArray(files) || files.length !== changedFilesCount) {
    violations.push({
      code: 'incomplete-file-list',
      message: `GitHub reported ${changedFilesCount} changed files but the policy received ${Array.isArray(files) ? files.length : 0}.`,
    });
  }

  const allPaths = [];
  for (const file of Array.isArray(files) ? files : []) {
    const paths = filePaths(file);
    if (paths.length === 0) {
      violations.push({
        code: 'missing-file-path',
        message: 'A changed file did not include a filename.',
      });
      continue;
    }
    for (const filePath of paths) {
      const classification = classifyExternalPath(filePath);
      allPaths.push(classification.path);
      if (!classification.allowed) {
        violations.push({
          code: 'forbidden-path',
          path: classification.path,
          message: classification.reason,
        });
      }
    }
  }

  const uniquePaths = [...new Set(allPaths)].sort();
  const portablePaths = uniquePaths.filter((filePath) => {
    const classification = classifyExternalPath(filePath);
    return classification.allowed && isPortableTsPath(filePath);
  });
  return {
    violations,
    allPaths: uniquePaths,
    portablePaths,
    backlogChanged: uniquePaths.includes(BACKLOG_PATH),
    backlogDocChanged: uniquePaths.includes(BACKLOG_DOC_PATH),
  };
}

export function parseLedgerText(content, label = 'ledger') {
  if (typeof content !== 'string') {
    return { ok: false, error: `${label} content is not text.` };
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_LEDGER_BYTES) {
    return {
      ok: false,
      error: `${label} exceeds the ${MAX_LEDGER_BYTES}-byte policy limit.`,
    };
  }
  try {
    const ledger = JSON.parse(content);
    validateLedger(ledger);
    return { ok: true, ledger };
  } catch (error) {
    return {
      ok: false,
      error: `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function entryMap(entries) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function immutableLedgerMetadata(ledger) {
  const { entries: _entries, ...metadata } = ledger;
  return metadata;
}

export function evaluateBacklogDelta({
  baseLedger,
  headLedger,
  prNumber,
  portablePaths,
}) {
  const violations = [];
  const expectedPaths = new Set(portablePaths.map(normalizePath));

  if (
    !isDeepStrictEqual(
      immutableLedgerMetadata(baseLedger),
      immutableLedgerMetadata(headLedger)
    )
  ) {
    violations.push({
      code: 'backlog-metadata-change',
      message:
        'Existing backlog schema, exemptions, and top-level metadata are maintainer-owned and must not change.',
    });
  }

  const baseEntries = entryMap(baseLedger.entries);
  const headEntries = entryMap(headLedger.entries);
  for (const [id, baseEntry] of baseEntries) {
    const headEntry = headEntries.get(id);
    if (!headEntry) {
      violations.push({
        code: 'backlog-entry-removed',
        message: `Existing backlog entry ${id} was removed.`,
      });
    } else if (!isDeepStrictEqual(baseEntry, headEntry)) {
      violations.push({
        code: 'backlog-entry-modified',
        message: `Existing backlog entry ${id} was modified.`,
      });
    }
  }

  const newEntries = headLedger.entries.filter(
    (entry) => !baseEntries.has(entry.id)
  );
  if (expectedPaths.size === 0) {
    violations.push({
      code: 'backlog-without-portable-ts',
      message:
        'Backlog files may change only when the same PR changes portable handwritten TypeScript.',
    });
  }
  if (newEntries.length === 0) {
    violations.push({
      code: 'missing-backlog-entry',
      message:
        'Portable TypeScript changes require a new open backlog entry tied to this PR.',
    });
  }

  const coveredPaths = new Set();
  for (const entry of newEntries) {
    if (entry.status !== 'open') {
      violations.push({
        code: 'new-entry-not-open',
        message: `New backlog entry ${entry.id} must have status open.`,
      });
    }
    if (entry.sourcePR !== prNumber) {
      violations.push({
        code: 'wrong-source-pr',
        message: `New backlog entry ${entry.id} must set sourcePR to ${prNumber}.`,
      });
    }
    for (const field of ['completedAt', 'completedByCommit', 'verification']) {
      if (entry[field] !== null) {
        violations.push({
          code: 'new-entry-completion-data',
          message: `New open backlog entry ${entry.id} must leave ${field} null.`,
        });
      }
    }

    const entryPaths = entry.tsPaths.map(normalizePath);
    if (new Set(entryPaths).size !== entryPaths.length) {
      violations.push({
        code: 'duplicate-entry-path',
        message: `New backlog entry ${entry.id} contains duplicate tsPaths.`,
      });
    }
    const surfaces = new Set();
    for (const filePath of entryPaths) {
      if (!expectedPaths.has(filePath)) {
        violations.push({
          code: 'broad-backlog-path',
          path: filePath,
          message: `New backlog entry ${entry.id} may list only exact portable TypeScript files changed by this PR.`,
        });
        continue;
      }
      coveredPaths.add(filePath);
      const surface = portableSurfaceForPath(filePath);
      if (surface) surfaces.add(surface);
    }
    if (surfaces.size !== 1 || !surfaces.has(entry.portableSurface)) {
      violations.push({
        code: 'wrong-portable-surface',
        message: `New backlog entry ${entry.id} must contain files from exactly its declared portable surface.`,
      });
    }
  }

  for (const filePath of expectedPaths) {
    if (!coveredPaths.has(filePath)) {
      violations.push({
        code: 'uncovered-portable-path',
        path: filePath,
        message:
          'Portable TypeScript file is not covered by a new PR-bound entry.',
      });
    }
  }
  return violations;
}

export function evaluateExternalContribution({
  association,
  authorLogin,
  authorType,
  files = [],
  changedFilesCount = files.length,
  prNumber,
  baseLedger,
  headLedger,
}) {
  if (
    isTrustedAuthor({
      association,
      login: authorLogin,
      type: authorType,
    })
  ) {
    return {
      ok: true,
      trusted: true,
      violations: [],
      portablePaths: [],
    };
  }

  const fileResult = evaluateChangedFiles({ files, changedFilesCount });
  const violations = [...fileResult.violations];
  const backlogPairChanged =
    fileResult.backlogChanged && fileResult.backlogDocChanged;

  if (fileResult.backlogChanged !== fileResult.backlogDocChanged) {
    violations.push({
      code: 'incomplete-backlog-pair',
      message: `${BACKLOG_PATH} and ${BACKLOG_DOC_PATH} must change together.`,
    });
  }
  if (fileResult.portablePaths.length > 0 && !backlogPairChanged) {
    violations.push({
      code: 'missing-backlog-pair',
      message:
        'Portable TypeScript changes require both the backlog JSON and its rendered Markdown.',
    });
  }
  if (backlogPairChanged) {
    if (!baseLedger || !headLedger) {
      violations.push({
        code: 'unreadable-backlog',
        message:
          'The policy could not read both base and head backlog ledgers.',
      });
    } else {
      violations.push(
        ...evaluateBacklogDelta({
          baseLedger,
          headLedger,
          prNumber,
          portablePaths: fileResult.portablePaths,
        })
      );
    }
  }

  return {
    ok: violations.length === 0,
    trusted: false,
    violations,
    portablePaths: fileResult.portablePaths,
  };
}

function escapeHtml(value) {
  return [...String(value)]
    .map((character) => (hasControlCharacters(character) ? '?' : character))
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function violationLine(violation) {
  const path = violation.path
    ? ` <code>${escapeHtml(violation.path)}</code>`
    : '';
  return `- ${escapeHtml(violation.message)}${path}`;
}

export function buildPolicyComment({ result, prNumber }) {
  if (result.ok) {
    return `${POLICY_COMMENT_MARKER}\n\n## External contribution policy\n\n✅ This PR now complies with the external contribution policy.`;
  }
  const displayed = result.violations.slice(0, 60);
  const remainder = result.violations.length - displayed.length;
  const lines = displayed.map(violationLine);
  if (remainder > 0) lines.push(`- …and ${remainder} more violations.`);
  return `${POLICY_COMMENT_MARKER}

## External contribution policy

This PR is blocked because outside contributors may submit only handwritten TypeScript plus a new PR-bound AxIR backlog entry.

${lines.join('\n')}

For portable TypeScript changes, add exact changed files with:

\`\`\`bash
npm run axir:backlog -- add --title "Describe the portable behavior" --surface <surface> --impact "Describe generated-language drift" --paths <exact-ts-files> --pr ${prNumber}
\`\`\`

Do not run AxIR generation or commit Python, Java, C++, Go, Rust, generated TypeScript, generated examples, or generated website files. A maintainer must recreate any needed generated changes on a member-owned branch.`;
}

async function publishStatus({
  github,
  owner,
  repo,
  sha,
  state,
  description,
  targetUrl,
}) {
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: POLICY_STATUS_CONTEXT,
    description: description.slice(0, 140),
    target_url: targetUrl,
  });
}

async function readRepositoryFile({ github, owner, repo, filePath, ref }) {
  const response = await github.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref,
  });
  if (Array.isArray(response.data) || response.data.type !== 'file') {
    throw new Error(`${owner}/${repo}:${filePath} is not a file.`);
  }
  if (response.data.size > MAX_LEDGER_BYTES || !response.data.content) {
    throw new Error(
      `${owner}/${repo}:${filePath} is unavailable or too large.`
    );
  }
  return Buffer.from(response.data.content, 'base64').toString('utf8');
}

async function upsertPolicyComment({
  github,
  owner,
  repo,
  issueNumber,
  body,
  createIfMissing,
}) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) =>
      comment.user?.login === 'github-actions[bot]' &&
      comment.body?.includes(POLICY_COMMENT_MARKER)
  );
  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else if (createIfMissing) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }
}

function actionsRunUrl(owner, repo) {
  return `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
}

export async function runExternalContributionPolicy({
  github,
  context,
  core,
  prNumber,
}) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }

  const pull = (
    await github.rest.pulls.get({ owner, repo, pull_number: number })
  ).data;
  const author = pullRequestAuthorMetadata({ context, pull, prNumber: number });
  const trusted = isTrustedAuthor(author);
  core.info(
    `PR #${number} author metadata (${author.source}): login=${author.login ?? 'unknown'}, type=${author.type ?? 'unknown'}, association=${author.association ?? 'unknown'}, trusted=${trusted}.`
  );
  const headSha = pull.head.sha;
  const targetUrl = actionsRunUrl(owner, repo);
  await publishStatus({
    github,
    owner,
    repo,
    sha: headSha,
    state: 'pending',
    description: 'Evaluating external contribution policy',
    targetUrl,
  });

  try {
    const defaultBranch = context.payload.repository?.default_branch ?? 'main';
    if (pull.base.ref !== defaultBranch) {
      throw new Error(
        `PR #${number} targets ${pull.base.ref}, not ${defaultBranch}.`
      );
    }

    let files = [];
    if (!trusted) {
      if (pull.changed_files <= MAX_PR_FILES) {
        files = await github.paginate(github.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: number,
          per_page: 100,
        });
      }
    }

    const filePreview = trusted
      ? { backlogChanged: false, portablePaths: [] }
      : evaluateChangedFiles({
          files,
          changedFilesCount: pull.changed_files,
        });
    let baseLedger;
    let headLedger;
    if (
      !trusted &&
      filePreview.backlogChanged &&
      filePreview.backlogDocChanged
    ) {
      const baseText = await readRepositoryFile({
        github,
        owner: pull.base.repo.owner.login,
        repo: pull.base.repo.name,
        filePath: BACKLOG_PATH,
        ref: pull.base.sha,
      });
      const baseParsed = parseLedgerText(baseText, 'base backlog');
      if (!baseParsed.ok) throw new Error(baseParsed.error);
      baseLedger = baseParsed.ledger;

      if (!pull.head.repo) {
        throw new Error('The PR head repository is unavailable.');
      }
      try {
        const headText = await readRepositoryFile({
          github,
          owner: pull.head.repo.owner.login,
          repo: pull.head.repo.name,
          filePath: BACKLOG_PATH,
          ref: headSha,
        });
        const headParsed = parseLedgerText(headText, 'head backlog');
        if (headParsed.ok) headLedger = headParsed.ledger;
      } catch (error) {
        core.info(
          `Unable to read head backlog as policy data: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const result = evaluateExternalContribution({
      association: author.association,
      authorLogin: author.login,
      authorType: author.type,
      files,
      changedFilesCount: pull.changed_files,
      prNumber: number,
      baseLedger,
      headLedger,
    });
    await publishStatus({
      github,
      owner,
      repo,
      sha: headSha,
      state: result.ok ? 'success' : 'failure',
      description: result.ok
        ? result.trusted
          ? 'Trusted organization member'
          : 'External contribution policy passed'
        : `${result.violations.length} policy violation${result.violations.length === 1 ? '' : 's'}`,
      targetUrl,
    });
    await upsertPolicyComment({
      github,
      owner,
      repo,
      issueNumber: number,
      body: buildPolicyComment({ result, prNumber: number }),
      createIfMissing: !result.ok,
    });
    core.info(
      result.ok
        ? `PR #${number} passed the contribution policy.`
        : `PR #${number} was blocked by ${result.violations.length} policy violations.`
    );
    return result;
  } catch (error) {
    await publishStatus({
      github,
      owner,
      repo,
      sha: headSha,
      state: 'error',
      description: 'Contribution policy could not be evaluated',
      targetUrl,
    });
    throw error;
  }
}
