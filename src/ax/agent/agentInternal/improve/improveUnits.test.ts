import { describe, expect, it, vi } from 'vitest';
import type { AxAgentEvalPrediction } from '../agentOptimizeTypes.js';
import { runAgentEvalBatch } from './evalHarness.js';
import {
  BEHAVIORAL_CLUSTER_SIGNATURE,
  clusterFailures,
  isFailureRecord,
} from './failureClusters.js';
import type { AxAgentImproveRunRecord } from './improveTypes.js';
import { buildProposal } from './proposals.js';
import { buildFailureExcerpt, verifyEvidenceQuotes } from './weaknessMiner.js';

const BOOM = 'TypeError: boom is not a function';

function prediction(
  over: Partial<AxAgentEvalPrediction> = {}
): AxAgentEvalPrediction {
  return {
    completionType: 'final',
    output: { answer: 'x' },
    actionLog: '',
    functionCalls: [],
    toolErrors: [],
    turnCount: 1,
    ...over,
  } as AxAgentEvalPrediction;
}

function record(
  over: Partial<AxAgentImproveRunRecord> = {}
): AxAgentImproveRunRecord {
  return {
    task: { input: { q: 'x' }, criteria: 'answers' },
    prediction: prediction(),
    score: 0.2,
    passed: false,
    ...over,
  };
}

describe('failureClusters', () => {
  it('classifies failures by error, clarification, and score threshold', () => {
    expect(isFailureRecord(record({ score: 0.9, passed: true }), 0.7)).toBe(
      false
    );
    expect(isFailureRecord(record({ score: 0.2 }), 0.7)).toBe(true);
    expect(
      isFailureRecord(record({ prediction: undefined, error: 'kaput' }), 0.7)
    ).toBe(true);
    expect(
      isFailureRecord(
        record({
          score: 1,
          prediction: prediction({
            completionType: 'askClarification',
            output: undefined,
            clarification: { question: 'which?' } as any,
          }),
        }),
        0.7
      )
    ).toBe(true);
  });

  it('keys clusters by majority failure signal, then tool errors, then action log, then behavioral', () => {
    const clusters = clusterFailures(
      [
        record({
          prediction: prediction({
            failureSignals: [
              {
                kind: 'error_turn',
                turn: 1,
                signature: BOOM,
                detail: BOOM,
                occurrences: 2,
              },
              {
                kind: 'tool_error',
                turn: 1,
                signature: 'db.search: timeout',
                detail: 'x',
                occurrences: 1,
              },
            ],
          }),
        }),
        record({
          prediction: prediction({ toolErrors: ['db.search: timeout'] }),
        }),
        record({
          prediction: prediction({
            actionLog: 'Turn 1\nRangeError: too big\n',
          }),
        }),
        record({}),
      ],
      0.7,
      10
    );
    const signatures = clusters.map((c) => c.signature);
    expect(signatures).toContain(BOOM);
    expect(signatures).toContain('db.search: timeout');
    expect(signatures).toContain('RangeError: too big');
    expect(signatures).toContain(BEHAVIORAL_CLUSTER_SIGNATURE);
  });

  it('ranks by severity (count x mean miss) and honors maxClusters', () => {
    const clusters = clusterFailures(
      [
        record({
          score: 0,
          prediction: prediction({ toolErrors: ['a: down'] }),
        }),
        record({
          score: 0,
          prediction: prediction({ toolErrors: ['a: down'] }),
        }),
        record({
          score: 0.6,
          prediction: prediction({ toolErrors: ['b: slow'] }),
        }),
      ],
      0.7,
      1
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.signature).toBe('a: down');
    expect(clusters[0]?.severity).toBeCloseTo(2);
  });
});

describe('evalHarness', () => {
  const task = (id: string) => ({
    input: { q: id },
    criteria: 'answers',
    id,
  });

  it('runs sequentially, scores, and computes the weighted mean', async () => {
    const order: string[] = [];
    const agent = {
      _forwardForEvaluation: vi.fn(async (_ai: any, t: any) => {
        order.push(t.id);
        return prediction({ output: { answer: t.id } });
      }),
    };
    const result = await runAgentEvalBatch({
      agent,
      ai: {} as any,
      tasks: [
        { ...task('a'), weight: 3 },
        { ...task('b'), weight: 1 },
      ],
      metric: async ({ example }) =>
        (example as { id?: string }).id === 'a' ? 1 : 0,
      scoreThreshold: 0.7,
      budget: { remaining: 10 },
    });
    expect(order).toEqual(['a', 'b']);
    expect(result.mean).toBeCloseTo(0.75);
    expect(result.records[0]?.passed).toBe(true);
    expect(result.records[1]?.passed).toBe(false);
    expect(result.exhausted).toBe(false);
  });

  it('stops when the budget runs out and marks exhaustion', async () => {
    const agent = {
      _forwardForEvaluation: vi.fn(async () => prediction()),
    };
    const result = await runAgentEvalBatch({
      agent,
      ai: {} as any,
      tasks: [task('a'), task('b'), task('c')],
      metric: async () => 1,
      scoreThreshold: 0.7,
      budget: { remaining: 2 },
    });
    expect(result.records).toHaveLength(2);
    expect(result.exhausted).toBe(true);
  });

  it('records thrown runs as score-0 failures without killing the batch', async () => {
    let call = 0;
    const agent = {
      _forwardForEvaluation: vi.fn(async () => {
        call++;
        if (call === 1) {
          throw new Error('provider down');
        }
        return prediction();
      }),
    };
    const result = await runAgentEvalBatch({
      agent,
      ai: {} as any,
      tasks: [task('a'), task('b')],
      metric: async () => 1,
      scoreThreshold: 0.7,
      budget: { remaining: 10 },
    });
    expect(result.records[0]?.error).toContain('provider down');
    expect(result.records[0]?.score).toBe(0);
    expect(result.records[1]?.score).toBe(1);
  });
});

