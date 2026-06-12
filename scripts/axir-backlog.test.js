import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluatePrCheck,
  staleOpenEntries,
  surfaceIrModulesFor,
} from './axir-backlog.mjs';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'axir-backlog.mjs'
);

const emptyLedger = { schemaVersion: 1, entries: [] };

function openEntry(overrides = {}) {
  return {
    id: 'axir-2026-01-01-entry',
    status: 'open',
    title: 'Entry',
    createdAt: '2026-01-01',
    sourcePR: null,
    sourceCommit: null,
    tsPaths: ['src/ax/ai/'],
    portableSurface: 'axai',
    impact: 'Drift.',
    suggestedAxirWork: [],
    completedAt: null,
    completedByCommit: null,
    verification: null,
    ...overrides,
  };
}

describe('evaluatePrCheck surface scoping', () => {
  it('passes when the matching surface IR module changed', () => {
    const result = evaluatePrCheck({
      changedFiles: ['src/ax/ai/openai/info.ts', 'ir/axcore/ai.axir'],
      ledger: emptyLedger,
    });
    expect(result.ok).toBe(true);
  });

  it('fails when only an unrelated surface IR module changed', () => {
    const result = evaluatePrCheck({
      changedFiles: ['src/ax/ai/openai/info.ts', 'ir/axcore/agent.axir'],
      ledger: emptyLedger,
    });
    expect(result.ok).toBe(false);
    expect(result.uncovered).toEqual(['src/ax/ai/openai/info.ts']);
  });

  it('passes any surface for global AxIR work', () => {
    for (const global of [
      'tools/axir/internal/axir/codegen.go',
      'ir/conformance/axai/chat.json',
      'ir/axcore/data/provider-model-catalog.json',
      'ir/axcore/root.axir',
      'scripts/axir-conformance-sync.mjs',
    ]) {
      const result = evaluatePrCheck({
        changedFiles: ['src/ax/ai/openai/info.ts', global],
        ledger: emptyLedger,
      });
      expect(result.ok, global).toBe(true);
    }
  });

  it('flags only the surfaces left uncovered in a mixed PR', () => {
    const result = evaluatePrCheck({
      changedFiles: [
        'src/ax/ai/openai/info.ts',
        'ir/axcore/ai.axir',
        'src/ax/dsp/generate.ts',
      ],
      ledger: emptyLedger,
    });
    expect(result.ok).toBe(false);
    expect(result.uncovered).toEqual(['src/ax/dsp/generate.ts']);
  });

  it('covers dsp through cross-cutting signature work', () => {
    const result = evaluatePrCheck({
      changedFiles: ['src/ax/dsp/sig.ts', 'ir/axcore/signature.axir'],
      ledger: emptyLedger,
    });
    expect(result.ok).toBe(true);
  });

  it('tracks src/ax/mem against api.axir', () => {
    expect(surfaceIrModulesFor('src/ax/mem/memory.ts')).toEqual([
      'ir/axcore/api.axir',
    ]);
    expect(
      evaluatePrCheck({
        changedFiles: ['src/ax/mem/memory.ts'],
        ledger: emptyLedger,
      }).ok
    ).toBe(false);
    expect(
      evaluatePrCheck({
        changedFiles: ['src/ax/mem/memory.ts', 'ir/axcore/api.axir'],
        ledger: emptyLedger,
      }).ok
    ).toBe(true);
  });

  it('still honors open backlog entries and the no-impact marker', () => {
    const ledger = { schemaVersion: 1, entries: [openEntry()] };
    expect(
      evaluatePrCheck({
        changedFiles: ['src/ax/ai/openai/info.ts'],
        ledger,
      }).ok
    ).toBe(true);
    expect(
      evaluatePrCheck({
        changedFiles: ['src/ax/ai/openai/info.ts'],
        ledger: emptyLedger,
        noImpact: true,
      }).ok
    ).toBe(true);
  });
});

