import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../../../ai/mock/api.js';
import { agent } from '../../index.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

const FIX_MARKER = 'ALWAYS_COMPUTE_INLINE';

/**
 * Scripted mock model for the full improve() loop:
 *  - distiller: hands off to the executor.
 *  - executor: errors on a missing helper UNTIL the fix marker (applied by an
 *    accepted instruction proposal) appears in its system prompt, then
 *    finishes cleanly — the mock's behavior genuinely depends on the applied
 *    instruction, so accept/reject flows are exercised end-to-end.
 *  - miner: emits a weakness grounded in the real excerpt text.
 *  - responder: answer depends on the executor's evidence.
 */
function improveScriptedAI() {
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
      const userText = req.chatPrompt
        .filter((m) => m.role === 'user')
        .map((m) => String(m.content ?? ''))
        .join('\n');
      const reply = (content: string) => ({
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: makeModelUsage() as any,
      });
      if (systemPrompt.includes('You (`distiller`)')) {
        return reply('Javascript Code: await final("Answer the question", {})');
      }
      if (systemPrompt.includes('You (`executor`)')) {
        if (systemPrompt.includes(FIX_MARKER)) {
          return reply(
            'Javascript Code: await final("Answer the question", { note: "fixed" })'
          );
        }
        if (userText.includes('brokenHelper is not defined')) {
          return reply(
            'Javascript Code: await final("Answer the question", { note: "gave up" })'
          );
        }
        return reply('Javascript Code: console.log(brokenHelper())');
      }
      if (systemPrompt.includes('failure analyst')) {
        return reply(
          [
            'Weakness Description: The actor calls an undeclared helper.',
            'Root Cause: Generated code references brokenHelper, which does not exist in the runtime.',
            'Target Surface: instructions',
            `Proposed Guidance: ${FIX_MARKER}: never call undeclared helpers; compute the answer inline.`,
            'Evidence Quotes: ["brokenHelper is not defined"]',
          ].join('\n')
        );
      }
      // Responder: answer reflects whether the run recovered.
      return reply(
        userText.includes('fixed') ? 'Answer: ok-fixed' : 'Answer: gave-up'
      );
    },
  });
}

const TASKS = [
  { input: { question: 'q1' }, criteria: 'answers correctly', id: 't1' },
  { input: { question: 'q2' }, criteria: 'answers correctly', id: 't2' },
];

const scoreByAnswer = async ({ prediction }: any) =>
  prediction?.output?.answer === 'ok-fixed' ? 1 : 0.2;

function makeAgent() {
  const ai = improveScriptedAI();
  const ag = agent('question:string -> answer:string', {
    ai,
    directResponse: 'off',
    maxTurns: 4,
  }) as any;
  return { ag, ai };
}

const instructionOf = (ag: any): string =>
  ((ag.executor as any).instructionAddenda as string[] | undefined)?.join(
    '\n\n'
  ) ?? '';

const actorPromptOf = (ag: any): string =>
  (ag.executor as any).actorProgram?.getSignature?.().getDescription?.() ?? '';

