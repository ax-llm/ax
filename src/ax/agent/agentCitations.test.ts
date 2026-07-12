import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { resolveCitations } from './config.js';
import { agent } from './index.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

/**
 * Scripted mock model (direct-respond test fixture pattern): dispatches on
 * the stage system prompt; the responder pops from a response list so retry
 * behavior is scriptable.
 */
function scriptedAI(scripts: {
  distiller: string[];
  executor?: string[];
  responder: string[];
}) {
  let distillerTurn = 0;
  let executorTurn = 0;
  let responderTurn = 0;
  const counts = { responderCalls: 0 };
  const ai = new AxMockAIService({
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
      counts.responderCalls++;
      const response =
        scripts.responder[
          Math.min(responderTurn, scripts.responder.length - 1)
        ];
      responderTurn++;
      return reply(response ?? 'Answer: ok');
    },
  });
  return { ai, counts };
}

const EVIDENCE_FINAL =
  'await final("Answer the question", { policy: "Refunds within 30 days.", ticket: "Customer asks about refunds." })';

function makeAgent(
  scripts: Parameters<typeof scriptedAI>[0],
  citations: unknown
) {
  const { ai, counts } = scriptedAI(scripts);
  const ag = agent('question:string -> answer:string', {
    ai,
    directResponse: 'off',
    ...(citations !== undefined ? { citations: citations as any } : {}),
    maxTurns: 8,
  }) as any;
  return { ag, ai, counts };
}

describe('resolveCitations', () => {
  it('defaults off; boolean true enables with defaults', () => {
    expect(resolveCitations(undefined).enabled).toBe(false);
    expect(resolveCitations(true)).toEqual({
      enabled: true,
      field: 'evidenceCitations',
      surface: 'output',
      includeMemoryIds: true,
    });
  });

  it('object form implies enabled and validates inputs', () => {
    const onCitations = () => {};
    expect(
      resolveCitations({ field: 'sources', surface: 'hidden', onCitations })
    ).toEqual({
      enabled: true,
      field: 'sources',
      surface: 'hidden',
      includeMemoryIds: true,
      onCitations,
    });
    expect(() => resolveCitations({ field: '9bad' })).toThrow(
      /valid field name/
    );
    expect(() => resolveCitations({ surface: 'both' as any })).toThrow(
      /'output' or 'hidden'/
    );
  });
});

