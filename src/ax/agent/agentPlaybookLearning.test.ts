import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxACEPlaybook } from '../dsp/optimizers/aceTypes.js';
import { axPlaybookFailureSection } from './agentInternal/failureReport.js';
import { agent } from './index.js';
import {
  collectCoveredFailureSignatures,
  DEFAULT_PLAYBOOK_MAX_REFLECTOR_ROUNDS,
  resolveAgentPlaybookConfig,
} from './playbookConfig.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

function buildPlaybook(section: string, content: string): AxACEPlaybook {
  return {
    version: 1,
    sections: {
      [section]: [
        {
          id: 'x-0',
          section,
          content,
          helpfulCount: 0,
          harmfulCount: 0,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ],
    },
    stats: {
      bulletCount: 1,
      helpfulCount: 0,
      harmfulCount: 0,
      tokenEstimate: 0,
    },
    updatedAt: new Date(0).toISOString(),
  };
}
const snapshot = (pb: AxACEPlaybook) => ({
  playbook: pb,
  artifact: { playbook: pb, feedback: [], history: [] },
});

function mockAI() {
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async () => ({
      results: [{ index: 0, content: 'ok', finishReason: 'stop' as const }],
      modelUsage: makeModelUsage() as any,
    }),
  });
}

/**
 * Scripted mock model for full pipeline runs: dispatches on the stage system
 * prompt and pops the stage's next code turn (mirrors the direct-respond test
 * fixture).
 */
function scriptedAI(scripts: {
  distiller: string[];
  executor?: string[];
  responder?: string;
}) {
  let distillerTurn = 0;
  let executorTurn = 0;
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
      const reply = (content: string) => ({
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: makeModelUsage() as any,
      });
      if (systemPrompt.includes('You (`distiller`)')) {
        const code =
          scripts.distiller[
            Math.min(distillerTurn, scripts.distiller.length - 1)
          ];
        distillerTurn++;
        return reply(`Javascript Code: ${code}`);
      }
      if (systemPrompt.includes('You (`executor`)')) {
        if (!scripts.executor || scripts.executor.length === 0) {
          throw new Error('executor called but no executor turns scripted');
        }
        const code =
          scripts.executor[Math.min(executorTurn, scripts.executor.length - 1)];
        executorTurn++;
        return reply(`Javascript Code: ${code}`);
      }
      return reply(scripts.responder ?? 'Answer: ok');
    },
  });
}

const actorPrompt = (ag: any) =>
  (ag.executor as any).actorProgram?.getSignature?.().getDescription?.() ?? '';

const failureState = (signatureOutput: string) => ({
  agentValues: { question: 'q' },
  executorInputs: { executorRequest: 'answer the question' },
  distillerResult: {},
  executorResult: {
    failureReport: {
      stage: 'executor',
      signals: [
        {
          kind: 'error_turn',
          turn: 1,
          signature: signatureOutput,
          detail: signatureOutput,
          occurrences: 1,
        },
      ],
    },
  },
  responderResult: { answer: 'a' },
});

const BOOM = 'TypeError: boom is not a function';

describe('resolveAgentPlaybookConfig', () => {
  it('applies defaults: learn on, dedupe on, one reflection round', () => {
    const resolved = resolveAgentPlaybookConfig({});
    expect(resolved?.learn).toEqual({
      enabled: true,
      minSignals: 1,
      dedupe: true,
    });
    expect(resolved?.target).toBe('actor');
    expect(resolved?.apply).toBe(true);
    expect(resolved?.playbookOptions.maxReflectorRounds).toBe(
      DEFAULT_PLAYBOOK_MAX_REFLECTOR_ROUNDS
    );
  });

  it('returns undefined when no config is given and validates minSignals', () => {
    expect(resolveAgentPlaybookConfig(undefined)).toBeUndefined();
    expect(() =>
      resolveAgentPlaybookConfig({ learn: { minSignals: 0 } })
    ).toThrow(/positive integer/);
    expect(() =>
      resolveAgentPlaybookConfig({ learn: { minSignals: 1.5 } })
    ).toThrow(/positive integer/);
  });
});

