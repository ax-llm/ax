import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  perturbFixture,
  runnerForTarget,
  sampleFixtures,
} from './axir-perturb-check.mjs';

describe('perturbFixture', () => {
  it('mutates the first expected_* leaf by type', () => {
    const fixture = {
      name: 'x',
      expected_output: { answer: 'paris' },
      expected_request_count: 2,
    };
    const hit = perturbFixture(fixture);
    expect(hit.key).toBe('expected_output');
    expect(fixture.expected_output.__perturbed__).toBe(true);
    expect(fixture.expected_request_count).toBe(2);
  });

  it('mutates strings, numbers, booleans, and arrays distinctly', () => {
    for (const [value, check] of [
      ['ok', (v) => v === 'ok__PERTURBED__'],
      [3, (v) => v === 4],
      [true, (v) => v === false],
      [['a'], (v) => v.length === 2 && v[1] === '__PERTURBED__'],
    ]) {
      const fixture = { expected_thing: value };
      const hit = perturbFixture(fixture);
      expect(hit.key).toBe('expected_thing');
      expect(check(fixture.expected_thing)).toBe(true);
    }
  });

  it('finds nested expectations and reports none when absent', () => {
    const nested = { steps: [{ expected_code: 'final()' }] };
    expect(perturbFixture(nested).key).toBe('expected_code');
    expect(perturbFixture({ name: 'no-expectations' })).toBeNull();
  });
});

describe('runnerForTarget', () => {
  // A stand-in C++ conformance binary; the cpp runner execs it directly.
  function withFakeRunner(script, check) {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'axir-perturb-runner-'));
    const bin = path.join(outDir, 'conformance_bin');
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o755);
    try {
      check(runnerForTarget('cpp', outDir, 500));
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  it('returns the result of a runner that finishes', () => {
    withFakeRunner('echo "ok $1"', (runner) => {
      const result = runner('/suites/axevent', 'pristine suite axevent');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('ok /suites/axevent\n');
    });
  });

  it('kills a hung runner and names the target and suite', () => {
    withFakeRunner('echo started; exec sleep 30', (runner) => {
      const startedAt = Date.now();
      expect(() => runner('/suites/axevent', 'pristine suite axevent')).toThrow(
        'TIMEOUT: cpp conformance runner exceeded 0.5s on pristine suite axevent and was killed.\nstarted\n'
      );
      expect(Date.now() - startedAt).toBeLessThan(10_000);
    });
  });
});

describe('sampleFixtures', () => {
  it('samples one fixture per suite deterministically', () => {
    const sample = sampleFixtures();
    expect(sample.length).toBeGreaterThanOrEqual(10);
    const suites = sample.map(({ suite }) => suite);
    expect(new Set(suites).size).toBe(suites.length);
    expect(sample.every(({ file }) => file.endsWith('.json'))).toBe(true);
  });
});
