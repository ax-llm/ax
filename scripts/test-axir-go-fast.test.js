import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FAST_GO_TESTS,
  failingResults,
  KNOWN_FAILING,
  summarizeGoTestJson,
} from './test-axir-go-fast.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const testDir = path.join(repoRoot, 'tools', 'axir', 'internal', 'axir');

function definedGoTests() {
  const names = new Set();
  for (const file of readdirSync(testDir)) {
    if (!file.endsWith('_test.go')) continue;
    const text = readFileSync(path.join(testDir, file), 'utf8');
    for (const match of text.matchAll(/^func (Test\w+)\(t \*testing\.T\)/gm)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe('fast AxIR Go tests', () => {
  it('lists each test once, and only tests that exist', () => {
    const defined = definedGoTests();
    expect(new Set(FAST_GO_TESTS).size).toBe(FAST_GO_TESTS.length);
    expect(FAST_GO_TESTS.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('lists every known failure', () => {
    for (const name of Object.keys(KNOWN_FAILING)) {
      expect(FAST_GO_TESTS).toContain(name);
    }
  });

  it('reads results and times from go test -json, ignoring subtests', () => {
    const lines = [
      { Action: 'run', Test: 'TestA' },
      { Action: 'output', Test: 'TestA', Output: 'ok\n' },
      { Action: 'pass', Test: 'TestA', Elapsed: 0.5 },
      { Action: 'fail', Test: 'TestB/sub', Elapsed: 0.1 },
      { Action: 'output', Test: 'TestB', Output: 'boom\n' },
      { Action: 'fail', Test: 'TestB', Elapsed: 1.25 },
      { Action: 'skip', Test: 'TestC', Elapsed: 0 },
      { Action: 'fail', Elapsed: 2 },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const summary = summarizeGoTestJson(
      `${lines}\nFAIL\tgithub.com/ax-llm/ax/tools/axir/internal/axir\n`,
      ['TestA', 'TestB', 'TestC', 'TestD']
    );
    expect(summary).toEqual([
      { name: 'TestA', action: 'pass', elapsed: 0.5, output: 'ok\n' },
      { name: 'TestB', action: 'fail', elapsed: 1.25, output: 'boom\n' },
      { name: 'TestC', action: 'skip', elapsed: 0, output: '' },
      { name: 'TestD', action: 'missing', elapsed: 0, output: '' },
    ]);
  });

  it('fails on a failed, skipped or missing test unless it is a known failure', () => {
    const summary = [
      { name: 'TestA', action: 'pass' },
      { name: 'TestB', action: 'fail' },
      { name: 'TestC', action: 'skip' },
      { name: 'TestD', action: 'missing' },
      { name: 'TestE', action: 'fail' },
    ];
    expect(
      failingResults(summary, { TestE: 'known' }).map((result) => result.name)
    ).toEqual(['TestB', 'TestC', 'TestD']);
  });
});
