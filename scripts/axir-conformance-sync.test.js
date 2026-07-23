import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareGeneratedFixtures,
  compareValues,
  normalizeCatalog,
  readProviderDataJson,
  writeProviderDataJson,
} from './axir-conformance-sync.mjs';

describe('axir-conformance-sync helpers', () => {
  it('detects stale model pricing with a precise diff', () => {
    const expected = normalizeCatalog({
      all: [
        {
          name: 'openai',
          models: [
            {
              name: 'gpt-5-codex',
              promptTokenCostPer1M: 1.25,
              completionTokenCostPer1M: 10,
            },
          ],
        },
      ],
    });
    const actual = normalizeCatalog({
      all: [
        {
          name: 'openai',
          models: [
            {
              name: 'gpt-5-codex',
              promptTokenCostPer1M: 10,
              completionTokenCostPer1M: 40,
            },
          ],
        },
      ],
    });

    expect(compareValues(actual, expected, 'catalog')).toEqual([
      'catalog.all[0].models[0].completionTokenCostPer1M: expected 10, got 40',
      'catalog.all[0].models[0].promptTokenCostPer1M: expected 1.25, got 10',
    ]);
  });

  it('round-trips the provider catalog through its data file', () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'axir-sync-'));
    mkdirSync(path.join(repoRoot, 'ir', 'axcore', 'data'), { recursive: true });
    const catalog = normalizeCatalog({
      all: [{ name: 'openai', models: [{ name: 'gpt-4o' }] }],
    });

    writeProviderDataJson(repoRoot, 'catalog', catalog);
    expect(readProviderDataJson(repoRoot, 'catalog')).toEqual(catalog);
    expect(
      readFileSync(
        path.join(
          repoRoot,
          'ir',
          'axcore',
          'data',
          'provider-model-catalog.json'
        ),
        'utf8'
      )
    ).not.toContain('\n');
  });

  it('round-trips the profile registry and summary data files', () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'axir-sync-'));
    mkdirSync(path.join(repoRoot, 'ir', 'axcore', 'data'), { recursive: true });
    const registry = normalizeCatalog({
      registryVersion: 'provider-profile-registry-v1',
      supportedProfileIds: ['openai-compatible'],
      deferredCatalogProviderIds: [],
    });
    const summary = normalizeCatalog({
      catalogVersion: 'provider-model-catalog-audit-v1',
      providerCount: 1,
      providerNames: ['openai'],
      deferredProviderIds: [],
    });

    writeProviderDataJson(repoRoot, 'registry', registry);
    writeProviderDataJson(repoRoot, 'summary', summary);
    expect(readProviderDataJson(repoRoot, 'registry')).toEqual(registry);
    expect(readProviderDataJson(repoRoot, 'summary')).toEqual(summary);
  });

  it('detects a stale checked-in AxAgent oracle fixture', () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'axir-sync-repo-'));
    const generatedRoot = mkdtempSync(
      path.join(os.tmpdir(), 'axir-sync-generated-')
    );
    const relative = path.join(
      'ir',
      'conformance',
      'axagent',
      'semantic-parity-lifecycle-oracle.json'
    );
    mkdirSync(path.dirname(path.join(repoRoot, relative)), {
      recursive: true,
    });
    mkdirSync(path.dirname(path.join(generatedRoot, relative)), {
      recursive: true,
    });
    writeFileSync(
      path.join(generatedRoot, relative),
      JSON.stringify({ expected_output: { answer: 'oracle' } })
    );
    writeFileSync(
      path.join(repoRoot, relative),
      JSON.stringify({ expected_output: { answer: 'stale' } })
    );

    expect(
      compareGeneratedFixtures(repoRoot, generatedRoot, 'axagent', false)
    ).toEqual([
      'stale fixture ir/conformance/axagent/semantic-parity-lifecycle-oracle.json',
    ]);
  });
});
