import { describe, expect, it } from 'vitest';
import { perturbFixture, sampleFixtures } from './axir-perturb-check.mjs';

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

describe('sampleFixtures', () => {
  it('samples one fixture per suite deterministically', () => {
    const sample = sampleFixtures();
    expect(sample.length).toBeGreaterThanOrEqual(10);
    const suites = sample.map(({ suite }) => suite);
    expect(new Set(suites).size).toBe(suites.length);
    expect(sample.every(({ file }) => file.endsWith('.json'))).toBe(true);
  });
});
