import { describe, expect, it } from 'vitest';
import { AxAgent } from './AxAgent.js';
import type { AxCodeRuntime } from './rlm.js';

const noopRuntime: AxCodeRuntime = {
  getUsageInstructions: () => '',
  createSession() {
    return {
      execute: async () => 'ok',
      patchGlobals: async () => {},
      close: () => {},
    };
  },
};

const defaults = { contextFields: [] as string[], runtime: noopRuntime };

function getInternal(a: any): any {
  // Wraps the actor stage with a Proxy so test access patterns that touch the
  // legacy responder surface (`responderProgram`, the responder-tpl entry in
  // getOptimizableComponents) continue to resolve through the pipeline's
  // responder synthesizer.
  const actor = a.primaryAgent ?? a;
  const responder = a.responder;
  if (!responder) return actor;
  return new Proxy(actor, {
    get(target, prop, receiver) {
      if (prop === 'responderProgram') return responder.getProgram();
      if (prop === 'getOptimizableComponents') {
        return () => {
          const baseId = target.getId();
          const responderEntries = responder
            .getOptimizableComponents()
            .map((c: any) =>
              c.kind === 'actor-tpl'
                ? { ...c, key: `${baseId}::actor-tpl:rlm/responder.md` }
                : c
            );
          return [...target.getOptimizableComponents(), ...responderEntries];
        };
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value) {
      if (prop === 'responderProgram') {
        (responder as any).program = value;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  });
}

describe('AxAgent — optimizable components', () => {
  it('flat-maps sub-program components and adds its own actor-tpl + primitive entries', () => {
    const a = new AxAgent(
      { signature: 'query: string -> answer: string' },
      { ...defaults }
    );
    const internal = getInternal(a);
    internal.setId('agent');

    const components = internal.getOptimizableComponents();

    // Sub-program components from the underlying program / actorProgram / responderProgram
    const kinds = new Set(components.map((c: any) => c.kind));
    expect(kinds.has('description')).toBe(true);
    expect(kinds.has('instruction')).toBe(true);

    // Own actor-tpl entries: one for the active actor template + one for responder
    const tplKeys = components
      .filter((c: any) => c.kind === 'actor-tpl')
      .map((c: any) => c.key);
    expect(tplKeys).toEqual(
      expect.arrayContaining([
        'agent::actor-tpl:rlm/executor.md',
        'agent::actor-tpl:rlm/responder.md',
      ])
    );

    // Own primitive entries — at minimum llmQuery / final / askClarification
    // are advertised in the default task stage.
    const primKeys = new Set(
      components
        .filter((c: any) => c.kind === 'primitive')
        .map((c: any) => c.key)
    );
    expect(primKeys.has('agent::primitive:llmQuery')).toBe(true);
    expect(primKeys.has('agent::primitive:final')).toBe(true);
    expect(primKeys.has('agent::primitive:askClarification')).toBe(true);
  });

  it('actor-tpl override survives a re-render and propagates to the actor description', () => {
    const a = new AxAgent(
      { signature: 'query: string -> answer: string' },
      { ...defaults }
    );
    const internal = getInternal(a);
    internal.setId('agent');

    const tpl = internal
      .getOptimizableComponents()
      .find((c: any) => c.key === 'agent::actor-tpl:rlm/executor.md');
    const customTpl = String(tpl.current).replace(
      '## Executor',
      '## CUSTOM ACTOR HEADER'
    );
    internal.applyOptimizedComponents({
      'agent::actor-tpl:rlm/executor.md': customTpl,
    });

    const actorDesc = internal.actorProgram
      .getSignature()
      .getDescription() as string;
    expect(actorDesc).toContain('CUSTOM ACTOR HEADER');
    // Default builtin header should be gone
    expect(actorDesc).not.toMatch(/^## Executor$/m);

    // After querying components again, the override is reflected as `current`
    const after = internal.getOptimizableComponents();
    const updatedTpl = after.find(
      (c: any) => c.key === 'agent::actor-tpl:rlm/executor.md'
    );
    expect(updatedTpl?.current).toBe(customTpl);
  });

  it('primitive override updates rendered primitives list', () => {
    const a = new AxAgent(
      { signature: 'query: string -> answer: string' },
      { ...defaults }
    );
    const internal = getInternal(a);
    internal.setId('agent');

    internal.applyOptimizedComponents({
      'agent::primitive:llmQuery':
        '`await llmQuery(qs)` — Custom one-line description for llmQuery.',
    });

    const actorDesc = internal.actorProgram
      .getSignature()
      .getDescription() as string;
    expect(actorDesc).toContain('Custom one-line description for llmQuery.');
  });

  it('rejects template proposals that do not parse', () => {
    const a = new AxAgent(
      { signature: 'query: string -> answer: string' },
      { ...defaults }
    );
    const internal = getInternal(a);
    internal.setId('agent');

    const before = internal.actorProgram
      .getSignature()
      .getDescription() as string;
    internal.applyOptimizedComponents({
      // Unclosed `if` — should be rejected by validatePromptTemplateSyntax
      'agent::actor-tpl:rlm/executor.md': 'broken {{ if hasInspectRuntime }}',
    });

    const after = internal.actorProgram
      .getSignature()
      .getDescription() as string;
    expect(after).toBe(before);
  });

  it('rejects template proposals that drop required placeholders', () => {
    const a = new AxAgent(
      { signature: 'query: string -> answer: string' },
      { ...defaults }
    );
    const internal = getInternal(a);
    internal.setId('agent');

    const before = internal.actorProgram
      .getSignature()
      .getDescription() as string;
    internal.applyOptimizedComponents({
      'agent::actor-tpl:rlm/executor.md': 'valid syntax but no placeholders',
    });

    const after = internal.actorProgram
      .getSignature()
      .getDescription() as string;
    expect(after).toBe(before);
  });

  it('ignores unknown keys', () => {
    const a = new AxAgent(
      { signature: 'query: string -> answer: string' },
      { ...defaults }
    );
    const internal = getInternal(a);
    internal.setId('agent');

    expect(() =>
      internal.applyOptimizedComponents({
        'agent::actor-tpl:rlm/does-not-exist.md': 'whatever',
        'unknown::nope': 'x',
      })
    ).not.toThrow();
  });
});