describe('staleOpenEntries', () => {
  it('flags open entries past the threshold and skips fresh or done ones', () => {
    const ledger = {
      schemaVersion: 1,
      entries: [
        openEntry({ id: 'axir-old', createdAt: '2026-01-01' }),
        openEntry({ id: 'axir-fresh', createdAt: '2026-02-15' }),
        openEntry({
          id: 'axir-done',
          createdAt: '2026-01-01',
          status: 'done',
          completedAt: '2026-01-02',
          completedByCommit: 'abc',
          verification: 'npm run test:axir',
        }),
      ],
    };
    const stale = staleOpenEntries(ledger, '2026-03-01', 30);
    expect(stale.map(({ entry }) => entry.id)).toEqual(['axir-old']);
    expect(stale[0].ageDays).toBe(59);
    expect(staleOpenEntries(ledger, '2026-01-29', 30)).toHaveLength(0);
  });
});

describe('axir-backlog CLI', () => {
  let root;
  let originalToday;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'axir-backlog-test-'));
    mkdirSync(path.join(root, 'ir'), { recursive: true });
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(
      path.join(root, 'ir', 'axir-backlog.json'),
      `${JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)}\n`
    );
    originalToday = process.env.AXIR_BACKLOG_TODAY;
    process.env.AXIR_BACKLOG_TODAY = '2026-06-05';
  });

  afterEach(() => {
    if (originalToday === undefined) delete process.env.AXIR_BACKLOG_TODAY;
    else process.env.AXIR_BACKLOG_TODAY = originalToday;
    rmSync(root, { recursive: true, force: true });
  });

  it('adds, lists, completes, renders, and validates entries', () => {
    run([
      'add',
      '--root',
      root,
      '--title',
      'Sync OpenAI prices',
      '--surface',
      'axai',
      '--impact',
      'Generated model catalogs may drift.',
      '--paths',
      'src/ax/ai/openai/info.ts',
      '--pr',
      '525',
      '--commit',
      'abc123',
    ]);

    const ledger = readLedger(root);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      id: 'axir-2026-06-05-sync-openai-prices',
      status: 'open',
      portableSurface: 'axai',
      sourcePR: 525,
      tsPaths: ['src/ax/ai/openai/info.ts'],
    });

    expect(run(['list', '--root', root])).toContain('Sync OpenAI prices');

    expect(() =>
      run(['done', 'axir-2026-06-05-sync-openai-prices', '--root', root])
    ).toThrow(/done requires/);

    run([
      'done',
      'axir-2026-06-05-sync-openai-prices',
      '--root',
      root,
      '--commit',
      'def456',
      '--verification',
      'npm run test:axir',
    ]);
    expect(readLedger(root).entries[0]).toMatchObject({
      status: 'done',
      completedByCommit: 'def456',
      verification: 'npm run test:axir',
    });
    run(['render', '--root', root]);
    expect(
      readFileSync(path.join(root, 'docs', 'AXIR_BACKLOG.md'), 'utf8')
    ).toContain('Sync OpenAI prices');
    expect(run(['validate', '--root', root])).toContain('valid');
  });

  it('rejects duplicate ids and invalid surfaces', () => {
    run([
      'add',
      '--root',
      root,
      '--id',
      'axir-test',
      '--title',
      'First',
      '--surface',
      'axflow',
      '--impact',
      'Flow behavior can drift.',
      '--paths',
      'src/ax/flow/flow.ts',
    ]);

    expect(() =>
      run([
        'add',
        '--root',
        root,
        '--id',
        'axir-test',
        '--title',
        'Second',
        '--surface',
        'axflow',
        '--impact',
        'Flow behavior can drift.',
        '--paths',
        'src/ax/flow/executor.ts',
      ])
    ).toThrow(/already exists/);

    expect(() =>
      run([
        'add',
        '--root',
        root,
        '--title',
        'Bad surface',
        '--surface',
        'nope',
        '--impact',
        'Invalid.',
        '--paths',
        'src/ax/ai/catalog.ts',
      ])
    ).toThrow(/invalid --surface/);
  });

  it('checks PR drift with synthetic changed files', () => {
    expect(() =>
      run([
        'check-pr',
        '--root',
        root,
        '--changed-file',
        'src/ax/ai/openai/info.ts',
      ])
    ).toThrow(/AxIR backlog check failed/);

    expect(() =>
      run([
        'check-pr',
        '--root',
        root,
        '--changed-file',
        'src/ax/mcp/client.ts',
      ])
    ).toThrow(/--surface axmcp/);

    run([
      'add',
      '--root',
      root,
      '--title',
      'Sync OpenAI prices',
      '--surface',
      'axai',
      '--impact',
      'Generated model catalogs may drift.',
      '--paths',
      'src/ax/ai/openai/info.ts',
    ]);
    expect(
      run([
        'check-pr',
        '--root',
        root,
        '--changed-file',
        'src/ax/ai/openai/info.ts',
      ])
    ).toContain('ok');

    run([
      'add',
      '--root',
      root,
      '--title',
      'Sync MCP transports',
      '--surface',
      'axmcp',
      '--impact',
      'Generated MCP clients and transports may drift.',
      '--paths',
      'src/ax/mcp',
    ]);
    expect(
      run([
        'check-pr',
        '--root',
        root,
        '--changed-file',
        'src/ax/mcp/client.ts',
      ])
    ).toContain('ok');

    expect(
      run([
        'check-pr',
        '--root',
        root,
        '--changed-file',
        'src/ax/flow/flow.ts',
        '--changed-file',
        'ir/conformance/axflow/simple-forward-returns.json',
      ])
    ).toContain('ok');

    expect(
      run(['check-pr', '--root', root, '--changed-file', 'docs/COMPILER.md'])
    ).toContain('ok');
  });
});

