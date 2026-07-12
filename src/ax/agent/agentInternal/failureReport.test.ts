import { describe, expect, it } from 'vitest';
import type {
  ActionLogEntry,
  ActionLogFunctionCall,
} from '../contextManager.js';
import {
  axPlaybookFailureSection,
  buildFailureReport,
  formatFailureFeedback,
  mergeFailureSignals,
} from './failureReport.js';

function makeEntry(
  turn: number,
  opts: {
    code?: string;
    output?: string;
    error?: boolean;
    summary?: string;
    functionCalls?: ActionLogFunctionCall[];
  } = {}
): ActionLogEntry {
  return {
    turn,
    code: opts.code ?? `step${turn}()`,
    output: opts.output ?? 'ok',
    tags: opts.error ? ['error'] : [],
    ...(opts.summary ? { summary: opts.summary } : {}),
    ...(opts.functionCalls ? { _functionCalls: opts.functionCalls } : {}),
  };
}

const BOOM = 'TypeError: boom is not a function';

describe('buildFailureReport', () => {
  it('returns undefined for clean and empty runs', () => {
    expect(buildFailureReport([], 'executor')).toBeUndefined();
    expect(
      buildFailureReport([makeEntry(1), makeEntry(2)], 'executor')
    ).toBeUndefined();
  });

  it('reports a trailing unresolved error as error_turn', () => {
    const report = buildFailureReport(
      [makeEntry(1), makeEntry(2, { error: true, output: BOOM })],
      'executor'
    );
    expect(report?.stage).toBe('executor');
    expect(report?.signals).toHaveLength(1);
    const signal = report?.signals[0];
    expect(signal?.kind).toBe('error_turn');
    expect(signal?.turn).toBe(2);
    expect(signal?.signature).toBe(BOOM);
    expect(signal?.detail).toContain('boom is not a function');
    expect(signal?.code).toContain('step2()');
    expect(signal?.occurrences).toBe(1);
  });

  it('upgrades an error followed by success (signature never recurs) to resolved_error', () => {
    const report = buildFailureReport(
      [
        makeEntry(1, { error: true, output: BOOM, code: 'callBoom()' }),
        makeEntry(2, { summary: 'used the exported helper instead' }),
      ],
      'executor'
    );
    const signal = report?.signals[0];
    expect(signal?.kind).toBe('resolved_error');
    expect(signal?.resolvedByTurn).toBe(2);
    expect(signal?.detail).toContain(
      'resolved by: used the exported helper instead'
    );
  });

  it('does not report resolved_error when the signature recurs later', () => {
    const report = buildFailureReport(
      [
        makeEntry(1, { error: true, output: BOOM }),
        makeEntry(2),
        makeEntry(3, { error: true, output: BOOM }),
      ],
      'executor'
    );
    const kinds = report?.signals.map((s) => s.kind).sort();
    expect(kinds).toEqual(['dead_end', 'error_turn']);
    expect(report?.signals.every((s) => s.signature === BOOM)).toBe(true);
  });

  it('tags a repeated same-signature error as dead_end and its resolution as resolved_error', () => {
    const report = buildFailureReport(
      [
        makeEntry(1, { error: true, output: BOOM }),
        makeEntry(2, { error: true, output: BOOM }),
        makeEntry(3, { summary: 'switched approach' }),
      ],
      'executor'
    );
    const kinds = report?.signals.map((s) => s.kind).sort();
    expect(kinds).toEqual(['dead_end', 'resolved_error']);
  });

  it('does not mutate the source entries', () => {
    const entries = [
      makeEntry(1, { error: true, output: BOOM }),
      makeEntry(2, { error: true, output: BOOM }),
      makeEntry(3),
    ];
    buildFailureReport(entries, 'executor');
    expect(entries[0]?.tags).toEqual(['error']);
    expect(entries[1]?.tags).toEqual(['error']);
    expect(entries[2]?.tags).toEqual([]);
    expect(entries[0]?.rank).toBeUndefined();
  });

  it('reports failing runtime calls as tool_error with merged occurrences', () => {
    const call: ActionLogFunctionCall = {
      qualifiedName: 'db.search',
      error: 'timeout after 3s',
      arguments: { query: 'q' },
    };
    const report = buildFailureReport(
      [
        makeEntry(1, {
          functionCalls: [call, { ...call, arguments: undefined }],
        }),
        makeEntry(2),
      ],
      'distiller'
    );
    expect(report?.stage).toBe('distiller');
    expect(report?.signals).toHaveLength(1);
    const signal = report?.signals[0];
    expect(signal?.kind).toBe('tool_error');
    expect(signal?.signature).toContain('db.search');
    expect(signal?.detail).toContain('db.search failed: timeout after 3s');
    expect(signal?.occurrences).toBe(2);
    expect(signal?.code).toContain('"query"');
  });

  it('ignores successful runtime calls', () => {
    const report = buildFailureReport(
      [
        makeEntry(1, {
          functionCalls: [{ qualifiedName: 'db.search', result: 'hit' }],
        }),
      ],
      'executor'
    );
    expect(report).toBeUndefined();
  });
});

describe('mergeFailureSignals', () => {
  it('merges duplicate (kind, signature) pairs across stage reports', () => {
    const distiller = buildFailureReport(
      [makeEntry(1, { error: true, output: BOOM })],
      'distiller'
    );
    const executor = buildFailureReport(
      [
        makeEntry(1, { error: true, output: BOOM }),
        makeEntry(2, { error: true, output: 'RangeError: too big' }),
      ],
      'executor'
    );
    const merged = mergeFailureSignals([distiller, executor, undefined]);
    expect(merged).toHaveLength(2);
    const boomErrorTurn = merged.find(
      (s) => s.kind === 'error_turn' && s.signature === BOOM
    );
    expect(boomErrorTurn?.occurrences).toBe(2);
    expect(
      merged.find((s) => s.signature === 'RangeError: too big')
    ).toBeDefined();
  });
});

describe('formatFailureFeedback', () => {
  it('renders bracketed signatures and the curator steering', () => {
    const report = buildFailureReport(
      [makeEntry(1, { error: true, output: BOOM })],
      'executor'
    );
    const feedback = formatFailureFeedback(
      report?.signals ?? [],
      'compute the totals'
    );
    expect(feedback).toContain(`[${BOOM}]`);
    expect(feedback).toContain(axPlaybookFailureSection);
    expect(feedback).toContain('compute the totals');
    expect(feedback).toContain(
      'One concise avoidance or fix rule per failure mode'
    );
  });

  it('marks merged occurrence counts and truncates long tasks', () => {
    const signals = mergeFailureSignals([
      buildFailureReport(
        [makeEntry(1, { error: true, output: BOOM })],
        'distiller'
      ),
      buildFailureReport(
        [makeEntry(1, { error: true, output: BOOM })],
        'executor'
      ),
    ]);
    const longTask = 'z'.repeat(500);
    const feedback = formatFailureFeedback(signals, longTask);
    expect(feedback).toContain('(error_turn (x2))');
    expect(feedback).not.toContain(longTask);
    expect(feedback).toContain('z'.repeat(100));
  });

  it('notes omitted signals beyond the cap', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeEntry(i + 1, {
        error: true,
        output: `TypeError: fail_${i} is broken`,
      })
    );
    const report = buildFailureReport(entries, 'executor');
    const feedback = formatFailureFeedback(report?.signals ?? [], 'task');
    expect(feedback).toContain('more signals omitted');
  });
});
