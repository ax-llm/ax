import { describe, expect, it } from 'vitest';

import {
  GENERATED_EXAMPLE_TARGETS,
  generatedExamples,
  generatedExamplesForTargets,
  generatedMcpExamplesForTargets,
  selectGeneratedExampleTargets,
} from './test-generated-examples.mjs';

describe('generated example target selection', () => {
  it('keeps all targets when no target is supplied', () => {
    expect(selectGeneratedExampleTargets()).toEqual(GENERATED_EXAMPLE_TARGETS);
    expect(generatedExamplesForTargets(GENERATED_EXAMPLE_TARGETS)).toEqual(
      generatedExamples
    );
  });

  it('selects one target and preserves canonical order for mixed targets', () => {
    expect(selectGeneratedExampleTargets(['go'])).toEqual(['go']);
    expect(selectGeneratedExampleTargets(['rust', 'go', 'rust'])).toEqual([
      'go',
      'rust',
    ]);
    expect(
      generatedExamplesForTargets(['go']).every(
        ([language]) => language === 'go'
      )
    ).toBe(true);
  });

  it('rejects unsupported targets', () => {
    expect(() => selectGeneratedExampleTargets(['typescript'])).toThrow(
      'Unsupported generated-example target(s): typescript'
    );
  });

  it('filters MCP compilation by target', () => {
    const catalog = {
      all: [
        { group: 'mcp', language: { runner: 'go' }, sourcePath: 'go-mcp' },
        {
          group: 'mcp',
          language: { runner: 'rust' },
          sourcePath: 'rust-mcp',
        },
        {
          group: 'generation',
          language: { runner: 'go' },
          sourcePath: 'go-generation',
        },
      ],
    };

    expect(generatedMcpExamplesForTargets(catalog, ['go'])).toEqual([
      catalog.all[0],
    ]);
  });
});
