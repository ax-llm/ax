import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxACEPlaybook } from '../dsp/optimizers/aceTypes.js';
import { agent } from './index.js';

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

function makeAgent() {
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async () => ({
      results: [{ index: 0, content: 'ok', finishReason: 'stop' as const }],
      modelUsage: undefined as any,
    }),
  });
  return agent('question:string -> answer:string', { ai });
}

const actorPrompt = (ag: any) =>
  (ag.executor as any).actorProgram?.getSignature?.().getDescription?.() ?? '';
const responderPrompt = (ag: any) =>
  (ag.responder as any).program?.getSignature?.().getDescription?.() ?? '';

describe('agent.playbook', () => {
  it('injects an evolved playbook into the live actor prompt', () => {
    const ag = makeAgent();
    expect(actorPrompt(ag)).not.toContain('MARKER_ALPHA');

    const pb = buildPlaybook('Strategy', 'MARKER_ALPHA cite the policy id');
    ag.playbook({ target: 'actor' }).load(snapshot(pb));

    const prompt = actorPrompt(ag);
    expect(prompt).toContain('## Context Playbook');
    expect(prompt).toContain('MARKER_ALPHA');
  });

  it('injects into the live responder prompt when targeted', () => {
    const ag = makeAgent();
    const pb = buildPlaybook('Tone', 'MARKER_BETA respond formally');
    ag.playbook({ target: 'responder' }).load(snapshot(pb));
    expect(responderPrompt(ag)).toContain('MARKER_BETA');
  });

  it('does not touch the live prompt when apply is false', () => {
    const ag = makeAgent();
    const pb = buildPlaybook('Strategy', 'MARKER_GAMMA hidden');
    ag.playbook({ target: 'actor', apply: false }).load(snapshot(pb));
    expect(actorPrompt(ag)).not.toContain('MARKER_GAMMA');
  });

  it('recomposes from the original base on re-apply (no stacking)', () => {
    const ag = makeAgent();
    const handle = ag.playbook({ target: 'actor' });
    handle.load(snapshot(buildPlaybook('Strategy', 'MARKER_ONE')));
    handle.load(snapshot(buildPlaybook('Strategy', 'MARKER_TWO')));
    const prompt = actorPrompt(ag);
    expect(prompt).toContain('MARKER_TWO');
    expect(prompt).not.toContain('MARKER_ONE');
  });

  it('throws a clear error when no student AI is available', () => {
    const ag = agent('question:string -> answer:string', {
      ai: undefined as any,
    });
    expect(() => ag.playbook({ target: 'actor' })).toThrow(
      /studentAI is required/
    );
  });
});
