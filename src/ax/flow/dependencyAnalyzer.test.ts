import { describe, expect, it } from 'vitest';
import {
  analyzeStateDependencies,
  analyzeStateDependencyMetadata,
} from './dependencyAnalyzer.js';

describe('analyzeStateDependencies', () => {
  it('extracts direct state property reads without invoking the mapper', () => {
    let called = false;
    const dependencies = analyzeStateDependencies((state: any) => {
      called = true;
      return {
        a: state.input,
        b: state.other,
      };
    });

    expect(called).toBe(false);
    expect(dependencies).toEqual(['input', 'other']);
  });

  it('extracts destructured top-level state reads', () => {
    const dependencies = analyzeStateDependencies((state: any) => {
      const { first, second: renamed } = state;
      return { first, renamed };
    });

    expect(dependencies).toEqual(['first', 'second']);
  });

  it('extracts reads from the actual mapper parameter name', () => {
    const dependencies = analyzeStateDependencies((s: any) => ({
      prompt: `${s.title}: ${s.body}`,
    }));

    expect(dependencies).toEqual(['title', 'body']);
  });

  it('extracts destructured function parameters', () => {
    const dependencies = analyzeStateDependencies(
      ({ first, second: renamed }: any) => ({ first, renamed })
    );

    expect(dependencies).toEqual(['first', 'second']);
  });

  it('marks unknown state access as unsafe for planning', () => {
    const key = 'dynamicKey';
    const analysis = analyzeStateDependencyMetadata((state: any) => ({
      value: state[key],
    }));

    expect(analysis.dependencies).toEqual([]);
    expect(analysis.isSafe).toBe(false);
  });

  it('keeps constant mappers safe for planning', () => {
    const analysis = analyzeStateDependencyMetadata(() => ({
      value: 'constant',
    }));

    expect(analysis.dependencies).toEqual([]);
    expect(analysis.isSafe).toBe(true);
  });

  it('returns an empty list when there is no safe static signal', () => {
    const dependencies = analyzeStateDependencies(() => ({
      staticValue: 'ok',
    }));

    expect(dependencies).toEqual([]);
  });
});