describe('agent playbook config attachment', () => {
  it('injects a bare seed playbook into the live actor prompt at construction', () => {
    const ag = agent('question:string -> answer:string', {
      ai: mockAI(),
      playbook: { playbook: buildPlaybook('Strategy', 'MARKER_SEED cite ids') },
    });
    const prompt = actorPrompt(ag);
    expect(prompt).toContain('## Context Playbook');
    expect(prompt).toContain('MARKER_SEED');
  });

  it('restores a snapshot seed at construction', () => {
    const ag = agent('question:string -> answer:string', {
      ai: mockAI(),
      playbook: {
        playbook: snapshot(buildPlaybook('Strategy', 'MARKER_SNAP')),
      },
    });
    expect(actorPrompt(ag)).toContain('MARKER_SNAP');
  });

  it('keeps the live prompt untouched with apply: false', () => {
    const ag = agent('question:string -> answer:string', {
      ai: mockAI(),
      playbook: {
        playbook: buildPlaybook('Strategy', 'MARKER_HIDDEN'),
        apply: false,
      },
    });
    expect(actorPrompt(ag)).not.toContain('MARKER_HIDDEN');
  });

  it('getPlaybook returns the attached handle; playbook() follows the conflict rule', () => {
    const ag = agent('question:string -> answer:string', {
      ai: mockAI(),
      playbook: {},
    });
    const handle = ag.getPlaybook();
    expect(handle).toBeDefined();
    expect(ag.playbook()).toBe(handle);
    expect(() => ag.playbook({ target: 'actor' })).toThrow(
      /this agent already has a playbook/
    );
  });

  it('getPlaybook is undefined and playbook() builds fresh handles without the config', () => {
    const ag = agent('question:string -> answer:string', { ai: mockAI() });
    expect(ag.getPlaybook()).toBeUndefined();
    expect(ag.playbook({ target: 'actor' })).toBeDefined();
  });

  it('throws at construction when learning is configured without any AI', () => {
    expect(() =>
      agent('question:string -> answer:string', {
        ai: undefined as any,
        playbook: {},
      })
    ).toThrow(/requires studentAI/);
  });
});