describe('agent.improve()', () => {
  it('mines the weakness, accepts the fixing proposal, and improves held-in', async () => {
    const { ag } = makeAgent();
    const events: string[] = [];
    const result = await ag.improve(
      { train: TASKS, validation: [TASKS[0]!] },
      {
        metric: scoreByAnswer,
        surfaces: ['instructions'],
        maxProposals: 2,
        onProgress: (e: any) => void events.push(`${e.phase}:${e.message}`),
      }
    );

    expect(result.baseline.heldIn).toBeCloseTo(0.2);
    expect(result.weaknesses).toHaveLength(1);
    expect(result.weaknesses[0]?.evidenceQuotes).toEqual([
      'brokenHelper is not defined',
    ]);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.accepted).toBe(true);
    expect(result.outcomes[0]?.heldOut).toBeDefined();
    expect(result.final.heldIn).toBe(1);
    expect(result.final.heldOut).toBe(1);
    expect(instructionOf(ag)).toContain(FIX_MARKER);
    expect(actorPromptOf(ag)).toContain(FIX_MARKER);
    expect(result.appliedInstructionAddenda?.[0]).toContain(FIX_MARKER);
    expect(result.metricCallsUsed).toBeGreaterThan(0);
    expect(events.some((e) => e.startsWith('mining'))).toBe(true);
  });

  it('rejects a non-improving proposal and rolls the instruction back exactly', async () => {
    const { ag } = makeAgent();
    const before = instructionOf(ag);
    const result = await ag.improve(TASKS, {
      // The metric never rewards the fix, so the gain gate fails.
      metric: async () => 0.2,
      surfaces: ['instructions'],
      maxProposals: 1,
    });
    expect(result.outcomes[0]?.accepted).toBe(false);
    expect(result.outcomes[0]?.reason).toContain('held-in gain');
    expect(instructionOf(ag)).toBe(before);
    expect(result.final.heldIn).toBeCloseTo(result.baseline.heldIn);
  });

  it('rejects when the held-out set regresses even though held-in improves', async () => {
    const { ag } = makeAgent();
    const result = await ag.improve(
      { train: TASKS, validation: [{ ...TASKS[0]!, id: 'holdout' }] },
      {
        metric: async ({ example, prediction }: any) =>
          example.id === 'holdout'
            ? prediction?.output?.answer === 'ok-fixed'
              ? 0 // the "fix" tanks the held-out task
              : 1
            : prediction?.output?.answer === 'ok-fixed'
              ? 1
              : 0.2,
        surfaces: ['instructions'],
        maxProposals: 1,
      }
    );
    expect(result.outcomes[0]?.accepted).toBe(false);
    expect(result.outcomes[0]?.reason).toContain('held-out regressed');
    expect(instructionOf(ag)).not.toContain(FIX_MARKER);
  });

  it('apply: false rolls back accepted proposals but returns their state', async () => {
    const { ag } = makeAgent();
    const before = instructionOf(ag);
    const result = await ag.improve(TASKS, {
      metric: scoreByAnswer,
      surfaces: ['instructions'],
      maxProposals: 1,
      apply: false,
    });
    expect(result.outcomes[0]?.accepted).toBe(true);
    expect(instructionOf(ag)).toBe(before);
    expect(actorPromptOf(ag)).not.toContain(FIX_MARKER);
    expect(result.appliedInstructionAddenda?.[0]).toContain(FIX_MARKER);
  });

  it('skips validation when the metric budget is exhausted', async () => {
    const { ag } = makeAgent();
    const result = await ag.improve(TASKS, {
      metric: scoreByAnswer,
      surfaces: ['instructions'],
      maxProposals: 1,
      maxMetricCalls: 2, // baseline only
    });
    expect(result.outcomes[0]?.accepted).toBe(false);
    expect(result.outcomes[0]?.reason).toContain('metric_budget');
    expect(instructionOf(ag)).not.toContain(FIX_MARKER);
  });

  it('routes playbook-surface proposals through a lazily attached handle', async () => {
    const { ag } = makeAgent();
    expect(ag.getPlaybook()).toBeUndefined();
    const result = await ag.improve(TASKS, {
      metric: scoreByAnswer,
      surfaces: ['playbook'],
      maxProposals: 1,
    });
    const handle = ag.getPlaybook();
    expect(handle).toBeDefined();
    const update = vi.spyOn(handle, 'update');
    void update;
    // The proposal ran (accepted or not depends on whether the curator mock
    // changed behavior — with surfaces=['playbook'] the instruction fix never
    // lands, so the run cannot improve and the proposal is rejected + rolled
    // back). The important invariants: a handle exists, the outcome was
    // recorded, and the rollback left the playbook empty.
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.proposal.kind).toBe('playbook');
    expect(result.outcomes[0]?.accepted).toBe(false);
    expect(handle.getState().playbook.stats.bulletCount).toBe(0);
  });

  it('throws without train tasks and without any AI', async () => {
    const { ag } = makeAgent();
    await expect(ag.improve({ train: [] })).rejects.toThrow(
      /at least one training task/
    );
    const bare = agent('question:string -> answer:string', {
      ai: undefined as any,
    }) as any;
    await expect(
      bare.improve(TASKS, { metric: scoreByAnswer })
    ).rejects.toThrow(/studentAI is required/);
  });
});