describe('agent citations', () => {
  it('default-off leaves the responder signature unchanged', () => {
    const { ag } = makeAgent(
      { distiller: ['await final("t", {})'], executor: [], responder: [] },
      undefined
    );
    expect(ag.responder.getSignature().toString()).not.toContain(
      'evidenceCitations'
    );
  });

  it('enabled adds the optional output field to the responder signature only', () => {
    const { ag } = makeAgent(
      { distiller: ['await final("t", {})'], executor: [], responder: [] },
      true
    );
    expect(ag.responder.getSignature().toString()).toContain(
      'evidenceCitations'
    );
    expect(ag.getSignature().toString()).not.toContain('evidenceCitations');
  });

  it('throws at construction when the field collides with a signature output', () => {
    const { ai } = scriptedAI({ distiller: [''], responder: [] });
    expect(() =>
      agent('question:string -> answer:string', {
        ai,
        citations: { field: 'answer' },
      })
    ).toThrow(/collides with an output field/);
  });

  it('accepts valid citations and surfaces them in the result', async () => {
    const { ag, ai } = makeAgent(
      {
        distiller: ['await final("Answer the question", {})'],
        executor: [EVIDENCE_FINAL],
        responder: [
          'Answer: Refunds are honored.\nEvidence Citations: ["policy"]',
        ],
      },
      true
    );
    const res = await ag.forward(ai, { question: 'refund window?' });
    expect(res.answer).toContain('Refunds');
    expect(res.evidenceCitations).toEqual(['policy']);
  });

  it('rejects unknown ids and recovers through the validation retry', async () => {
    const { ag, ai, counts } = makeAgent(
      {
        distiller: ['await final("Answer the question", {})'],
        executor: [EVIDENCE_FINAL],
        responder: [
          'Answer: Refunds are honored.\nEvidence Citations: ["made_up_source"]',
          'Answer: Refunds are honored.\nEvidence Citations: ["policy", "ticket"]',
        ],
      },
      true
    );
    const res = await ag.forward(ai, { question: 'refund window?' });
    expect(res.evidenceCitations).toEqual(['policy', 'ticket']);
    expect(counts.responderCalls).toBe(2);
  });

  it('skips validation when the run carries no evidence', async () => {
    const { ag, ai } = makeAgent(
      {
        distiller: ['await final("Answer the question", {})'],
        executor: ['await final("Answer the question")'],
        responder: ['Answer: plain.\nEvidence Citations: ["anything_goes"]'],
      },
      true
    );
    const res = await ag.forward(ai, { question: 'q' });
    expect(res.evidenceCitations).toEqual(['anything_goes']);
  });

  it('passes when the model omits the optional field', async () => {
    const { ag, ai } = makeAgent(
      {
        distiller: ['await final("Answer the question", {})'],
        executor: [EVIDENCE_FINAL],
        responder: ['Answer: Refunds are honored.'],
      },
      true
    );
    const res = await ag.forward(ai, { question: 'q' });
    expect(res.answer).toContain('Refunds');
    expect(res.evidenceCitations).toBeUndefined();
  });

  it('accepts memory ids nested one level deep in evidence', async () => {
    const { ag, ai } = makeAgent(
      {
        distiller: ['await final("Answer the question", {})'],
        executor: [
          'await final("Answer the question", { memories: [{ id: "MEM-7", content: "refunds run 30 days" }] })',
        ],
        responder: ['Answer: 30 days.\nEvidence Citations: ["MEM-7"]'],
      },
      true
    );
    const res = await ag.forward(ai, { question: 'q' });
    expect(res.evidenceCitations).toEqual(['MEM-7']);
  });

  it('hidden surface strips the field and reports via onCitations', async () => {
    const onCitations = vi.fn();
    const { ag, ai } = makeAgent(
      {
        distiller: ['await final("Answer the question", {})'],
        executor: [EVIDENCE_FINAL],
        responder: [
          'Answer: Refunds are honored.\nEvidence Citations: ["ticket"]',
        ],
      },
      { surface: 'hidden', onCitations }
    );
    const res = await ag.forward(ai, { question: 'q' });
    expect(res.answer).toContain('Refunds');
    expect(res.evidenceCitations).toBeUndefined();
    await vi.waitFor(() =>
      expect(onCitations).toHaveBeenCalledWith(['ticket'])
    );
  });

  it('works on the direct-respond skip path (respond evidence keys)', async () => {
    const onCitations = vi.fn();
    const { ai, counts } = scriptedAI({
      distiller: [
        'await respond("Answer from notes", { notes: "CACHE-TIER-11 adopted." })',
      ],
      responder: ['Answer: Adopted.\nEvidence Citations: ["notes"]'],
    });
    const ag = agent('question:string -> answer:string', {
      ai,
      citations: { onCitations },
      maxTurns: 8,
    }) as any;
    const res = await ag.forward(ai, { question: 'what was adopted?' });
    expect(res.evidenceCitations).toEqual(['notes']);
    expect(counts.responderCalls).toBe(1);
    await vi.waitFor(() => expect(onCitations).toHaveBeenCalledWith(['notes']));
  });

  it('streams citations through (output) and fires onCitations', async () => {
    const onCitations = vi.fn();
    const { ai } = scriptedAI({
      distiller: ['await final("Answer the question", {})'],
      executor: [EVIDENCE_FINAL],
      responder: [
        'Answer: Refunds are honored.\nEvidence Citations: ["policy"]',
      ],
    });
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      citations: { onCitations },
      maxTurns: 8,
    }) as any;
    const fields = new Set<string>();
    for await (const delta of ag.streamingForward(ai, { question: 'q' })) {
      for (const key of Object.keys(delta.delta ?? {})) {
        fields.add(key);
      }
    }
    expect(fields.has('answer')).toBe(true);
    expect(fields.has('evidenceCitations')).toBe(true);
    await vi.waitFor(() =>
      expect(onCitations).toHaveBeenCalledWith(['policy'])
    );
  });
});