describe('_updatePlaybookFromPipelineState', () => {
  const makeConfigured = (
    playbookConfig: Record<string, unknown> = {},
    onUpdate?: (r: any) => void
  ) => {
    const ag = agent('question:string -> answer:string', {
      ai: mockAI(),
      playbook: { ...playbookConfig, ...(onUpdate ? { onUpdate } : {}) },
    }) as any;
    // Run-end learning drives the inner handle; spy there.
    const handle = ag.getPlaybook().inner;
    const update = vi
      .spyOn(handle, 'update')
      .mockResolvedValue(undefined as any);
    return { ag, handle, update };
  };

  it('skips without failure signals and never calls update', async () => {
    const { ag, update } = makeConfigured();
    const result = await ag._updatePlaybookFromPipelineState({
      distillerResult: {},
      executorResult: {},
      responderResult: {},
    });
    expect(result?.status).toBe('skipped');
    expect(result?.skipReason).toBe('no_failures');
    expect(update).not.toHaveBeenCalled();
  });

  it('skips when learning is disabled', async () => {
    const { ag, update } = makeConfigured({ learn: false });
    const result = await ag._updatePlaybookFromPipelineState(
      failureState(BOOM)
    );
    expect(result?.skipReason).toBe('learning_disabled');
    expect(update).not.toHaveBeenCalled();
  });

  it('skips below minSignals', async () => {
    const { ag, update } = makeConfigured({ learn: { minSignals: 3 } });
    const result = await ag._updatePlaybookFromPipelineState(
      failureState(BOOM)
    );
    expect(result?.skipReason).toBe('below_min_signals');
    expect(update).not.toHaveBeenCalled();
  });

  it('skips when every signature was already curated (artifact ledger)', async () => {
    const pb = buildPlaybook(
      axPlaybookFailureSection,
      'call helpers through the exported module'
    );
    const { ag, update } = makeConfigured({
      playbook: {
        playbook: pb,
        artifact: {
          playbook: pb,
          feedback: [
            {
              example: { task: 'earlier run', failureSignatures: [BOOM] },
              prediction: {},
              score: 0,
              generatorOutput: {},
              curator: { operations: [] },
              timestamp: new Date(0).toISOString(),
            },
          ],
          // The earlier update curated the surviving `x-0` bullet.
          history: [
            {
              source: 'online' as const,
              epoch: -1,
              exampleIndex: 0,
              operations: [],
              updatedBulletIds: ['x-0'],
            },
          ],
        },
      },
    });
    const result = await ag._updatePlaybookFromPipelineState(
      failureState(BOOM)
    );
    expect(result?.skipReason).toBe('all_duplicates');
    expect(update).not.toHaveBeenCalled();
  });

  it('feeds fresh signals to the playbook and fires onUpdate', async () => {
    const onUpdate = vi.fn();
    const { ag, update } = makeConfigured({}, onUpdate);
    const result = await ag._updatePlaybookFromPipelineState(
      failureState(BOOM)
    );
    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0]?.[0] as any;
    expect(args.example.task).toBe('answer the question');
    expect(args.example.failureSignatures).toEqual([BOOM]);
    expect(args.feedback).toContain(`[${BOOM}]`);
    expect(args.feedback).toContain(axPlaybookFailureSection);
    expect(result?.status).toBe('unchanged');
    expect(result?.feedback).toBe(args.feedback);
    expect(onUpdate).toHaveBeenCalledWith(result);
  });

  it('is non-fatal when the update throws', async () => {
    const { ag, update } = makeConfigured();
    update.mockRejectedValue(new Error('engine down'));
    await expect(
      ag._updatePlaybookFromPipelineState(failureState(BOOM))
    ).resolves.toBeUndefined();
  });
});

describe('end-to-end failure learning through forward()', () => {
  it('harvests executor error turns into a playbook update after the run', async () => {
    const ai = scriptedAI({
      distiller: ['await final("Answer the question", {})'],
      executor: [
        'nonexistentHelper()',
        'await final("Answer the question", { note: "recovered" })',
      ],
      responder: 'Answer: done',
    });
    const onUpdate = vi.fn();
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      playbook: { onUpdate },
    }) as any;
    const update = vi
      .spyOn(ag.getPlaybook().inner, 'update')
      .mockResolvedValue(undefined);

    const out = await ag.forward(ai, { question: 'q' });
    expect(out.answer).toBe('done');
    expect(update).toHaveBeenCalledTimes(1);
    const feedback = (update.mock.calls[0]?.[0] as any).feedback as string;
    expect(feedback).toContain('nonexistentHelper');
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('spends nothing on clean runs', async () => {
    const ai = scriptedAI({
      distiller: ['await final("Answer the question", {})'],
      executor: ['await final("Answer the question", { note: "ok" })'],
      responder: 'Answer: ok',
    });
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      playbook: {},
    }) as any;
    const update = vi
      .spyOn(ag.getPlaybook().inner, 'update')
      .mockResolvedValue(undefined);

    await ag.forward(ai, { question: 'q' });
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the run alive when the playbook update fails', async () => {
    const ai = scriptedAI({
      distiller: ['await final("Answer the question", {})'],
      executor: [
        'nonexistentHelper()',
        'await final("Answer the question", {})',
      ],
      responder: 'Answer: survived',
    });
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      playbook: {},
    }) as any;
    vi.spyOn(ag.getPlaybook().inner, 'update').mockRejectedValue(
      new Error('engine down')
    );

    const out = await ag.forward(ai, { question: 'q' });
    expect(out.answer).toBe('survived');
  });
});