describe('axir-backlog CLI diff base and staleness', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'axir-backlog-git-'));
    mkdirSync(path.join(root, 'ir'), { recursive: true });
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    writeFileSync(
      path.join(root, 'ir', 'axir-backlog.json'),
      `${JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)}\n`
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function git(args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`${result.stdout}${result.stderr}`.trim());
    }
    return result.stdout.trim();
  }

  it('falls back to HEAD~1 when the diff base is unreachable', () => {
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    writeFileSync(path.join(root, 'one.txt'), 'one\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'one']);
    writeFileSync(path.join(root, 'two.txt'), 'two\n');
    git(['add', 'two.txt']);
    git(['commit', '-q', '-m', 'two']);

    const zeros = '0'.repeat(40);
    const result = runRaw([
      'check-pr',
      '--root',
      root,
      '--base',
      zeros,
      '--head',
      'HEAD',
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('falling back to HEAD~1');
    expect(result.stdout).toContain('AxIR backlog check ok');
  });

  it('evaluates the real pre-push base when it is reachable', () => {
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    writeFileSync(path.join(root, 'base.txt'), 'base\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'base']);
    const baseSha = git(['rev-parse', 'HEAD']);
    mkdirSync(path.join(root, 'src', 'ax', 'ai'), { recursive: true });
    writeFileSync(
      path.join(root, 'src', 'ax', 'ai', 'info.ts'),
      'export {};\n'
    );
    git(['add', '.']);
    git(['commit', '-q', '-m', 'portable change']);

    const result = runRaw([
      'check-pr',
      '--root',
      root,
      '--base',
      baseSha,
      '--head',
      'HEAD',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/ax/ai/info.ts');
  });

  it('warns about stale open entries without failing', () => {
    runWithEnv(
      [
        'add',
        '--root',
        root,
        '--title',
        'Old drift',
        '--surface',
        'axai',
        '--impact',
        'Drift.',
        '--paths',
        'src/ax/ai/old.ts',
      ],
      { AXIR_BACKLOG_TODAY: '2026-01-01' }
    );
    const result = runRaw(
      ['check-pr', '--root', root, '--changed-file', 'docs/x.md'],
      { AXIR_BACKLOG_TODAY: '2026-03-01' }
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('older than 30 days');
    expect(result.stderr).toContain('axir-2026-01-01-old-drift');
  });
});

function run(args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.dirname(scriptPath),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`.trim());
  }
  return result.stdout;
}

function runWithEnv(args, env) {
  const result = runRaw(args, env);
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`.trim());
  }
  return result.stdout;
}

function runRaw(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.dirname(scriptPath),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function readLedger(root) {
  return JSON.parse(
    readFileSync(path.join(root, 'ir', 'axir-backlog.json'), 'utf8')
  );
}
