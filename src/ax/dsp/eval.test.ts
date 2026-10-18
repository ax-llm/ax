import { describe, expect, it } from 'vitest';

import { AxEvalUtil } from '../index.js';

describe('AxEvalUtil.novelF1ScoreOptimized', () => {
  it.each([
    ['', 'albatross narwhal', 'albatross cobalt', 0.5, 0.5],
    ['', 'albatross narwhal', 'albatross narwhal', 1, 1],
    ['', 'albatross', 'cobalt', 0, 0],
    ['', 'constructor', 'constructor', 1, 1],
    ['', 'constructor narwhal', 'constructor cobalt', 0.5, 0.5],
    ['narwhal', 'albatross narwhal', 'albatross cobalt', 2 / 3, 0.5],
    ['', 'albatross albatross narwhal', 'albatross cobalt', 0.4, 0.5],
    ['', 'albatross', 'albatross albatross', 2 / 3, 0.5],
    ['', 'albatross albatross', 'albatross', 2 / 3, 1],
    ['', 'The ALBATROSS!', 'albatross', 1, 1],
    ['', '', '', 1, 1],
    ['', '', 'albatross', 0, 0],
    ['', 'albatross', '', 0, 0],
    ['albatross', 'albatross', 'albatross', 1, 1],
    ['', 'the and a', 'the and a', 1, 1],
    ['narwhal', '  ', '!!!', 1, 1],
    ['narwhal', '!!!', 'albatross', 0, 0],
    ['narwhal', 'albatross', '  ', 0, 0],
  ])(
    'scores history=%j, prediction=%j, truth=%j',
    (history, prediction, groundTruth, expectedF1, expectedRecall) => {
      const f1 = AxEvalUtil.novelF1ScoreOptimized(
        history,
        prediction,
        groundTruth
      );
      const recall = AxEvalUtil.novelF1ScoreOptimized(
        history,
        prediction,
        groundTruth,
        true
      );

      expect(Number.isFinite(f1)).toBe(true);
      expect(Number.isFinite(recall)).toBe(true);
      expect(f1).toBeCloseTo(expectedF1);
      expect(recall).toBeCloseTo(expectedRecall);
    }
  );

  it('keeps the sibling evaluation helpers unchanged', () => {
    expect(AxEvalUtil.f1Score('', '')).toBe(1);
    expect(AxEvalUtil.f1Score('', 'albatross')).toBe(0);
    expect(
      AxEvalUtil.f1Score('albatross narwhal', 'albatross cobalt')
    ).toBeCloseTo(0.5);
    expect(AxEvalUtil.emScore('ALBATROSS!', 'albatross')).toBe(1);
  });
});