describe('weaknessMiner grounding', () => {
  it('keeps only quotes that appear (whitespace-insensitively) in the excerpts', () => {
    const excerpts = `--- run 1 ---\nTurn 1\n${BOOM}\n  at step2()`;
    expect(
      verifyEvidenceQuotes(
        [BOOM, 'TypeError:   boom is not a function', 'fabricated quote'],
        excerpts
      )
    ).toEqual([BOOM, 'TypeError:   boom is not a function']);
    expect(verifyEvidenceQuotes(['', '   '], excerpts)).toEqual([]);
  });

  it('centers excerpts on the signature and falls back to the tail', () => {
    const log = `${'x'.repeat(5000)}${BOOM}${'y'.repeat(5000)}`;
    const centered = buildFailureExcerpt(log, BOOM, 400);
    expect(centered).toContain(BOOM);
    const tail = buildFailureExcerpt(`${'z'.repeat(5000)}THE_END`, BOOM, 400);
    expect(tail.endsWith('THE_END')).toBe(true);
    expect(tail).toHaveLength(400);
  });
});

describe('proposals', () => {
  const weakness = (surface: 'playbook' | 'instructions') => ({
    id: 'weakness-1',
    clusterSignature: BOOM,
    description: 'calls broken helpers',
    rootCause: 'helper does not exist',
    surface,
    proposedGuidance: 'Compute inline; never call undeclared helpers.',
    evidenceQuotes: [BOOM],
    taskIds: ['task-0'],
    configRecommendations: [],
  });

  it('builds an instructions proposal with the trimmed addendum', () => {
    const proposal = buildProposal({
      ...weakness('instructions'),
      proposedGuidance: '  Compute inline; never call undeclared helpers. ',
    });
    expect(proposal).toEqual({
      kind: 'instructions',
      weaknessId: 'weakness-1',
      addendum: 'Compute inline; never call undeclared helpers.',
    });
  });

  it('builds a playbook proposal carrying signature, guidance, and quotes', () => {
    const proposal = buildProposal(weakness('playbook'));
    expect(proposal.kind).toBe('playbook');
    if (proposal.kind === 'playbook') {
      expect(proposal.clusterSignature).toBe(BOOM);
      expect(proposal.feedback).toContain(`[${BOOM}]`);
      expect(proposal.feedback).toContain('Compute inline');
      expect(proposal.feedback).toContain(BOOM);
    }
  });
});

describe('evalHarness runsPerTask', () => {
  const task = (id: string) => ({
    input: { q: id },
    criteria: 'answers',
    id,
  });

  it('averages repeated runs into one record and spends budget per run', async () => {
    let call = 0;
    const agent = {
      _forwardForEvaluation: vi.fn(async () => {
        call++;
        return prediction({ output: { answer: `run${call}` } });
      }),
    };
    const budget = { remaining: 10 };
    const result = await runAgentEvalBatch({
      agent,
      ai: {} as any,
      tasks: [task('a')],
      // Alternate 1 / 0 across repeats: mean must be 0.5.
      metric: async ({ prediction: p }: any) =>
        Number(
          String(p?.output?.answer).endsWith('1') ||
            String(p?.output?.answer).endsWith('3')
        ),
      scoreThreshold: 0.7,
      budget,
      runsPerTask: 2,
    });
    expect(agent._forwardForEvaluation).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(8);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.score).toBeCloseTo(0.5);
    expect(result.records[0]?.passed).toBe(false);
  });

  it('stops mid-task when the budget runs out and keeps the partial mean', async () => {
    const agent = {
      _forwardForEvaluation: vi.fn(async () => prediction()),
    };
    const result = await runAgentEvalBatch({
      agent,
      ai: {} as any,
      tasks: [task('a'), task('b')],
      metric: async () => 1,
      scoreThreshold: 0.7,
      budget: { remaining: 3 },
      runsPerTask: 2,
    });
    // Task a: 2 runs. Task b: 1 run before exhaustion.
    expect(result.records).toHaveLength(2);
    expect(result.records[1]?.score).toBe(1);
    expect(result.exhausted).toBe(true);
  });
});
