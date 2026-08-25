import { describe, expect, it } from 'vitest';

import { DEFAULT_TARGETS } from './axir-perturb-check.mjs';
import { selectPrepareTargets } from './prepare-axir-perturb-runners.mjs';

describe('prepared perturbation runner target selection', () => {
  it('selects every target by default', () => {
    expect(selectPrepareTargets()).toEqual(DEFAULT_TARGETS);
  });

  it('deduplicates targets in canonical order', () => {
    expect(selectPrepareTargets(['cpp', 'go', 'cpp'])).toEqual(['go', 'cpp']);
  });

  it('rejects unsupported targets', () => {
    expect(() => selectPrepareTargets(['typescript'])).toThrow(
      'Unsupported AxIR perturbation target(s): typescript'
    );
  });
});
