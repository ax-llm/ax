import { describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { ActionLogEntry } from './contextManager.js';
import {
  buildActionEvidenceSummary,
  buildActionLog,
  buildActionLogReplayPlan,
  buildActionLogWithPolicy,
  buildInspectRuntimeBaselineCode,
  buildInspectRuntimeCode,
  buildRuntimeStateProvenance,
  evaluateHindsight,
  extractDeclaredVariables,
  extractErrorSignature,
  extractReadIdentifiers,
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

const makeModelUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

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

describe('extractReadIdentifiers', () => {
  it('should exclude identifiers declared in the current turn', () => {
    const ids = extractReadIdentifiers(
      'const data = computeFresh(); const next = prior + 1;'
    );

    expect(ids.has('data')).toBe(false);
    expect(ids.has('next')).toBe(false);
    expect(ids.has('prior')).toBe(true);
  });
});

describe('buildRuntimeStateProvenance', () => {
  it('should track the latest producing turn and callable source per variable', () => {
    const provenance = buildRuntimeStateProvenance([
      makeSuccessEntry(
        1,
        'const rows = await db.search({ query: "widgets" })',
        '[{"id":1}]'
      ),
      makeSuccessEntry(2, 'console.log(rows.length)', '1'),
      makeSuccessEntry(3, 'const draft = rows.map(row => row.id)', '[1]'),
    ]);

    expect(provenance.get('rows')).toEqual({
      createdTurn: 1,
      lastReadTurn: 3,
      source: 'db.search',
      stepKind: 'transform',
    });
    expect(provenance.get('draft')).toEqual({
      createdTurn: 3,
      source: 'rows.map',
      stepKind: 'transform',
    });
  });

  it('should reset provenance when a variable is overwritten in a later turn', () => {
    const provenance = buildRuntimeStateProvenance([
      makeSuccessEntry(1, 'const rows = await db.search({ query: "old" })'),
      makeSuccessEntry(2, 'const rows = await db.search({ query: "new" })'),
      makeSuccessEntry(3, 'console.log(rows.length)'),
    ]);

    expect(provenance.get('rows')).toEqual({
      createdTurn: 2,
      lastReadTurn: 3,
      source: 'db.search',
      stepKind: 'transform',
    });
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

  it('should not treat redeclarations in the current turn as foundational references', () => {
    const prev = makeSuccessEntry(1, 'const data = [1,2,3]');
    const curr = makeSuccessEntry(2, 'const data = [4,5,6]');
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBe(1);
    expect(prev.tags).toContain('superseded');
    expect(prev.tags).not.toContain('foundational');
  });

  it('should leave output-only exploration turns unranked when no dependency is clear', () => {
    const prev = makeSuccessEntry(1, 'console.log("preview")', 'preview');
    const curr = makeSuccessEntry(2, 'const answer = 42');
    evaluateHindsight(prev, curr);
    expect(prev.rank).toBeUndefined();
    expect(prev.tags).toEqual([]);
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
  it('should keep resolved errors as deterministic tombstones when errorPruning is enabled', async () => {
    const entries: ActionLogEntry[] = [makeErrorEntry(1), makeSuccessEntry(2)];
    await manageContext(entries, 1, {
      errorPruning: true,
      hindsightEvaluation: false,
      tombstoning: undefined,
      pruneRank: 2,
      rankPruneGraceTurns: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.turn).toBe(1);
    expect(entries[0]!.tombstone).toBe(
      '[TOMBSTONE]: Resolved TypeError: x is not a function in turn 2.'
    );
  });

  it('should NOT prune error entries when new entry is also an error', async () => {
    const entries: ActionLogEntry[] = [makeErrorEntry(1), makeErrorEntry(2)];
    await manageContext(entries, 1, {
      errorPruning: true,
      hindsightEvaluation: false,
      tombstoning: undefined,
      pruneRank: 2,
      rankPruneGraceTurns: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    expect(entries).toHaveLength(2);
  });

  it('should keep low-rank successful entries during the grace window', async () => {
    const entries: ActionLogEntry[] = [
      makeSuccessEntry(1, 'const approach1 = "a"'),
      makeSuccessEntry(2, 'const approach2 = "b"'),
    ];
    await manageContext(entries, 1, {
      errorPruning: false,
      hindsightEvaluation: true,
      tombstoning: undefined,
      pruneRank: 2,
      rankPruneGraceTurns: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.rank).toBe(1);
  });

  it('should prune superseded transform entries after the grace window expires', async () => {
    const entries: ActionLogEntry[] = [
      makeSuccessEntry(1, 'const approach1 = "a"'),
      makeSuccessEntry(2, 'const approach2 = "b"'),
    ];
    await manageContext(entries, 1, {
      errorPruning: false,
      hindsightEvaluation: true,
      tombstoning: undefined,
      pruneRank: 2,
      rankPruneGraceTurns: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });
    entries.push(makeSuccessEntry(3, 'const approach3 = "c"'));
    await manageContext(entries, 2, {
      errorPruning: false,
      hindsightEvaluation: true,
      tombstoning: undefined,
      pruneRank: 2,
      rankPruneGraceTurns: 2,
      actionReplay: 'full',
      recentFullActions: 1,
      stateSummary: { enabled: false },
      stateInspection: { enabled: false },
      checkpoints: { enabled: false },
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]!.turn).toBe(2);
    expect(entries[1]!.turn).toBe(3);
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
      rankPruneGraceTurns: 2,
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
      rankPruneGraceTurns: 2,
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
      rankPruneGraceTurns: 2,
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
      rankPruneGraceTurns: 2,
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
  it('should call the internal summarizer and return the result', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content:
              'Tombstone: [TOMBSTONE]: Fixed TypeError. Avoid: bad call.',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeModelUsage(),
      },
    });
    const chatSpy = vi.spyOn(mockAi, 'chat');

    const result = await generateTombstoneAsync(
      mockAi,
      undefined,
      undefined,
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );

    expect(result).toBe('[TOMBSTONE]: Fixed TypeError. Avoid: bad call.');
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it('should let request-level model options override tombstone defaults', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Tombstone: [TOMBSTONE]: Done.',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeModelUsage(),
      },
    });
    const chatSpy = vi.spyOn(mockAi, 'chat');

    await generateTombstoneAsync(
      mockAi,
      { model: 'summary-model', modelConfig: { temperature: 0.1 } },
      {
        model: 'request-model',
        modelConfig: { temperature: 0.3, maxTokens: 60 },
      },
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );

    const chatReq = chatSpy.mock.calls[0]?.[0];
    expect(chatReq?.model).toBe('request-model');
    expect(chatReq?.modelConfig).toEqual({
      temperature: 0.3,
      maxTokens: 60,
    });
  });

  it('should forward abortSignal to the internal tombstone summarizer', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Tombstone: [TOMBSTONE]: Done.',
            finishReason: 'stop',
          },
        ],
        modelUsage: makeModelUsage(),
      },
    });
    const chatSpy = vi.spyOn(mockAi, 'chat');
    const abortController = new AbortController();
    const logger = vi.fn();

    await generateTombstoneAsync(
      mockAi,
      undefined,
      { abortSignal: abortController.signal, debug: true, logger },
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );

    const chatOptions = chatSpy.mock.calls[0]?.[1];
    expect(chatOptions?.abortSignal).toBeDefined();
    abortController.abort('stop');
    expect(chatOptions?.abortSignal?.aborted).toBe(true);
    expect(chatOptions?.debug).toBe(true);
  });

  it('should return fallback on error', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      shouldError: true,
      errorMessage: 'network error',
    });

    const result = await generateTombstoneAsync(
      mockAi,
      undefined,
      undefined,
      makeErrorEntry(1),
      makeSuccessEntry(2)
    );

    expect(result).toContain('[TOMBSTONE]');
    expect(result).toContain('Resolved');
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

  it('should not hide adaptive full-replay entries even when checkpoint turns include them', () => {
    const entries = [
      makeSuccessEntry(1, 'const data = [1,2,3]', 'data ready'),
      makeSuccessEntry(2, 'const length = data.length', '3'),
      makeSuccessEntry(3, 'final(length)', '(no output)'),
    ];
    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'adaptive',
      recentFullActions: 1,
      checkpointSummary:
        'Objective: use prior data\nDurable state: data, length',
      checkpointTurns: [1, 2],
    });

    expect(log).toContain('const data = [1,2,3]');
    expect(log).toContain('const length = data.length');
    expect(log).toContain('Checkpoint Summary:');
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

  it('should render compact summaries for omitted successful turns in minimal mode', () => {
    const entries = [
      makeSuccessEntry(
        1,
        'console.log(rows.slice(0, 2))',
        '[{"id":1},{"id":2}]'
      ),
    ];
    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'minimal',
      recentFullActions: 0,
      stateSummary: '(no user variables)',
    });

    expect(log).toContain('Action 1:');
    expect(log).toContain('[SUMMARY]: Explore step.');
    expect(log).toContain('Result: [{"id":1},{"id":2}]');
    expect(log).not.toContain('```javascript');
  });

  it('should mix tombstones with summarized successful turns', () => {
    const entries = [
      { ...makeErrorEntry(1), tombstone: '[TOMBSTONE]: Fixed it.' },
      makeSuccessEntry(2, 'console.log(summary)', 'north up 12%'),
    ];
    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'minimal',
      recentFullActions: 0,
    });

    expect(log).toContain('[TOMBSTONE]: Fixed it.');
    expect(log).toContain('Action 2:');
    expect(log).toContain('[SUMMARY]: Explore step.');
    expect(log).toContain('north up 12%');
    expect(log).not.toContain('```javascript');
  });

  it('should report replay-history chars without counting live runtime state', () => {
    const entries = [
      makeSuccessEntry(1, 'const total = 5', '5'),
      makeSuccessEntry(2, 'console.log(total)', '5'),
    ];
    const replayPlan = buildActionLogReplayPlan(entries, {
      actionReplay: 'adaptive',
      recentFullActions: 1,
    });
    const renderedLog = buildActionLogWithPolicy(entries, {
      actionReplay: 'adaptive',
      recentFullActions: 1,
      stateSummary:
        'total: number = 5\nlongState: string = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
    });

    expect(replayPlan.historyChars).toBe(replayPlan.historyText.length);
    expect(renderedLog.length).toBeGreaterThan(replayPlan.historyChars);
  });

  it('should prune used discovery docs while keeping unrelated sections visible', () => {
    const entries = [
      makeSuccessEntry(
        1,
        "const modules = await listModuleFunctions(['db', 'kb']); console.log(modules)",
        [
          '### Module `db`',
          '- `search`',
          '',
          '### Module `kb`',
          '- `lookup`',
        ].join('\n')
      ),
      makeSuccessEntry(
        2,
        "const defs = await getFunctionDefinitions(['db.search', 'kb.lookup']); console.log(defs)",
        [
          '### `db.search`',
          'Search database',
          '- `db.search(args: { query: string })`',
          '',
          '### `kb.lookup`',
          'Lookup docs',
          '- `kb.lookup(args: { topic: string })`',
        ].join('\n')
      ),
      makeSuccessEntry(
        3,
        'const rows = await db.search({ query: "widgets" }); console.log(rows)',
        '[{"id":1}]'
      ),
    ];

    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'full',
      recentFullActions: 3,
      pruneUsedDocs: true,
    });

    expect(log).not.toContain('### Module `db`');
    expect(log).toContain('### Module `kb`');
    expect(log).not.toContain('### `db.search`');
    expect(log).toContain('### `kb.lookup`');
  });

  it('should suppress fully consumed discovery entries from the rendered action log', () => {
    const entries = [
      makeSuccessEntry(
        1,
        "const modules = await listModuleFunctions('db'); console.log(modules)",
        ['### Module `db`', '- `search`'].join('\n')
      ),
      makeSuccessEntry(
        2,
        "const defs = await getFunctionDefinitions('db.search'); console.log(defs)",
        [
          '### `db.search`',
          'Search database',
          '- `db.search(args: { query: string })`',
        ].join('\n')
      ),
      makeSuccessEntry(
        3,
        'const rows = await db.search({ query: "widgets" }); console.log(rows)',
        '[{"id":1}]'
      ),
    ];

    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'full',
      recentFullActions: 3,
      pruneUsedDocs: true,
    });

    expect(log).not.toContain(
      "const modules = await listModuleFunctions('db')"
    );
    expect(log).not.toContain(
      "const defs = await getFunctionDefinitions('db.search')"
    );
    expect(log).toContain('const rows = await db.search');
  });

  it('should keep discovery docs visible after failed callable attempts', () => {
    const entries = [
      makeSuccessEntry(
        1,
        "const modules = await listModuleFunctions('db'); console.log(modules)",
        ['### Module `db`', '- `search`'].join('\n')
      ),
      makeSuccessEntry(
        2,
        "const defs = await getFunctionDefinitions('db.search'); console.log(defs)",
        [
          '### `db.search`',
          'Search database',
          '- `db.search(args: { query: string })`',
        ].join('\n')
      ),
      makeEntry({
        turn: 3,
        code: 'const rows = await db.search({ query: "widgets" }); console.log(rows)',
        output: 'TypeError: db.search failed',
        tags: ['error'],
      }),
    ];

    const log = buildActionLogWithPolicy(entries, {
      actionReplay: 'full',
      recentFullActions: 3,
      pruneUsedDocs: true,
    });

    expect(log).toContain('### Module `db`');
    expect(log).toContain('### `db.search`');
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

  it('should not reintroduce pruned discovery docs in evidence summaries', () => {
    const entries = [
      makeSuccessEntry(
        1,
        "const defs = await getFunctionDefinitions(['db.search', 'kb.lookup']); console.log(defs)",
        [
          '### `db.search`',
          'Search database',
          '- `db.search(args: { query: string })`',
          '',
          '### `kb.lookup`',
          'Lookup docs',
          '- `kb.lookup(args: { topic: string })`',
        ].join('\n')
      ),
      makeSuccessEntry(
        2,
        'const rows = await db.search({ query: "widgets" }); console.log(rows)',
        '[{"id":1}]'
      ),
    ];

    const summary = buildActionEvidenceSummary(entries, {
      pruneUsedDocs: true,
    });

    expect(summary).not.toContain('db.search(args');
    expect(summary).toContain('kb.lookup(args');
  });
});