describe('collectCoveredFailureSignatures', () => {
  const pbWith = (ids: string[]) => ({
    version: 1,
    sections: {
      failures_to_avoid: ids.map((id) => ({
        id,
        section: 'failures_to_avoid',
        content: `[${id}] rule`,
        helpfulCount: 0,
        harmfulCount: 0,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      })),
    },
    stats: {
      bulletCount: ids.length,
      helpfulCount: 0,
      harmfulCount: 0,
      tokenEstimate: 0,
    },
    updatedAt: new Date(0).toISOString(),
  });
  const event = (sigs: string[]) => ({
    example: { task: 't', failureSignatures: sigs },
    prediction: {},
    score: 0,
    generatorOutput: {},
    timestamp: new Date(0).toISOString(),
  });

  it('covers while the curated bullet survives; re-learns once it is pruned', () => {
    const snapshotAlive = {
      playbook: pbWith(['f-1']),
      artifact: {
        playbook: pbWith(['f-1']),
        feedback: [event([BOOM])],
        history: [
          {
            source: 'online' as const,
            epoch: -1,
            exampleIndex: 0,
            operations: [],
            updatedBulletIds: ['f-1'],
          },
        ],
      },
    };
    expect(
      collectCoveredFailureSignatures(snapshotAlive as any).has(BOOM)
    ).toBe(true);

    const snapshotPruned = {
      ...snapshotAlive,
      playbook: pbWith([]),
      artifact: { ...snapshotAlive.artifact, playbook: pbWith([]) },
    };
    expect(
      collectCoveredFailureSignatures(snapshotPruned as any).has(BOOM)
    ).toBe(false);
  });

  it('covers a deliberate curator no-op but re-learns a transient failure', () => {
    // Deliberate decline: curator ran, produced no ops (no delta). Covered —
    // don't re-spend on a signature the curator already judged.
    const deliberateNoOp = {
      playbook: pbWith([]),
      artifact: {
        playbook: pbWith([]),
        feedback: [{ ...event([BOOM]), curator: { operations: [] } }],
        history: [],
      },
    };
    expect(
      collectCoveredFailureSignatures(deliberateNoOp as any).has(BOOM)
    ).toBe(true);

    // Transient reflector/curator failure: no delta AND no curator on the
    // event. NOT covered — one bad LLM call must not permanently suppress the
    // lesson.
    const transientFailure = {
      playbook: pbWith([]),
      artifact: {
        playbook: pbWith([]),
        feedback: [event([BOOM])],
        history: [],
      },
    };
    expect(
      collectCoveredFailureSignatures(transientFailure as any).has(BOOM)
    ).toBe(false);
  });

  it('keeps legacy events (delta without updatedBulletIds) covered', () => {
    const legacy = {
      playbook: pbWith([]),
      artifact: {
        playbook: pbWith([]),
        feedback: [event([BOOM])],
        history: [
          {
            source: 'online' as const,
            epoch: -1,
            exampleIndex: 0,
            operations: [],
          },
        ],
      },
    };
    expect(collectCoveredFailureSignatures(legacy as any).has(BOOM)).toBe(true);
  });

  it('re-learns through the run-end gate when the lesson was pruned', async () => {
    const pruned = {
      playbook: pbWith([]),
      artifact: {
        playbook: pbWith([]),
        feedback: [event([BOOM])],
        history: [
          {
            source: 'online' as const,
            epoch: -1,
            exampleIndex: 0,
            operations: [],
            updatedBulletIds: ['gone-1'],
          },
        ],
      },
    };
    const ag = agent('question:string -> answer:string', {
      ai: mockAI(),
      playbook: { playbook: pruned as any },
    }) as any;
    const update = vi
      .spyOn(ag.getPlaybook().inner, 'update')
      .mockResolvedValue(undefined as any);
    const result = await ag._updatePlaybookFromPipelineState(
      failureState(BOOM)
    );
    expect(result?.status).not.toBe('skipped');
    expect(update).toHaveBeenCalledTimes(1);
  });
});
