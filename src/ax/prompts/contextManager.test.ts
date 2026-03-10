import { describe, expect, it, vi } from 'vitest';

import type { ActionLogEntry } from './contextManager.js';
import {
  buildActionEvidenceSummary,
  buildActionLog,
  buildActionLogWithPolicy,
  buildInspectRuntimeBaselineCode,
  buildInspectRuntimeCode,
  evaluateHindsight,
  extractDeclaredVariables,
  extractErrorSignature,
  extractReferencedIdentifiers,
  generateCheckpointSummaryAsync,
  generateTombstoneAsync,
  manageContext,
} from './contextManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<ActionLogEntry> & { turn: number }
): ActionLogEntry {
  return {
    code: '',
    output: '',
    actorFieldsOutput: '',
    tags: [],
    ...overrides,
  };
}

function makeErrorEntry(
  turn: number,
  output = 'TypeError: x is not a function'
): ActionLogEntry {
  return makeEntry({ turn, code: 'badCode()', output, tags: ['error'] });
}

function makeSuccessEntry(
  turn: number,
  code = 'var x = 1',
  output = '1'
): ActionLogEntry {
  return makeEntry({ turn, code, output, tags: [] });
}

// ---------------------------------------------------------------------------
// extractErrorSignature
// ---------------------------------------------------------------------------

describe('extractErrorSignature', () => {
  it('should extract the first XxxError line', () => {
    const output =
      'Some preamble\nTypeError: Cannot read property "x" of null\nat foo.js:1';
    expect(extractErrorSignature(output)).toBe(
      'TypeError: Cannot read property "x" of null'
    );
  });

  it('should fall back to first 80 chars when no error pattern', () => {
    const output = 'something went wrong without a standard error pattern';
    expect(extractErrorSignature(output)).toBe(output.slice(0, 80));
  });
});

// ---------------------------------------------------------------------------
// extractDeclaredVariables
// ---------------------------------------------------------------------------

describe('extractDeclaredVariables', () => {
  it('should extract var/let/const declarations', () => {
    expect(
      extractDeclaredVariables('const x = 1; let y = 2; var z = 3')
    ).toEqual(['x', 'y', 'z']);
  });

  it('should handle declarations on separate lines', () => {
    expect(
      extractDeclaredVariables('const data = []\nlet result = null')
    ).toEqual(['data', 'result']);
  });

  it('should return empty for code with no declarations', () => {
    expect(extractDeclaredVariables('console.log("hello")')).toEqual([]);
  });

  it('should ignore block-scoped declarations that do not persist across turns', () => {
    expect(
      extractDeclaredVariables(
        ['const topLevel = 1;', 'if (true) {', '  const inner = 2;', '}'].join(
          '\n'
        )
      )
    ).toEqual(['topLevel']);
  });

  it('should extract top-level comma-separated and destructured bindings', () => {
    expect(
      extractDeclaredVariables(
        'const a = 1, { b: renamed, c } = obj, [first, ...rest] = items'
      )
    ).toEqual(['a', 'renamed', 'c', 'first', 'rest']);
  });
});

// ---------------------------------------------------------------------------
// extractReferencedIdentifiers
// ---------------------------------------------------------------------------

