import { describe, expect, it, vi } from 'vitest';

import {
  BACKLOG_DOC_PATH,
  BACKLOG_PATH,
  buildPolicyComment,
  classifyExternalPath,
  evaluateBacklogDelta,
  evaluateChangedFiles,
  evaluateExternalContribution,
  isTrustedAssociation,
  isTrustedAuthor,
  MAX_LEDGER_BYTES,
  POLICY_COMMENT_MARKER,
  parseLedgerText,
  runExternalContributionPolicy,
} from './external-contribution-policy.mjs';

function openEntry(overrides = {}) {
  return {
    id: 'axir-2026-08-20-external-change',
    status: 'open',
    title: 'External change',
    createdAt: '2026-08-20',
    sourcePR: 700,
    sourceCommit: 'abc123',
    tsPaths: ['src/ax/ai/openai/api.ts'],
    portableSurface: 'axai',
    impact: 'Generated providers need a later port.',
    suggestedAxirWork: [],
    completedAt: null,
    completedByCommit: null,
    verification: null,
    ...overrides,
  };
}

function ledger(entries = [], nonPortableExemptions = []) {
  return { schemaVersion: 2, entries, nonPortableExemptions };
}

function file(filename, previousFilename) {
  return {
    filename,
    ...(previousFilename ? { previous_filename: previousFilename } : {}),
  };
}

describe('external contribution trust boundary', () => {
  it.each(['OWNER', 'MEMBER'])('trusts %s', (association) => {
    expect(isTrustedAssociation(association)).toBe(true);
  });

  it.each([
    'COLLABORATOR',
    'CONTRIBUTOR',
    'FIRST_TIME_CONTRIBUTOR',
    'FIRST_TIMER',
    'NONE',
  ])('treats %s as external', (association) => {
    expect(isTrustedAssociation(association)).toBe(false);
  });

  it('does not trust Dependabot or other bots by name', () => {
    expect(
      isTrustedAuthor({
        association: 'MEMBER',
        login: 'dependabot[bot]',
        type: 'Bot',
      })
    ).toBe(false);
    expect(
      isTrustedAuthor({
        association: 'OWNER',
        login: 'renovate[bot]',
        type: 'Bot',
      })
    ).toBe(false);
  });
});

describe('external path policy', () => {
  it.each([
    'src/ax/ai/openai/api.ts',
    'src/ax/agent/agent.test.ts',
    'src/examples/typescript/short-agents/agent.ts',
    'src/aisdk/provider.tsx',
    'scripts/lib/helper.mts',
    BACKLOG_PATH,
    BACKLOG_DOC_PATH,
  ])('allows %s', (filePath) => {
    expect(classifyExternalPath(filePath).allowed).toBe(true);
  });

  it.each([
    'ir/axcore/provider.axir',
    'ir/conformance/axai/provider.json',
    'tools/axir/extractors/axai-goldens.ts',
    'packages/python/axllm/ai.py',
    'packages/java/dev/axllm/ax/Core.java',
    'packages/cpp/axllm/axllm.cpp',
    'packages/go/axllm.go',
    'packages/rust/src/lib.rs',
    'src/examples/python/generation.py',
    'src/examples/java/Generation.java',
    'src/examples/cpp/generation.cpp',
    'src/examples/go/generation.go',
    'src/examples/rust/generation.rs',
    'website/static/python/.well-known/agent-skills/ax-python-ai/SKILL.md',
    'website/public/index.html',
    'src/examples/.generated/go/axllm.go',
    'src/ax/ai/provider_profiles.generated.ts',
    'src/ax/agent/templates.generated.ts',
    'index.ts',
    'src/ax/index.ts',
    'scripts/generateIndex.ts',
    'README.md',
    'package.json',
    'package-lock.json',
    'scripts/website-academy.mjs',
    '.github/workflows/ci.yml',
  ])('rejects %s', (filePath) => {
    expect(classifyExternalPath(filePath).allowed).toBe(false);
  });

  it.each(['../escape.ts', '/absolute.ts', 'bad\\path.ts', 'bad\npath.ts'])(
    'rejects unsafe path %j',
    (filePath) => {
      expect(classifyExternalPath(filePath).allowed).toBe(false);
    }
  );

  it('checks both names of a rename', () => {
    const result = evaluateChangedFiles({
      files: [file('src/ax/new.ts', 'packages/go/old.ts')],
      changedFilesCount: 1,
    });
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-path',
          path: 'packages/go/old.ts',
        }),
      ])
    );
  });

  it.each(['added', 'modified', 'removed'])(
    'applies the same path policy to %s files',
    (status) => {
      const result = evaluateChangedFiles({
        files: [{ ...file('packages/python/axllm/ai.py'), status }],
        changedFilesCount: 1,
      });
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'forbidden-path' }),
        ])
      );
    }
  );

  it('fails closed for incomplete and oversized file lists', () => {
    expect(
      evaluateChangedFiles({ files: [], changedFilesCount: 1 }).violations
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'incomplete-file-list' }),
      ])
    );
    expect(
      evaluateChangedFiles({ files: [], changedFilesCount: 3001 }).violations
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'file-limit' })])
    );
  });
});

