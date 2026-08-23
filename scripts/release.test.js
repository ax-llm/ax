import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertAlignedReleaseVersions,
  parseReleaseArguments,
  parseRemoteTagTarget,
  releaseBranchName,
  resolveReleaseVersion,
} from './release.mjs';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

describe('protected-main release workflow', () => {
  it.each([
    ['24.0.5', 'patch', '24.0.6'],
    ['24.0.5', 'minor', '24.1.0'],
    ['24.0.5', 'major', '25.0.0'],
    ['24.0.5', '24.2.3', '24.2.3'],
  ])('resolves %s with %s to %s', (current, increment, expected) => {
    expect(resolveReleaseVersion(current, increment)).toBe(expected);
  });

  it.each(['24.0.5', '23.9.9', 'next', '24.0.6-rc.1'])(
    'rejects non-increasing or unsupported release target %s',
    (target) => {
      expect(() => resolveReleaseVersion('24.0.5', target)).toThrow();
    }
  );

  it('requires every publishable package to share one version', () => {
    expect(assertAlignedReleaseVersions({ root: '24.0.6', ax: '24.0.6' })).toBe(
      '24.0.6'
    );
    expect(() =>
      assertAlignedReleaseVersions({ root: '24.0.6', ax: '24.0.5' })
    ).toThrow(/not aligned/);
  });

  it('uses a version-specific protected release branch', () => {
    expect(releaseBranchName('24.0.6')).toBe('codex/release-24-0-6');
  });

  it('resolves annotated and lightweight remote tags to their release commit', () => {
    expect(
      parseRemoteTagTarget(
        [
          'tag-object refs/tags/24.0.6',
          'release-commit refs/tags/24.0.6^{}',
        ].join('\n'),
        '24.0.6'
      )
    ).toBe('release-commit');
    expect(
      parseRemoteTagTarget('release-commit refs/tags/24.0.6', '24.0.6')
    ).toBe('release-commit');
    expect(parseRemoteTagTarget('', '24.0.6')).toBeNull();
  });

  it('parses only the prepare and publish phases', () => {
    expect(parseReleaseArguments(['prepare', 'minor'])).toEqual({
      mode: 'prepare',
      value: 'minor',
    });
    expect(parseReleaseArguments(['publish', '24.0.6'])).toEqual({
      mode: 'publish',
      value: '24.0.6',
    });
    expect(() => parseReleaseArguments(['ship'])).toThrow(/Usage/);
  });

  it('cannot tag, push main, or publish from release-it directly', () => {
    const config = JSON.parse(
      readFileSync(path.join(repoRoot, '.release-it.json'), 'utf8')
    );
    expect(config.git).toMatchObject({
      push: false,
      requireBranch: 'codex/release-*',
      requireUpstream: false,
      tag: false,
    });
    expect(config.github.release).toBe(false);
  });

  it('routes maintainer commands through the guarded workflow', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    );
    expect(manifest.scripts.release).toBe('node scripts/release.mjs prepare');
    expect(manifest.scripts['release:publish']).toBe(
      'node scripts/release.mjs publish'
    );
  });
});
