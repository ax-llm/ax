import { describe, expect, it } from 'vitest';

import {
  classifyContextPressure,
  renderContextPressure,
} from './contextEvents.js';

describe('context pressure', () => {
  it('classifies pressure from character budget usage', () => {
    expect(
      classifyContextPressure({
        mutablePromptChars: 6_999,
        effectiveBudgetChars: 10_000,
        checkpointActive: false,
      })
    ).toBe('ok');
    expect(
      classifyContextPressure({
        mutablePromptChars: 7_000,
        effectiveBudgetChars: 10_000,
        checkpointActive: false,
      })
    ).toBe('watch');
    expect(
      classifyContextPressure({
        mutablePromptChars: 9_000,
        effectiveBudgetChars: 10_000,
        checkpointActive: false,
      })
    ).toBe('critical');
  });

  it('treats active checkpointing as critical pressure', () => {
    expect(
      classifyContextPressure({
        mutablePromptChars: 1,
        effectiveBudgetChars: 10_000,
        checkpointActive: true,
      })
    ).toBe('critical');
  });

  it('renders compact behavioral hints instead of metric blobs', () => {
    expect(renderContextPressure('watch')).toContain(
      'keep inspections compact'
    );
    expect(renderContextPressure('critical')).toContain('liveRuntimeState');
    expect(renderContextPressure('ok')).not.toContain('{');
  });
});