describe('external backlog integrity', () => {
  const changedPath = 'src/ax/ai/openai/api.ts';
  const base = ledger();

  it('accepts a new open entry bound to the PR and exact changed path', () => {
    expect(
      evaluateBacklogDelta({
        baseLedger: base,
        headLedger: ledger([openEntry()]),
        prNumber: 700,
        portablePaths: [changedPath],
      })
    ).toEqual([]);
  });

  it.each([
    ['wrong source PR', openEntry({ sourcePR: 701 }), 'wrong-source-pr'],
    ['completed entry', openEntry({ status: 'done' }), 'new-entry-not-open'],
    ['broad path', openEntry({ tsPaths: ['src/ax/ai'] }), 'broad-backlog-path'],
    [
      'wrong surface',
      openEntry({ portableSurface: 'axagent' }),
      'wrong-portable-surface',
    ],
    [
      'completion data',
      openEntry({ verification: 'npm test' }),
      'new-entry-completion-data',
    ],
  ])('rejects %s', (_name, entry, code) => {
    expect(
      evaluateBacklogDelta({
        baseLedger: base,
        headLedger: ledger([entry]),
        prNumber: 700,
        portablePaths: [changedPath],
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('rejects modification or removal of existing entries', () => {
    const existing = openEntry({ id: 'existing', sourcePR: 699 });
    expect(
      evaluateBacklogDelta({
        baseLedger: ledger([existing]),
        headLedger: ledger([{ ...existing, title: 'Rewritten' }]),
        prNumber: 700,
        portablePaths: [changedPath],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'backlog-entry-modified' }),
      ])
    );
    expect(
      evaluateBacklogDelta({
        baseLedger: ledger([existing]),
        headLedger: ledger(),
        prNumber: 700,
        portablePaths: [changedPath],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'backlog-entry-removed' }),
      ])
    );
  });

  it('rejects exemption and schema metadata changes', () => {
    const exemption = {
      id: 'browser-only',
      surface: 'axai',
      reason: 'Host runtime',
      paths: ['src/ax/ai/browser'],
      scopedFiles: [],
      tags: ['browser-only'],
      createdAt: '2026-08-20',
    };
    expect(
      evaluateBacklogDelta({
        baseLedger: ledger([], [exemption]),
        headLedger: ledger([], [{ ...exemption, reason: 'Changed' }]),
        prNumber: 700,
        portablePaths: [changedPath],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'backlog-metadata-change' }),
      ])
    );
  });

  it('rejects an uncovered portable file', () => {
    expect(
      evaluateBacklogDelta({
        baseLedger: base,
        headLedger: ledger([openEntry()]),
        prNumber: 700,
        portablePaths: [changedPath, 'src/ax/ai/openai/types.ts'],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'uncovered-portable-path' }),
      ])
    );
  });

  it('requires the backlog pair for portable TypeScript', () => {
    const result = evaluateExternalContribution({
      association: 'CONTRIBUTOR',
      files: [file(changedPath)],
      changedFilesCount: 1,
      prNumber: 700,
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-backlog-pair' }),
      ])
    );
  });

  it('rejects malformed and oversized ledgers without executing them', () => {
    expect(parseLedgerText('{', 'head backlog')).toEqual(
      expect.objectContaining({ ok: false })
    );
    expect(parseLedgerText('x'.repeat(MAX_LEDGER_BYTES + 1))).toEqual(
      expect.objectContaining({ ok: false })
    );
  });
});

