import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { axRuntimePrimitives } from './runtimePrimitives.js';

/**
 * The RLM prompt templates are byte-synced to ir/axcore/data/rlm-prompts.json
 * and gated by scripts/axir-prompt-sync-check.mjs — but that gate does NOT
 * cover the `primitives` array the five language ports render from. This test
 * closes that gap: every TS registry entry must appear in the IR copy with
 * identical gating and rendered content, so the ports advertise the same
 * primitive surface as TS. (Historical drift this would have caught:
 * `discover.stages` was executor-only in the IR while TS had both stages.)
 */
describe('rlm-prompts.json primitives stay in sync with the TS registry', () => {
  const jsonPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../ir/axcore/data/rlm-prompts.json'
  );
  const irPrompts = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
    primitives: Record<string, unknown>[];
  };

  it('has the same primitive ids in the same order', () => {
    expect(irPrompts.primitives.map((p) => p.id)).toEqual(
      axRuntimePrimitives.map((p) => p.id)
    );
  });

  it('mirrors each primitive field-for-field', () => {
    const normalize = (entry: unknown) =>
      JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
    for (const tsPrimitive of axRuntimePrimitives) {
      const irPrimitive = irPrompts.primitives.find(
        (p) => p.id === tsPrimitive.id
      );
      expect(irPrimitive, `IR entry for '${tsPrimitive.id}'`).toBeDefined();
      expect(normalize(irPrimitive)).toEqual(normalize(tsPrimitive));
    }
  });
});
