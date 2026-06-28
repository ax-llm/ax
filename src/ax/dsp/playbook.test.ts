import { describe, expect, it, vi } from 'vitest';
import type { AxAIService } from '../ai/types.js';
import { createEmptyPlaybook } from './optimizers/acePlaybook.js';
import type {
  AxACEOptimizationArtifact,
  AxACEPlaybook,
} from './optimizers/aceTypes.js';
import { AxPlaybook, playbook } from './playbook.js';
import { f } from './sig.js';
import { ax } from './template.js';

function buildPlaybook(sections: Record<string, string[]>): AxACEPlaybook {
  const pb = createEmptyPlaybook();
  for (const [section, contents] of Object.entries(sections)) {
    pb.sections[section] = contents.map((content, index) => ({
      id: `${section.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${index}`,
      section,
      content,
      helpfulCount: 0,
      harmfulCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
  }
  return pb;
}

function emptyArtifact(pb?: AxACEPlaybook): AxACEOptimizationArtifact {
  return { playbook: pb ?? createEmptyPlaybook(), feedback: [], history: [] };
}

function createProgram() {
  return ax(
    f().input('question', f.string()).output('answer', f.string()).build()
  );
}

const mockAI = {} as unknown as AxAIService;

describe('playbook handle', () => {
  it('factory returns an AxPlaybook bound to the program', () => {
    const pb = playbook(createProgram(), { studentAI: mockAI });
    expect(pb).toBeInstanceOf(AxPlaybook);
  });

  it('renders a loaded playbook as markdown', () => {
    const pb = playbook(createProgram(), { studentAI: mockAI });
    const content = buildPlaybook({
      Guidelines: ['Always cite the policy id'],
    });
    pb.load({ playbook: content, artifact: emptyArtifact(content) });

    const rendered = pb.render();
    expect(rendered).toContain('## Context Playbook');
    expect(rendered).toContain('### Guidelines');
    expect(rendered).toContain('Always cite the policy id');
  });

  it('round-trips through toJSON/load', () => {
    const content = buildPlaybook({ Pitfalls: ['Do not skip validation'] });
    const first = playbook(createProgram(), { studentAI: mockAI }).load({
      playbook: content,
      artifact: emptyArtifact(content),
    });

    const snapshot = JSON.parse(JSON.stringify(first));
    expect(snapshot.playbook.sections.Pitfalls).toHaveLength(1);

    const restored = playbook(createProgram(), { studentAI: mockAI }).load(
      snapshot
    );
    expect(restored.render()).toBe(first.render());
  });

  it('injects the playbook into the bound program on apply', () => {
    const program = createProgram();
    const pb = playbook(program, { studentAI: mockAI });
    pb.load({
      playbook: buildPlaybook({ Guidelines: ['Be concise'] }),
      artifact: emptyArtifact(),
    });

    const description = program.getSignature().getDescription() ?? '';
    expect(description).toContain('## Context Playbook');
    expect(description).toContain('Be concise');
  });

  it('redirects injection through the apply hook (agent seam)', () => {
    const program = createProgram();
    const pb = playbook(program, { studentAI: mockAI });
    let captured = '';
    pb._setApplyHook((rendered) => {
      captured = rendered;
    });

    pb.load({
      playbook: buildPlaybook({ Guidelines: ['Hook me'] }),
      artifact: emptyArtifact(),
    });

    expect(captured).toContain('Hook me');
    // The hook took over, so the bare program description is untouched.
    expect(program.getSignature().getDescription() ?? '').not.toContain(
      'Hook me'
    );
  });

  it('evolve returns only { bestScore, playbook } and applies', async () => {
    const pb = playbook(createProgram(), { studentAI: mockAI });
    const learned = buildPlaybook({ Guidelines: ['Learned rule'] });

    (pb as any).engine.compile = vi.fn().mockResolvedValue({
      bestScore: 0.75,
      playbook: learned,
      artifact: emptyArtifact(learned),
      // Fields that must NOT leak through the handle:
      optimizedProgram: { leaked: true },
      stats: { totalCalls: 3 },
      finalConfiguration: { strategy: 'ace', epochs: 1 },
    });
    const applyCurrentState = vi.fn();
    (pb as any).engine.applyCurrentState = applyCurrentState;

    const result = await pb.evolve([{ question: 'q', answer: 'a' }], () => 1);

    expect(Object.keys(result).sort()).toEqual(['bestScore', 'playbook']);
    expect(result.bestScore).toBe(0.75);
    expect((pb as any).engine.compile).toHaveBeenCalledOnce();
    expect(applyCurrentState).toHaveBeenCalledOnce();
  });

  it('update lazily hydrates once then delegates online', async () => {
    const pb = playbook(createProgram(), { studentAI: mockAI });
    const hydrate = vi.fn();
    const applyOnlineUpdate = vi.fn().mockResolvedValue(undefined);
    const applyCurrentState = vi.fn();
    (pb as any).engine.hydrate = hydrate;
    (pb as any).engine.applyOnlineUpdate = applyOnlineUpdate;
    (pb as any).engine.applyCurrentState = applyCurrentState;

    await pb.update({
      example: { question: 'q' },
      prediction: { answer: 'a' },
      feedback: 'good',
    });
    expect(hydrate).toHaveBeenCalledOnce();
    expect(applyOnlineUpdate).toHaveBeenCalledOnce();
    expect(applyCurrentState).toHaveBeenCalledOnce();

    // A second update must not hydrate again.
    await pb.update({
      example: { question: 'q2' },
      prediction: { answer: 'b' },
    });
    expect(hydrate).toHaveBeenCalledOnce();
    expect(applyOnlineUpdate).toHaveBeenCalledTimes(2);
  });
});
