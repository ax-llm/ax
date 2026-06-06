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

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'axir-backlog.mjs'
);

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

function readLedger(root) {
  return JSON.parse(
    readFileSync(path.join(root, 'ir', 'axir-backlog.json'), 'utf8')
  );
}
