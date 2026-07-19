import { describe, expect, it } from 'vitest';

import { flow } from './flow.js';

describe('AxFlow.toString (mermaid rendering)', () => {
  it('renders a linear flow with %%ax directives and producer edges', () => {
    const wf = flow<{ documentText: string }>()
      .node('summarize', 'documentText:string -> summaryText:string')
      .node('format', 'summaryText:string -> finalReport:string')
      .execute('summarize', (s) => ({ documentText: s.documentText }))
      .execute('format', (s) => ({
        summaryText: s.summarizeResult.summaryText,
      }));

    expect(wf.toString()).toBe(
      [
        'flowchart TD',
        '  %%ax summarize: documentText:string -> summaryText:string',
        '  %%ax format: summaryText:string -> finalReport:string',
        '',
        '  summarize[Summarize]',
        '  format[Format]',
        '  summarize --> format',
        '',
      ].join('\n')
    );
  });

  it('renders branches as diamonds with labeled edges', () => {
    const wf = flow<{ userText: string }>()
      .node('check', 'userText:string -> verdict:class "pass, fail"')
      .node('praise', 'userText:string -> replyText:string')
      .node('critique', 'userText:string -> replyText:string')
      .execute('check', (s) => ({ userText: s.userText }))
      .branch((s) => s.checkResult.verdict)
      .when('pass')
      .execute('praise', (s) => ({ userText: s.userText }))
      .when('fail')
      .execute('critique', (s) => ({ userText: s.userText }))
      .merge();

    const rendered = wf.toString();
    expect(rendered).toContain('check{verdict}');
    expect(rendered).toContain('check -->|pass| praise');
    expect(rendered).toContain('check -->|fail| critique');
    expect(rendered).toContain(
      '%%ax check: userText:string -> verdict:class "pass | fail"'
    );
  });

  it('renders feedback loops as labeled back-edges', () => {
    const wf = flow<{ taskText: string }>()
      .node('draft', 'taskText:string -> draftText:string')
      .node('review', 'draftText:string -> verdict:class "approve, revise"')
      .label('revisePoint')
      .execute('draft', (s) => ({ taskText: s.taskText }))
      .execute('review', (s) => ({ draftText: s.draftResult.draftText }))
      .feedback((s) => s.reviewResult.verdict === 'revise', 'revisePoint', 3);

    const rendered = wf.toString();
    expect(rendered).toContain('review{verdict}');
    expect(rendered).toContain('draft --> review');
    expect(rendered).toContain('review -->|revise, max 3| draft');
  });

  it('renders while loops with a back-edge and a conditions binding comment', () => {
    const wf = flow<{ draftText: string; iterationCount: number }>()
      .node('improve', 'draftText:string -> draftText2:string')
      .while((s) => s.iterationCount < 3, 5)
      .execute('improve', (s) => ({ draftText: s.draftText }))
      .endWhile();

    const rendered = wf.toString();
    expect(rendered).toContain('improve[Improve]');
    expect(rendered).toContain('improve -->|while cond1, max 5| improve');
    expect(rendered).toContain('%% bind conditions.cond1 on import');
  });

  it('renders parallel branches converging into a merge node', () => {
    const wf = flow<{ textInput: string }>()
      .node('novelty', 'textInput:string -> noveltyScore:number')
      .node('clarity', 'textInput:string -> clarityScore:number')
      .parallel([
        (sub: any) =>
          sub.execute('novelty', (s: any) => ({ textInput: s.textInput })),
        (sub: any) =>
          sub.execute('clarity', (s: any) => ({ textInput: s.textInput })),
      ])
      .merge('combinedScore', (a: any, b: any) => {
        return (
          ((a as any).noveltyResult.noveltyScore +
            (b as any).clarityResult.clarityScore) /
          2
        );
      });

    const rendered = wf.toString();
    expect(rendered).toContain('novelty[Novelty]');
    expect(rendered).toContain('clarity[Clarity]');
    expect(rendered).toContain('merge1([merge combinedScore])');
    expect(rendered).toContain('novelty --> merge1');
    expect(rendered).toContain('clarity --> merge1');
  });

  it('renders opaque map steps as placeholders with binding comments', () => {
    const wf = flow<{ userText: string }>()
      .node('reply', 'userText:string -> replyText:string')
      .map((s) => ({ ...s, cleanText: s.userText.trim() }))
      .execute('reply', (s) => ({ userText: s.cleanText as string }));

    const rendered = wf.toString();
    expect(rendered).toContain('map1([map])');
    expect(rendered).toContain('map1 --> reply');
    expect(rendered).toContain('%% bind nodes.map1 to a function on import');
  });

  it('never emits mermaid directive syntax %%{', () => {
    const wf = flow<{ userText: string }>()
      .node('reply', 'userText:string -> replyText:string')
      .execute('reply', (s) => ({ userText: s.userText }));
    expect(wf.toString()).not.toContain('%%{');
  });

  it('supports the direction option', () => {
    const wf = flow<{ userText: string }>()
      .node('reply', 'userText:string -> replyText:string')
      .execute('reply', (s) => ({ userText: s.userText }));
    expect(wf.toString({ direction: 'LR' })).toMatch(/^flowchart LR\n/);
  });

  it('String(wf) and template interpolation yield the default rendering', () => {
    const wf = flow<{ userText: string }>()
      .node('reply', 'userText:string -> replyText:string')
      .execute('reply', (s) => ({ userText: s.userText }));
    expect(String(wf)).toBe(wf.toString());
    expect(`${wf}`).toMatch(/^flowchart TD\n/);
    expect(wf.toString({ direction: 'LR' })).not.toBe(String(wf));
  });

  it('does not disturb the execution plan', () => {
    const wf = flow<{ documentText: string }>()
      .node('summarize', 'documentText:string -> summaryText:string')
      .node('format', 'summaryText:string -> finalReport:string')
      .execute('summarize', (s) => ({ documentText: s.documentText }))
      .execute('format', (s) => ({
        summaryText: s.summarizeResult.summaryText,
      }));
    wf.toString();
    const plan = wf.getExecutionPlan();
    expect(plan.totalSteps).toBe(2);
    expect(plan.autoParallelEnabled).toBe(true);
  });
});
