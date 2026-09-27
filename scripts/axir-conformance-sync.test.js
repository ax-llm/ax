import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildProviderModelIndex,
  compareDateData,
  compareGeneratedFixtures,
  compareValues,
  normalizeCatalog,
  readProviderDataJson,
  sameZoneTableSource,
  writeProviderDataJson,
} from './axir-conformance-sync.mjs';

describe('axir-conformance-sync helpers', () => {
  it('preserves signature field order when refreshing fluent fixtures', () => {
    const value = {
      signature_spec: {
        outputs: {
          urgent: { type: 'boolean', description: 'Needs attention' },
          assignedTeam: { type: 'class', options: ['support', 'engineering'] },
          details: {
            type: 'object',
            fields: { zebra: { type: 'string' }, alpha: { type: 'string' } },
          },
        },
      },
    };
    expect(Object.keys(normalizeCatalog(value).signature_spec.outputs)).toEqual(
      ['urgent', 'assignedTeam', 'details']
    );
    const outputs = normalizeCatalog(value).signature_spec.outputs;
    expect(Object.keys(outputs.details.fields)).toEqual(['zebra', 'alpha']);
    expect(Object.keys(outputs.urgent)).toEqual(['description', 'type']);
  });
  it('preserves nested validator object order because TypeScript enum equality observes it', () => {
    const value = {
      validation_cases: [
        {
          schema: { const: { z: 1, a: 2 } },
          arguments: { a: 2, z: 1 },
          valid: false,
        },
      ],
    };
    const normalized = normalizeCatalog(value);
    expect(Object.keys(normalized.validation_cases[0].schema.const)).toEqual([
      'z',
      'a',
    ]);
    expect(Object.keys(normalized.validation_cases[0].arguments)).toEqual([
      'a',
      'z',
    ]);
    expect(normalized.validation_cases[0].valid).toBe(false);
  });
  it('preserves object order in string-format cases because the expected text follows it', () => {
    const normalized = normalizeCatalog({
      format_cases: [{ template: '{}', input: [{ z: 1, a: 2 }] }],
      str_cases: [{ input: { z: [{ y: 1, b: 2 }], a: 2 } }],
    });
    expect(Object.keys(normalized.format_cases[0].input[0])).toEqual([
      'z',
      'a',
    ]);
    expect(Object.keys(normalized.str_cases[0].input)).toEqual(['z', 'a']);
    expect(Object.keys(normalized.str_cases[0].input.z[0])).toEqual(['y', 'b']);
  });

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

  it('builds the provider model index from the catalog in catalog order', () => {
    const catalog = normalizeCatalog({
      all: [
        {
          name: 'openai',
          displayName: 'OpenAI',
          models: [
            {
              name: 'gpt-5.5-pro',
              isExpensive: true,
              promptTokenCostPer1M: 30,
              notSupported: { temperature: true, topP: true },
            },
            {
              name: 'gpt-5.4-mini',
              aliases: ['mini'],
              isExpensive: false,
              notSupported: { temperature: false },
              supported: {
                structuredOutputs: true,
                samplingWithoutReasoning: true,
                temperatureOne: true,
                reasoningOffByDefault: false,
              },
            },
          ],
        },
        { name: 'amazon-bedrock', displayName: 'Bedrock', models: [] },
      ],
      text: [{ name: 'ignored', models: [{ name: 'ignored-model' }] }],
    });

    expect(buildProviderModelIndex(catalog)).toEqual({
      'amazon-bedrock': [],
      openai: [
        {
          name: 'gpt-5.5-pro',
          isExpensive: true,
          notSupported: { temperature: true, topP: true },
        },
        {
          name: 'gpt-5.4-mini',
          aliases: ['mini'],
          supported: { samplingWithoutReasoning: true, temperatureOne: true },
        },
      ],
    });
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

  it('compares the zone-name table only on the ICU and tz source it records', () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'axir-sync-repo-'));
    const generatedRoot = mkdtempSync(
      path.join(os.tmpdir(), 'axir-sync-generated-')
    );
    for (const root of [repoRoot, generatedRoot]) {
      mkdirSync(path.join(root, 'ir', 'axcore', 'data'), { recursive: true });
    }
    const write = (root, name, value) =>
      writeFileSync(
        path.join(root, 'ir', 'axcore', 'data', name),
        JSON.stringify(value)
      );
    const source = { icu: '78.3', tz: '2026a', tzdata_candidates: '2026b' };
    write(repoRoot, 'date-zone-abbreviations.json', { rejected: ['BST'] });
    write(generatedRoot, 'date-zone-abbreviations.json', { rejected: ['BST'] });
    write(repoRoot, 'date-time-zones.json', { source, zones: [['UTC']] });

    // Another ICU: skipped, even though the tables differ.
    write(generatedRoot, 'date-time-zones.json', {
      source: { ...source, icu: '77.1' },
      zones: [],
    });
    expect(compareDateData(repoRoot, generatedRoot, false)).toEqual([]);
    expect(
      sameZoneTableSource({ source }, { source: { ...source, tz: '2025b' } })
    ).toBe(false);

    // The same source: a different table is stale.
    write(generatedRoot, 'date-time-zones.json', { source, zones: [] });
    expect(compareDateData(repoRoot, generatedRoot, false)).toEqual([
      'stale data ir/axcore/data/date-time-zones.json',
    ]);

    // The abbreviation tables come from TypeScript source: always compared.
    write(generatedRoot, 'date-zone-abbreviations.json', { rejected: [] });
    expect(compareDateData(repoRoot, generatedRoot, false)).toContain(
      'stale data ir/axcore/data/date-zone-abbreviations.json'
    );
  });
});