describe('policy comments and runner', () => {
  it('uses one stable marker and escapes hostile filenames', () => {
    const body = buildPolicyComment({
      result: {
        ok: false,
        violations: [
          {
            message: 'Forbidden',
            path: '</code>\n@maintainers',
          },
        ],
      },
      prNumber: 700,
    });
    expect(body.match(new RegExp(POLICY_COMMENT_MARKER, 'g'))).toHaveLength(1);
    expect(body).toContain('&lt;/code&gt;?@maintainers');
  });

  it('updates an existing policy comment when a PR becomes compliant', async () => {
    const existingComment = {
      id: 41,
      body: `${POLICY_COMMENT_MARKER}\nblocked`,
      user: { login: 'github-actions[bot]' },
    };
    const { github, statusCalls, updateComment, createComment } = githubMock({
      pull: pullFixture(),
      files: [file('src/aisdk/provider.ts')],
      comments: [existingComment],
    });
    const result = await runExternalContributionPolicy({
      github,
      context: contextFixture(),
      core: { info: vi.fn() },
      prNumber: 700,
    });
    expect(result.ok).toBe(true);
    expect(statusCalls.map((call) => call.state)).toEqual([
      'pending',
      'success',
    ]);
    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 41 })
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it('creates one explanatory comment and a failure status for violations', async () => {
    const { github, statusCalls, updateComment, createComment } = githubMock({
      pull: pullFixture(),
      files: [file('packages/go/axllm.go')],
      comments: [],
    });
    const result = await runExternalContributionPolicy({
      github,
      context: contextFixture(),
      core: { info: vi.fn() },
      prNumber: 700,
    });
    expect(result.ok).toBe(false);
    expect(statusCalls.map((call) => call.state)).toEqual([
      'pending',
      'failure',
    ]);
    expect(createComment).toHaveBeenCalledOnce();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it('updates rather than duplicates an existing failure comment', async () => {
    const existingComment = {
      id: 42,
      body: `${POLICY_COMMENT_MARKER}\nold failure`,
      user: { login: 'github-actions[bot]' },
    };
    const { github, updateComment, createComment } = githubMock({
      pull: pullFixture(),
      files: [file('packages/rust/src/lib.rs')],
      comments: [existingComment],
    });
    await runExternalContributionPolicy({
      github,
      context: contextFixture(),
      core: { info: vi.fn() },
      prNumber: 700,
    });
    expect(updateComment).toHaveBeenCalledOnce();
    expect(createComment).not.toHaveBeenCalled();
  });

  it('trusts a member without reading contributor files', async () => {
    const pull = pullFixture({
      author_association: 'MEMBER',
      changed_files: 99,
    });
    const mocks = githubMock({ pull, files: [], comments: [] });
    const result = await runExternalContributionPolicy({
      github: mocks.github,
      context: contextFixture(),
      core: { info: vi.fn() },
      prNumber: 700,
    });
    expect(result).toEqual(
      expect.objectContaining({ ok: true, trusted: true })
    );
    expect(mocks.paginate).toHaveBeenCalledOnce();
    expect(mocks.statusCalls.map((call) => call.state)).toEqual([
      'pending',
      'success',
    ]);
  });

  it('treats a bot with a member association as external', async () => {
    const pull = pullFixture({
      author_association: 'MEMBER',
      user: { login: 'release[bot]', type: 'Bot' },
    });
    const mocks = githubMock({
      pull,
      files: [file('packages/go/axllm.go')],
      comments: [],
    });
    const result = await runExternalContributionPolicy({
      github: mocks.github,
      context: contextFixture(),
      core: { info: vi.fn() },
      prNumber: 700,
    });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(mocks.statusCalls.map((call) => call.state)).toEqual([
      'pending',
      'failure',
    ]);
  });

  it('publishes error and throws when the files API fails', async () => {
    const mocks = githubMock({
      pull: pullFixture(),
      files: [],
      comments: [],
    });
    mocks.paginate.mockRejectedValueOnce(new Error('files API unavailable'));
    await expect(
      runExternalContributionPolicy({
        github: mocks.github,
        context: contextFixture(),
        core: { info: vi.fn() },
        prNumber: 700,
      })
    ).rejects.toThrow('files API unavailable');
    expect(mocks.statusCalls.map((call) => call.state)).toEqual([
      'pending',
      'error',
    ]);
  });

  it('publishes error for a missing fork when its backlog must be read', async () => {
    const pull = pullFixture({
      changed_files: 3,
      head: { sha: 'head-sha', repo: null },
    });
    const mocks = githubMock({
      pull,
      files: [
        file('src/ax/ai/openai/api.ts'),
        file(BACKLOG_PATH),
        file(BACKLOG_DOC_PATH),
      ],
      comments: [],
      contents: [JSON.stringify(ledger())],
    });
    await expect(
      runExternalContributionPolicy({
        github: mocks.github,
        context: contextFixture(),
        core: { info: vi.fn() },
        prNumber: 700,
      })
    ).rejects.toThrow('head repository is unavailable');
    expect(mocks.statusCalls.map((call) => call.state)).toEqual([
      'pending',
      'error',
    ]);
  });
});

function contextFixture() {
  return {
    repo: { owner: 'ax-llm', repo: 'ax' },
    payload: { repository: { default_branch: 'main' } },
  };
}

function pullFixture(overrides = {}) {
  return {
    author_association: 'CONTRIBUTOR',
    user: { login: 'contributor', type: 'User' },
    changed_files: 1,
    head: {
      sha: 'head-sha',
      repo: { name: 'ax', owner: { login: 'contributor' } },
    },
    base: {
      ref: 'main',
      sha: 'base-sha',
      repo: { name: 'ax', owner: { login: 'ax-llm' } },
    },
    ...overrides,
  };
}

function githubMock({ pull, files, comments, contents = [] }) {
  const statusCalls = [];
  const listFiles = vi.fn();
  const listComments = vi.fn();
  const updateComment = vi.fn(async () => ({}));
  const createComment = vi.fn(async () => ({}));
  const getContent = vi.fn(async () => {
    if (contents.length === 0) throw new Error('Unexpected content request');
    const content = contents.shift();
    return {
      data: {
        type: 'file',
        size: Buffer.byteLength(content, 'utf8'),
        content: Buffer.from(content).toString('base64'),
      },
    };
  });
  const paginate = vi.fn(async (endpoint) => {
    if (endpoint === listFiles) return files;
    if (endpoint === listComments) return comments;
    throw new Error('Unexpected pagination endpoint');
  });
  return {
    statusCalls,
    updateComment,
    createComment,
    paginate,
    github: {
      paginate,
      rest: {
        pulls: {
          get: vi.fn(async () => ({ data: pull })),
          listFiles,
        },
        repos: {
          createCommitStatus: vi.fn(async (input) => {
            statusCalls.push(input);
            return {};
          }),
          getContent,
        },
        issues: {
          listComments,
          updateComment,
          createComment,
        },
      },
    },
  };
}
