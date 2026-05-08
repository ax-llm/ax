import { describe, expect, it } from 'vitest';

import { appendGuidanceEntry, renderGuidanceLog } from './guidanceHelpers.js';
import type { AxAgentGuidanceLogEntry } from './types.js';

describe('appendGuidanceEntry', () => {
  it('collapses consecutive identical entries and refreshes the turn', () => {
    const entries: AxAgentGuidanceLogEntry[] = [];

    appendGuidanceEntry(entries, {
      turn: 1,
      guidance: 'fix your code',
      triggeredBy: 'runtime policy',
    });
    appendGuidanceEntry(entries, {
      turn: 2,
      guidance: 'fix your code',
      triggeredBy: 'runtime policy',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.turn).toBe(2);
  });

  it('keeps distinct entries separate', () => {
    const entries: AxAgentGuidanceLogEntry[] = [];

    appendGuidanceEntry(entries, {
      turn: 1,
      guidance: 'fix your code',
      triggeredBy: 'runtime policy',
    });
    appendGuidanceEntry(entries, {
      turn: 2,
      guidance: 'check inputs',
      triggeredBy: 'runtime policy',
    });
    appendGuidanceEntry(entries, {
      turn: 3,
      guidance: 'fix your code',
      triggeredBy: 'tool',
    });

    expect(entries).toHaveLength(3);
  });

  it('only collapses against the most recent entry, not earlier matches', () => {
    const entries: AxAgentGuidanceLogEntry[] = [];

    appendGuidanceEntry(entries, {
      turn: 1,
      guidance: 'A',
      triggeredBy: 'runtime policy',
    });
    appendGuidanceEntry(entries, {
      turn: 2,
      guidance: 'B',
      triggeredBy: 'runtime policy',
    });
    appendGuidanceEntry(entries, {
      turn: 3,
      guidance: 'A',
      triggeredBy: 'runtime policy',
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.guidance)).toEqual(['A', 'B', 'A']);
  });

  it('renderGuidanceLog produces one line per entry after dedup', () => {
    const entries: AxAgentGuidanceLogEntry[] = [];
    for (let turn = 1; turn <= 7; turn++) {
      appendGuidanceEntry(entries, {
        turn,
        guidance: 'same nag',
        triggeredBy: 'runtime policy',
      });
    }
    const rendered = renderGuidanceLog(entries);
    expect(rendered).toBe('- runtime policy, same nag');
  });
});
