import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { flow } from './flow.js';

// A mock AI that replays "Field Title: value" contents in order and records
// how many chat calls were made.
function sequencedAI(responses: string[]) {
  let callCount = 0;
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async () => {
      const content = responses[Math.min(callCount, responses.length - 1)];
      callCount++;
      return {
        results: [
          { index: 0, content: content ?? '', finishReason: 'stop' as const },
        ],
        modelUsage: {
          ai: 'mock',
          model: 'test',
          tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      };
    },
  });
  return { ai, calls: () => callCount };
}

const SPEC_DOC = [
  'flowchart TD',
  '  %%ax summarize: documentText:string -> summaryText:string(max 500) "concise summary"',
  '  %%ax check: summaryText:string -> verdict:class "pass, fail", note?:string',
  '  %%ax format: summaryText:string, note?:string -> finalReport:string',
  '',
  '  summarize[Summarize document] --> check{verdict}',
  '  check -->|pass| format',
  '  check -->|fail, max 3| summarize',
].join('\n');

describe('flow.fromMermaid', () => {
  it('compiles and runs the spec document, capping feedback at max 3', async () => {
    const wf = flow.fromMermaid<
      { documentText: string },
      { finalReport: string }
    >(SPEC_DOC);
    // 3 iterations of (summarize, check) — verdict stays "fail" so the cap
    // stops the loop — then format runs once.
    const { ai, calls } = sequencedAI([
      'Summary Text: draft one',
      'Verdict: fail',
      'Summary Text: draft two',
      'Verdict: fail',
      'Summary Text: draft three',
      'Verdict: fail',
      'Final Report: shipped',
    ]);

    const result = await wf.forward(ai as any, { documentText: 'long text' });
    expect(result.finalReport).toBe('shipped');
    expect(calls()).toBe(7);
  });

  it('exits the feedback loop as soon as the verdict passes', async () => {
    const wf = flow.fromMermaid(SPEC_DOC);
    const { ai, calls } = sequencedAI([
      'Summary Text: draft one',
      'Verdict: pass',
      'Final Report: shipped',
    ]);
    const result = await wf.forward(ai as any, { documentText: 'long text' });
    expect((result as any).finalReport).toBe('shipped');
    expect(calls()).toBe(3);
  });

  it('auto-wires fan-out and keeps it parallelizable via explicit deps', async () => {
    const doc = [
      'flowchart TD',
      '  %%ax split: topicText:string -> questionText:string',
      '  %%ax alpha: questionText:string -> alphaAnswer:string',
      '  %%ax beta: questionText:string -> betaAnswer:string',
      '  %%ax joiner: alphaAnswer:string, betaAnswer:string -> combinedAnswer:string',
      '  split --> alpha & beta',
      '  alpha & beta --> joiner',
    ].join('\n');

    const wf = flow.fromMermaid(doc);
    const plan = wf.getExecutionPlan();
    // alpha and beta read only splitResult and write distinct results, so the
    // planner must schedule them together — proves generated mappings carry
    // explicit dependencies instead of degrading to barriers.
    expect(plan.maxParallelism).toBeGreaterThanOrEqual(2);

    const { ai } = sequencedAI([
      'Question Text: q',
      'Alpha Answer: a',
      'Beta Answer: b',
      'Combined Answer: ab',
    ]);
    const result = await wf.forward(ai as any, { topicText: 't' });
    expect((result as any).combinedAnswer).toBe('ab');
  });

  it('compiles labeled fan-out into branches and only runs the taken branch', async () => {
    const doc = [
      'flowchart TD',
      '  %%ax triage: ticketText:string -> severity:class "high, low"',
      '  %%ax escalate: ticketText:string -> replyText:string',
      '  %%ax autoReply: ticketText:string -> replyText:string',
      '  %%ax record: replyText:string -> logLine:string',
      '  triage{severity} -->|high| escalate --> record',
      '  triage -->|low| autoReply --> record',
    ].join('\n');

    const wf = flow.fromMermaid(doc);
    const { ai, calls } = sequencedAI([
      'Severity: high',
      'Reply Text: escalated',
      'Log Line: logged',
    ]);
    const result = await wf.forward(ai as any, { ticketText: 'help!' });
    expect((result as any).logLine).toBe('logged');
    expect(calls()).toBe(3);
  });

  it('compiles while back-edges via conditions bindings', async () => {
    const doc = [
      'flowchart TD',
      '  %%ax polish: draftText:string -> polishedText:string',
      '  polish -->|while keepGoing, max 5| polish',
    ].join('\n');

    const wf = flow.fromMermaid(doc, {
      conditions: { keepGoing: (state) => state.polishResult === undefined },
    });
    const { ai, calls } = sequencedAI(['Polished Text: shiny']);
    const result = await wf.forward(ai as any, { draftText: 'rough' });
    expect((result as any).polishedText).toBe('shiny');
    expect(calls()).toBe(1);
  });

  it('enforces while max iterations', async () => {
    const doc = [
      'flowchart TD',
      '  %%ax polish: draftText:string -> polishedText:string',
      '  polish -->|while keepGoing, max 2| polish',
    ].join('\n');
    const wf = flow.fromMermaid(doc, {
      conditions: { keepGoing: () => true },
    });
    const { ai } = sequencedAI(['Polished Text: shiny']);
    await expect(wf.forward(ai as any, { draftText: 'rough' })).rejects.toThrow(
      /maximum iterations/
    );
  });

  it('treats function bindings as map steps feeding downstream wiring', async () => {
    const doc = [
      'flowchart TD',
      '  %%ax draft: briefText:string -> articleText:string',
      '  normalize --> draft',
    ].join('\n');
    const wf = flow.fromMermaid(doc, {
      nodes: {
        normalize: (state) => ({
          ...state,
          briefText: String(state.rawText).trim(),
        }),
      },
    });
    const { ai } = sequencedAI(['Article Text: written']);
    const result = await wf.forward(ai as any, { rawText: '  hi  ' });
    expect((result as any).articleText).toBe('written');
  });

  it('infers flow inputs from unproduced fields', () => {
    const wf = flow.fromMermaid(SPEC_DOC);
    const inputNames = wf
      .getSignature()
      .getInputFields()
      .map((field) => field.name);
    expect(inputNames).toContain('documentText');
  });

  describe('compile errors', () => {
    const cases: [string, string[], RegExp][] = [
      [
        'unresolved nodes',
        ['flowchart TD', 'mystery --> other'],
        /No signature for node\(s\): mystery, other/,
      ],
      [
        'ambiguous producers',
        [
          'flowchart TD',
          '  %%ax alpha: topicText:string -> answerText:string',
          '  %%ax beta: topicText:string -> answerText:string',
          '  %%ax joiner: answerText:string -> finalText:string',
          '  alpha & beta --> joiner',
        ],
        /produced by alpha and beta at the same distance/,
      ],
      [
        'producer not upstream',
        [
          'flowchart TD',
          '  %%ax maker: seedText:string -> partText:string',
          '  %%ax user: partText:string -> outText:string',
          '  user --> maker',
        ],
        /"partText" of node "user" is produced by "maker" which is not upstream/,
      ],
      [
        'diamond field not an output',
        [
          'flowchart TD',
          '  %%ax check: aText:string -> verdict:class "x, y"',
          '  %%ax lhs: aText:string -> lhsText:string',
          '  %%ax rhs: aText:string -> rhsText:string',
          '  check{nonField} -->|x| lhs',
          '  check -->|y| rhs',
        ],
        /Decision field "nonField" is not an output/,
      ],
      [
        'edge label not a class option',
        [
          'flowchart TD',
          '  %%ax check: aText:string -> verdict:class "x, y"',
          '  %%ax lhs: aText:string -> lhsText:string',
          '  %%ax rhs: aText:string -> rhsText:string',
          '  check{verdict} -->|x| lhs',
          '  check -->|nope| rhs',
        ],
        /"nope" is not an option of "check.verdict"/,
      ],
      [
        'if on a forward edge',
        [
          'flowchart TD',
          '  %%ax alpha: aText:string -> bText:string',
          '  %%ax beta: bText:string -> cText:string',
          '  alpha -->|if something| beta',
        ],
        /only valid on back-edges/,
      ],
      [
        'unlabeled back-edge',
        [
          'flowchart TD',
          '  %%ax alpha: aText:string -> bText:string',
          '  %%ax beta: bText:string -> cText:string',
          '  alpha --> beta',
          '  beta --> alpha',
        ],
        /Back-edges need a label/,
      ],
      [
        'missing condition binding',
        [
          'flowchart TD',
          '  %%ax polish: draftText:string -> polishedText:string',
          '  polish -->|while missingCond| polish',
        ],
        /Missing condition binding "missingCond"/,
      ],
      [
        'duplicate terminal outputs',
        [
          'flowchart TD',
          '  %%ax seed: topicText:string -> ideaText:string',
          '  %%ax alpha: ideaText:string -> reportText:string',
          '  %%ax beta: ideaText:string -> reportText:string',
          '  seed --> alpha & beta',
        ],
        /Output field "reportText" is produced by multiple terminal nodes/,
      ],
    ];

    for (const [label, docLines, matcher] of cases) {
      it(`rejects ${label}`, () => {
        expect(() => flow.fromMermaid(docLines.join('\n'))).toThrow(matcher);
      });
    }
  });

  describe('round-trips', () => {
    it('fromMermaid -> toMermaid -> fromMermaid preserves behavior', async () => {
      const first = flow.fromMermaid(SPEC_DOC);
      const rendered = first.toMermaid();
      expect(rendered).toContain('%%ax summarize:');
      expect(rendered).toContain('check{verdict}');
      expect(rendered).toContain('|fail, max 3|');

      const second = flow.fromMermaid(rendered);
      const responses = [
        'Summary Text: draft one',
        'Verdict: fail',
        'Summary Text: draft two',
        'Verdict: pass',
        'Final Report: shipped',
      ];
      const runA = sequencedAI(responses);
      const runB = sequencedAI(responses);
      const resultA = await first.forward(runA.ai as any, {
        documentText: 'text',
      });
      const resultB = await second.forward(runB.ai as any, {
        documentText: 'text',
      });
      expect((resultB as any).finalReport).toBe((resultA as any).finalReport);
      expect(runB.calls()).toBe(runA.calls());
    });

    it('builder flow -> toMermaid -> fromMermaid preserves behavior', async () => {
      const built = flow<{ documentText: string }>()
        .node('summarize', 'documentText:string -> summaryText:string')
        .node('format', 'summaryText:string -> finalReport:string')
        .execute('summarize', (s) => ({ documentText: s.documentText }))
        .execute('format', (s) => ({
          summaryText: s.summarizeResult.summaryText,
        }));
      const imported = flow.fromMermaid(built.toMermaid());

      const responses = ['Summary Text: s', 'Final Report: done'];
      const runA = sequencedAI(responses);
      const runB = sequencedAI(responses);
      const resultA = await built.forward(runA.ai as any, {
        documentText: 'text',
      });
      const resultB = await imported.forward(runB.ai as any, {
        documentText: 'text',
      });
      // Builder flows return raw state (node results nested); imported flows
      // add a synthetic returns projection that flattens terminal outputs.
      expect((resultA as any).formatResult.finalReport).toBe('done');
      expect((resultB as any).finalReport).toBe('done');
      expect(runB.calls()).toBe(runA.calls());
    });
  });
});