describe('extractReferencedIdentifiers', () => {
  it('should extract identifiers excluding keywords', () => {
    const ids = extractReferencedIdentifiers('const x = data.map(y => y + 1)');
    expect(ids.has('x')).toBe(true);
    expect(ids.has('data')).toBe(true);
    expect(ids.has('y')).toBe(true);
    expect(ids.has('map')).toBe(true);
    // keywords should be excluded
    expect(ids.has('const')).toBe(false);
  });

  it('should exclude JS keywords', () => {
    const ids = extractReferencedIdentifiers('if (true) { return null }');
    expect(ids.has('if')).toBe(false);
    expect(ids.has('true')).toBe(false);
    expect(ids.has('return')).toBe(false);
    expect(ids.has('null')).toBe(false);
  });

  it('should ignore identifiers that only appear in comments or strings', () => {
    const ids = extractReferencedIdentifiers(
      [
        'const actual = data.length;',
        '// fakeCommentRef',
        'const text = "fakeStringRef";',
      ].join('\n')
    );
    expect(ids.has('actual')).toBe(true);
    expect(ids.has('data')).toBe(true);
    expect(ids.has('length')).toBe(true);
    expect(ids.has('fakeCommentRef')).toBe(false);
    expect(ids.has('fakeStringRef')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateHindsight
// ---------------------------------------------------------------------------

describe('evaluateHindsight', () => {
  it('should tag error→success as dead-end rank 0', () => {
    const prev = makeErrorEntry(1);
    const curr = makeSuccessEntry(2);
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBe(0);
    expect(prev.tags).toContain('dead-end');
  });

  it('should tag error→error (same signature) as dead-end rank 0', () => {
    const prev = makeErrorEntry(1, 'TypeError: x is not a function');
    const curr = makeErrorEntry(2, 'TypeError: x is not a function');
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBe(0);
    expect(prev.tags).toContain('dead-end');
  });

  it('should tag error→error (different signature) as pivot rank 3', () => {
    const prev = makeErrorEntry(1, 'TypeError: x is not a function');
    const curr = makeErrorEntry(2, 'ReferenceError: y is not defined');
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBe(3);
    expect(prev.tags).toContain('pivot');
  });

  it('should tag success→success (references prev vars) as foundational rank 5', () => {
    const prev = makeSuccessEntry(1, 'const data = [1,2,3]');
    const curr = makeSuccessEntry(2, 'console.log(data.length)');
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBe(5);
    expect(prev.tags).toContain('foundational');
  });

  it('should tag success→success (no reference) as superseded rank 1', () => {
    const prev = makeSuccessEntry(1, 'const approach1 = "a"');
    const curr = makeSuccessEntry(2, 'const approach2 = "b"');
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBe(1);
    expect(prev.tags).toContain('superseded');
  });

  it('should not tag success→error (regression)', () => {
    const prev = makeSuccessEntry(1, 'const x = 1');
    const curr = makeErrorEntry(2);
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBeUndefined();
    expect(prev.tags).toEqual([]); // unchanged
  });

  it('should not duplicate tags on repeated evaluation', () => {
    const prev = makeErrorEntry(1);
    const curr = makeSuccessEntry(2);
    evaluateHindsight(prev, curr);
    evaluateHindsight(prev, curr); // call again
    const deadEndCount = prev.tags.filter((t) => t === 'dead-end').length;
    expect(deadEndCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// manageContext
// ---------------------------------------------------------------------------

describe('manageContext', () => {
  it('should prune error entries when errorPruning is enabled and new entry is success', async () => {
    const entries: ActionLogEntry[] = [makeErrorEntry(1), makeSuccessEntry(2)];
    await manageContext(entries, 1, {
      errorPruning: true,
      hindsightEvaluation: false,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.turn).toBe(2);
  });

  it('should NOT prune error entries when new entry is also an error', async () => {
    const entries: ActionLogEntry[] = [makeErrorEntry(1), makeErrorEntry(2)];
    await manageContext(entries, 1, {
      errorPruning: true,
      hindsightEvaluation: false,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    expect(entries).toHaveLength(2);
  });

  it('should evaluate hindsight and prune low-rank entries', async () => {
    // Turn 1 succeeds with var approach1, Turn 2 succeeds with var approach2 (no reference)
    const entries: ActionLogEntry[] = [
      makeSuccessEntry(1, 'const approach1 = "a"'),
      makeSuccessEntry(2, 'const approach2 = "b"'),
    ];
    await manageContext(entries, 1, {
      errorPruning: false,
      hindsightEvaluation: true,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    // Turn 1 gets rank 1 (superseded) < pruneRank 2 → pruned
    expect(entries).toHaveLength(1);
    expect(entries[0]!.turn).toBe(2);
  });

  it('should keep foundational entries above pruneRank', async () => {
    const entries: ActionLogEntry[] = [
      makeSuccessEntry(1, 'const data = [1,2,3]'),
      makeSuccessEntry(2, 'console.log(data.length)'),
    ];
    await manageContext(entries, 1, {
      errorPruning: false,
      hindsightEvaluation: true,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    // Turn 1 gets rank 5 (foundational) >= pruneRank 2 → kept
    expect(entries).toHaveLength(2);
  });

  it('should always keep the last entry even if low rank', async () => {
    const entries: ActionLogEntry[] = [makeSuccessEntry(1, 'const x = 1')];
    // Manually set a low rank
    entries[0]!.rank = 0;
    await manageContext(entries, 0, {
      errorPruning: false,
      hindsightEvaluation: true,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    // Last entry is never pruned
    expect(entries).toHaveLength(1);
  });

  it('should keep error entries with tombstone during error pruning', async () => {
    const entries: ActionLogEntry[] = [
      { ...makeErrorEntry(1), tombstone: '[TOMBSTONE]: Fixed it.' },
      makeSuccessEntry(2),
    ];
    await manageContext(entries, 1, {
      errorPruning: true,
      hindsightEvaluation: false,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    // Error with tombstone should be kept
    expect(entries).toHaveLength(2);
    expect(entries[0]!.tombstone).toBe('[TOMBSTONE]: Fixed it.');
  });

  it('should keep error entries with pending tombstone during error pruning', async () => {
    const pendingEntry = makeErrorEntry(1);
    pendingEntry._tombstonePromise = new Promise(() => {}); // never resolves
    const entries: ActionLogEntry[] = [pendingEntry, makeSuccessEntry(2)];
    await manageContext(entries, 1, {
      errorPruning: true,
      hindsightEvaluation: false,
      tombstoning: undefined,
      pruneRank: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    // Error with pending tombstone should be kept
    expect(entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// generateTombstoneAsync
// ---------------------------------------------------------------------------

describe('generateTombstoneAsync', () => {
  it('should call ai.chat and return the result', async () => {
    const mockAi = {
      chat: vi.fn().mockResolvedValue({
        results: [
          { content: '[TOMBSTONE]: Fixed TypeError. Avoid: bad call.' },
        ],
      }),
    };
    const result = await generateTombstoneAsync(
      mockAi as any,
      undefined,
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );
    expect(result).toBe('[TOMBSTONE]: Fixed TypeError. Avoid: bad call.');
    expect(mockAi.chat).toHaveBeenCalledTimes(1);
  });

  it('should pass model override when forwardOptions.model is specified', async () => {
    const mockAi = {
      chat: vi.fn().mockResolvedValue({
        results: [{ content: '[TOMBSTONE]: Done.' }],
      }),
    };
    await generateTombstoneAsync(
      mockAi as any,
      { model: 'claude-3-5-haiku' },
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );
    const chatArg = mockAi.chat.mock.calls[0]![0];
    expect(chatArg.model).toBe('claude-3-5-haiku');
  });

  it('should pass modelConfig override when forwardOptions.modelConfig is specified', async () => {
    const mockAi = {
      chat: vi.fn().mockResolvedValue({
        results: [{ content: '[TOMBSTONE]: Done.' }],
      }),
    };
    await generateTombstoneAsync(
      mockAi as any,
      { modelConfig: { temperature: 0.1, maxTokens: 50 } },
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );
    const chatArg = mockAi.chat.mock.calls[0]![0];
    expect(chatArg.modelConfig).toEqual({ temperature: 0.1, maxTokens: 50 });
  });

  it('should return fallback on error', async () => {
    const mockAi = {
      chat: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const result = await generateTombstoneAsync(
      mockAi as any,
      undefined,
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );
    expect(result).toContain('[TOMBSTONE]');
    expect(result).toContain('resolved');
  });
});

// ---------------------------------------------------------------------------
// buildActionLog
// ---------------------------------------------------------------------------

describe('buildActionLog', () => {
  it('should return empty string for no entries', () => {
    expect(buildActionLog([])).toBe('');
  });

  it('should render normal entries with code blocks', () => {
    const entries = [makeSuccessEntry(1, 'var x = 1', 'ok')];
    const log = buildActionLog(entries);
    expect(log).toContain('Action 1:');
    expect(log).toContain('```javascript');
    expect(log).toContain('var x = 1');
    expect(log).toContain('Result:\nok');
  });

  it('should render tombstoned entries as compact one-liners', () => {
    const entries = [
      { ...makeErrorEntry(1), tombstone: '[TOMBSTONE]: Fixed it.' },
    ];
    const log = buildActionLog(entries);
    expect(log).toContain('Action 1:');
    expect(log).toContain('[TOMBSTONE]: Fixed it.');
    expect(log).not.toContain('```javascript');
  });

  it('should mix tombstoned and normal entries', () => {
    const entries = [
      { ...makeErrorEntry(1), tombstone: '[TOMBSTONE]: Fixed it.' },
      makeSuccessEntry(2, 'var y = 2', '2'),
    ];
    const log = buildActionLog(entries);
    expect(log).toContain('[TOMBSTONE]');
    expect(log).toContain('```javascript');
    expect(log).toContain('var y = 2');
  });

  it('should replace checkpointed successful turns with a checkpoint block', () => {
    const entries = [
      makeSuccessEntry(1, 'const draft = "v1"', 'draft ready'),
      makeSuccessEntry(2, 'const finalDraft = "v2"', 'final ready'),
    ];
    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'adaptive',
      recentFullActions: 1,
      checkpointSummary: [
        'Objective: refine the draft',
        'Durable state: draft, finalDraft',
      ].join('\n'),
      checkpointTurns: [1],
    });
    expect(log).toContain('Checkpoint Summary:');
    expect(log).toContain('Objective: refine the draft');
    expect(log).not.toContain('const draft = "v1"');
    expect(log).toContain('const finalDraft = "v2"');
  });

  it('should keep referenced prior steps fully rendered in adaptive mode', () => {
    const entries = [
      makeSuccessEntry(1, 'const data = [1,2,3]', 'data ready'),
      makeSuccessEntry(2, 'const length = data.length', '3'),
      makeSuccessEntry(3, 'final(length)', '(no output)'),
    ];
    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'adaptive',
      recentFullActions: 1,
    });
    expect(log).toContain('const data = [1,2,3]');
    expect(log).toContain('const length = data.length');
  });

  it('should include a live runtime state block in minimal mode', () => {
    const entries = [makeSuccessEntry(1, 'const total = 5', '5')];
    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'minimal',
      recentFullActions: 0,
      stateSummary: 'total: number = 5',
      checkpointSummary: 'Objective: inspect totals\nDurable state: total',
      checkpointTurns: [1],
    });
    expect(log).toContain('Live Runtime State:');
    expect(log).toContain('total: number = 5');
    expect(log).toContain('Checkpoint Summary:');
  });
});

describe('buildActionEvidenceSummary', () => {
  it('should prefer checkpoint summaries over raw historical code', () => {
    const entries = [
      makeSuccessEntry(1, 'const draft = "v1"', 'draft ready'),
      makeErrorEntry(2, 'ReferenceError: draft2 is not defined'),
    ];
    const summary = buildActionEvidenceSummary(entries, {
      stateSummary: 'draft: string = "v1"',
      checkpointSummary: 'Objective: draft answer\nDurable state: draft',
      checkpointTurns: [1],
    });
    expect(summary).toContain('Evidence summary');
    expect(summary).toContain('Checkpoint summary');
    expect(summary).toContain('draft: string = "v1"');
    expect(summary).not.toContain('```javascript');
    expect(summary).not.toContain('const draft = "v1"');
  });
});

describe('generateCheckpointSummaryAsync', () => {
  it('should call ai.chat and return the checkpoint summary', async () => {
    const mockAi = {
      chat: vi.fn().mockResolvedValue({
        results: [
          {
            content: [
              'Objective: verify draft',
              'Durable state: draft',
              'Evidence: draft ready',
              'Conclusions: use draft',
              'Actor fields: none',
              'Next step: finalize answer',
            ].join('\n'),
          },
        ],
      }),
    };

    const result = await generateCheckpointSummaryAsync(mockAi as any, [
      makeSuccessEntry(1, 'const draft = "v1"', 'draft ready'),
    ]);

    expect(result).toContain('Objective: verify draft');
    expect(mockAi.chat).toHaveBeenCalledTimes(1);
  });

  it('should return a deterministic fallback on error', async () => {
    const mockAi = {
      chat: vi.fn().mockRejectedValue(new Error('network error')),
    };

    const result = await generateCheckpointSummaryAsync(mockAi as any, [
      makeSuccessEntry(1, 'const draft = "v1"', 'draft ready'),
    ]);

    expect(result).toContain('Objective:');
    expect(result).toContain('Durable state: draft');
  });
});

// ---------------------------------------------------------------------------
// buildInspectRuntimeCode
// ---------------------------------------------------------------------------

describe('buildInspectRuntimeCode', () => {
  it('should return executable JavaScript code', () => {
    const code = buildInspectRuntimeCode(['llmQuery', 'final']);
    expect(code).toContain('globalThis');
    expect(code).toContain("'llmQuery'");
    expect(code).toContain("'final'");
  });

  it('should be a self-executing function', () => {
    const code = buildInspectRuntimeCode([]);
    expect(code.trim().startsWith('(() =>')).toBe(true);
    expect(code.trim().endsWith(')()')).toBe(true);
  });

  it('should include baseline globals in the skip list', () => {
    const code = buildInspectRuntimeCode(['llmQuery'], ['setImmediate']);
    expect(code).toContain("'llmQuery'");
    expect(code).toContain("'setImmediate'");
  });
});

describe('buildInspectRuntimeBaselineCode', () => {
  it('should collect baseline globals from globalThis', () => {
    const code = buildInspectRuntimeBaselineCode();
    expect(code).toContain('Object.getOwnPropertyNames(globalThis)');
    expect(code.trim().startsWith('(() =>')).toBe(true);
  });
});
