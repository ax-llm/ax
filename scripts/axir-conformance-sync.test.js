import { describe, expect, it } from 'vitest';
import {
  compareValues,
  normalizeCatalog,
  parseAxirProviderCatalog,
  parseAxirProviderCatalogSummary,
  parseAxirProviderProfileRegistry,
  replaceAxirProviderCatalog,
  replaceAxirProviderCatalogSummary,
  replaceAxirProviderProfileRegistry,
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

  it('round-trips the embedded provider catalog in provider.axir text', () => {
    const catalog = normalizeCatalog({
      all: [{ name: 'openai', models: [{ name: 'gpt-4o' }] }],
    });
    const source =
      'body @entry() {\n      %catalog = core.call intrinsic.json.parse("{}")\n      core.return %catalog\n    }';

    const updated = replaceAxirProviderCatalog(source, catalog);
    expect(parseAxirProviderCatalog(updated)).toEqual(catalog);
  });

  it('round-trips the embedded provider profile registry and summary', () => {
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
    const source =
      'body @entry() {\n      %registry = core.call intrinsic.json.parse("{}")\n      %summary = core.call intrinsic.json.parse("{}")\n      core.return %summary\n    }';

    const updated = replaceAxirProviderCatalogSummary(
      replaceAxirProviderProfileRegistry(source, registry),
      summary
    );
    expect(parseAxirProviderProfileRegistry(updated)).toEqual(registry);
    expect(parseAxirProviderCatalogSummary(updated)).toEqual(summary);
  });
});
