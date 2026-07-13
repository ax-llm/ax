import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { agent } from './index.js';

const makeModelUsage = () => ({
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
});

function scriptedAI(capture: { executorSystemPrompts: string[] }) {
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const systemPrompt = String(req.chatPrompt[0]?.content ?? '');
      const reply = (content: string) => ({
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: makeModelUsage() as any,
      });
      if (systemPrompt.includes('You (`distiller`)')) {
        return reply('Javascript Code: await final("Answer the question", {})');
      }
      if (systemPrompt.includes('You (`executor`)')) {
        capture.executorSystemPrompts.push(systemPrompt);
        return reply(
          'Javascript Code: await final("Answer the question", { note: "x" })'
        );
      }
      return reply('Answer: ok');
    },
  });
}

const actorPrompt = (ag: any) =>
  (ag.executor as any).actorProgram?.getSignature?.().getDescription?.() ?? '';

/**
 * Regression coverage for the stage `::instruction` optimizable component.
 * Historically the stage exposed instruction knobs on its inner split
 * programs; values set there were silently wiped by rebuilds and never
 * rendered in the actor prompt — a dead optimization surface. The component
 * is now backed by the stage itself and composed into the actor definition.
 */
describe('agent stage instruction component', () => {
  it('exposes exactly one instruction component per actor stage', () => {
    const capture = { executorSystemPrompts: [] as string[] };
    const ag = agent('question:string -> answer:string', {
      ai: scriptedAI(capture),
      directResponse: 'off',
    }) as any;
    const instructionKeys = ag.executor
      .getOptimizableComponents()
      .filter((c: any) => c.kind === 'instruction')
      .map((c: any) => c.key);
    expect(instructionKeys).toEqual(['root::instruction']);
  });

  it('applyOptimizedComponents value renders in the actor definition and survives rebuilds', () => {
    const capture = { executorSystemPrompts: [] as string[] };
    const ag = agent('question:string -> answer:string', {
      ai: scriptedAI(capture),
      directResponse: 'off',
    }) as any;
    const stage = ag.executor;

    stage.applyOptimizedComponents({
      'root::instruction': 'MARKER_STAGE_INSTruction rule',
    });
    expect(actorPrompt(ag)).toContain('MARKER_STAGE_INSTruction');

    stage._buildSplitPrograms();
    expect(actorPrompt(ag)).toContain('MARKER_STAGE_INSTruction');
    const component = stage
      .getOptimizableComponents()
      .find((c: any) => c.key === 'root::instruction');
    expect(component?.current).toBe('MARKER_STAGE_INSTruction rule');
  });

  it('reaches the live executor system prompt during forward()', async () => {
    const capture = { executorSystemPrompts: [] as string[] };
    const ai = scriptedAI(capture);
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
    }) as any;
    ag.executor.setInstruction('MARKER_LIVE_RULE: verify ids before calling.');

    await ag.forward(ai, { question: 'q' });
    expect(capture.executorSystemPrompts.length).toBeGreaterThan(0);
    expect(
      capture.executorSystemPrompts.every((s) => s.includes('MARKER_LIVE_RULE'))
    ).toBe(true);
  });

  it('clears with an empty value and composes alongside playbook injection', () => {
    const capture = { executorSystemPrompts: [] as string[] };
    const ag = agent('question:string -> answer:string', {
      ai: scriptedAI(capture),
      directResponse: 'off',
    }) as any;
    const stage = ag.executor;

    stage.setInstruction('MARKER_A');
    ag.playbook({ target: 'actor' }).load({
      playbook: {
        version: 1,
        sections: {
          Strategy: [
            {
              id: 's-1',
              section: 'Strategy',
              content: 'MARKER_PB',
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
      },
      artifact: { playbook: {} as any, feedback: [], history: [] },
    });
    const prompt = actorPrompt(ag);
    expect(prompt).toContain('MARKER_A');
    expect(prompt).toContain('MARKER_PB');

    stage.setInstruction('   ');
    expect(actorPrompt(ag)).not.toContain('MARKER_A');
    expect(actorPrompt(ag)).toContain('MARKER_PB');
  });
});
