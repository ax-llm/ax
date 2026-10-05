import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  conformanceWorkers,
  mapConformanceCases,
} from './axir-conformance-workers.mjs';
import { runIsolatedFixture } from './axir-perturb-check.mjs';

describe('bounded conformance workers', () => {
  it('runs every case once with bounded concurrency and ordered results', async () => {
    let active = 0;
    let peak = 0;
    const seen = [];
    const cases = Array.from({ length: 17 }, (_, i) => i);
    const results = await mapConformanceCases(
      cases,
      async (value) => {
        seen.push(value);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, (value % 3) + 1));
        active--;
        return value * 2;
      },
      4
    );
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(seen.sort((a, b) => a - b)).toEqual(cases);
    expect(results).toEqual(cases.map((value) => value * 2));
  });

  it('waits for active cases before reporting a failure', async () => {
    let release;
    let started;
    const active = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    let completed = false;
    const result = mapConformanceCases(
      [0, 1, 2],
      async (value) => {
        if (value === 0) {
          await ready;
          throw new Error('runner failed');
        }
        started();
        await active;
        completed = true;
      },
      2
    );
    await ready;
    release();
    await expect(result).rejects.toThrow('runner failed');
    expect(completed).toBe(true);
  });

  it('rejects invalid worker settings', () => {
    for (const value of ['0', '-1', '1.5', '33', 'no']) {
      expect(() => conformanceWorkers(value)).toThrow(
        'AXIR_CONFORMANCE_WORKERS'
      );
    }
    expect(conformanceWorkers('')).toBe(1);
    expect(conformanceWorkers('4')).toBe(4);
  });
});

describe('isolated mutation fixtures', () => {
  it('keeps concurrent cases separate and cleans up after a runner error', async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'axir-isolation-test-'));
    const paths = new Set();
    try {
      const runner = async (dir) => {
        paths.add(dir);
        expect(readdirSync(dir)).toEqual(['fixture.json']);
        const fixture = JSON.parse(
          readFileSync(path.join(dir, 'fixture.json'), 'utf8')
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(
          JSON.parse(readFileSync(path.join(dir, 'fixture.json'), 'utf8'))
        ).toEqual(fixture);
        if (fixture.name === 'bad') throw new Error('runner crashed');
        return { status: 0, stdout: `ok ${fixture.name}`, stderr: '' };
      };
      const results = await Promise.allSettled(
        ['good', 'bad'].map((name) =>
          runIsolatedFixture(runner, work, { name }, name)
        )
      );
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(paths.size).toBe(2);
      expect(readdirSync(work)).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