describe('generateCheckpointSummaryAsync', () => {
  it('should call the internal summarizer and return the checkpoint summary', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: [
              'Checkpoint Summary: Objective: verify draft',
              'Durable state: draft',
              'Evidence: draft ready',
              'Conclusions: use draft',
              'Actor fields: none',
              'Next step: finalize answer',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeModelUsage(),
      },
    });
    const chatSpy = vi.spyOn(mockAi, 'chat');

    const result = await generateCheckpointSummaryAsync(
      mockAi,
      undefined,
      undefined,
      [makeSuccessEntry(1, 'const draft = "v1"', 'draft ready')]
    );

    expect(result).toContain('Objective: verify draft');
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it('should let request-level model options override checkpoint defaults', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: [
              'Checkpoint Summary: Objective: verify draft',
              'Durable state: draft',
              'Evidence: draft ready',
              'Conclusions: use draft',
              'Actor fields: none',
              'Next step: finalize answer',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeModelUsage(),
      },
    });
    const chatSpy = vi.spyOn(mockAi, 'chat');

    await generateCheckpointSummaryAsync(
      mockAi,
      { model: 'summary-model', modelConfig: { temperature: 0.1 } },
      {
        model: 'request-model',
        modelConfig: { temperature: 0.4, maxTokens: 180 },
      },
      [makeSuccessEntry(1, 'const draft = "v1"', 'draft ready')]
    );

    const chatReq = chatSpy.mock.calls[0]?.[0];
    expect(chatReq?.model).toBe('request-model');
    expect(chatReq?.modelConfig).toEqual({
      temperature: 0.4,
      maxTokens: 180,
    });
  });

  it('should forward abortSignal to the internal checkpoint summarizer', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: [
              'Checkpoint Summary: Objective: verify draft',
              'Durable state: draft',
              'Evidence: draft ready',
              'Conclusions: use draft',
              'Actor fields: none',
              'Next step: finalize answer',
            ].join('\n'),
            finishReason: 'stop',
          },
        ],
        modelUsage: makeModelUsage(),
      },
    });
    const chatSpy = vi.spyOn(mockAi, 'chat');
    const abortController = new AbortController();
    const logger = vi.fn();

    await generateCheckpointSummaryAsync(
      mockAi,
      undefined,
      { abortSignal: abortController.signal, debug: true, logger },
      [makeSuccessEntry(1, 'const draft = "v1"', 'draft ready')]
    );

    const chatOptions = chatSpy.mock.calls[0]?.[1];
    expect(chatOptions?.abortSignal).toBeDefined();
    abortController.abort('stop');
    expect(chatOptions?.abortSignal?.aborted).toBe(true);
    expect(chatOptions?.debug).toBe(true);
  });

  it('should return a deterministic fallback on error', async () => {
    const mockAi = new AxMockAIService({
      features: { functions: false, streaming: false },
      shouldError: true,
      errorMessage: 'network error',
    });

    const result = await generateCheckpointSummaryAsync(
      mockAi,
      undefined,
      undefined,
      [makeSuccessEntry(1, 'const draft = "v1"', 'draft ready')]
    );

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
    expect(code).toContain('Object.getOwnPropertyDescriptor(globalThis, name)');
    expect(code).toContain('JSON.stringify({ version: 1, entries })');
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
