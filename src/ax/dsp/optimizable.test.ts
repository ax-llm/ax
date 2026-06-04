import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { AxGen } from './generate.js';
import {
  axOptimizableValidators,
  formatComponentKey,
  parseComponentKey,
} from './optimizable.js';
import { AxOptimizedProgramImpl } from './optimizer.js';

describe('AxOptimizable round-trip on AxGen', () => {
  it('emits description + instruction components and applies them back', () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      '"Answer the user." question:string -> answer:string'
    );
    gen.setId('root');
    gen.setInstruction('initial instruction');

    const components = gen.getOptimizableComponents();
    const byKind = (kind: string) =>
      components.find((c) => c.kind === kind && c.key.startsWith('root::'));

    expect(byKind('description')?.current).toBe('Answer the user.');
    expect(byKind('instruction')?.current).toBe('initial instruction');

    gen.applyOptimizedComponents({
      'root::description': 'Updated module role.',
      'root::instruction': 'Updated instruction.',
    });

    expect(gen.getInstruction()).toBe('Updated instruction.');
    expect(gen.getSignature().getDescription()).toBe('Updated module role.');
  });

  it('renders and preserves instruction components through forward', async () => {
    let renderedPrompt = '';
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });
    ai.chat = async (req) => {
      renderedPrompt = JSON.stringify(req.chatPrompt);
      return {
        results: [{ index: 0, content: 'Answer: ok', finishReason: 'stop' }],
      } as AxChatResponse;
    };

    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );
    gen.setInstruction('Prefer direct answers.');

    await gen.forward(ai, { question: 'test' });

    expect(renderedPrompt).toContain('Prefer direct answers.');
    expect(gen.getInstruction()).toBe('Prefer direct answers.');
  });

  it('emits fn-desc and fn-name components for each registered function', () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string',
      {
        functions: [
          {
            name: 'lookup_user',
            description: 'Look up a user by id.',
            parameters: { type: 'object', properties: {} },
            func: async () => 'ok',
          },
        ],
      }
    );
    gen.setId('root');

    const components = gen.getOptimizableComponents();
    const desc = components.find((c) => c.key === 'root::fn:lookup_user:desc');
    const name = components.find((c) => c.key === 'root::fn:lookup_user:name');
    expect(desc?.kind).toBe('fn-desc');
    expect(desc?.current).toBe('Look up a user by id.');
    expect(name?.kind).toBe('fn-name');
    expect(name?.current).toBe('lookup_user');
    expect(name?.validate?.('lookup_user')).toBe(true);
    expect(typeof name?.validate?.('LookupUser')).toBe('string');

    gen.applyOptimizedComponents({
      'root::fn:lookup_user:desc': 'Resolves a user record by id.',
      'root::fn:lookup_user:name': 'fetch_user',
    });

    const after = gen.getOptimizableComponents();
    expect(
      after.find((c) => c.key === 'root::fn:lookup_user:desc')?.current
    ).toBe('Resolves a user record by id.');
    expect(
      after.find((c) => c.key === 'root::fn:lookup_user:name')?.current
    ).toBe('fetch_user');

    gen.applyOptimizedComponents({
      'root::fn:lookup_user:name': 'lookup_user',
    });

    const restored = gen.getOptimizableComponents();
    expect(
      restored.find((c) => c.key === 'root::fn:lookup_user:name')?.current
    ).toBe('lookup_user');
  });

  it('skips collision rename and ignores unknown keys', () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string',
      {
        functions: [
          {
            name: 'tool_a',
            description: 'A',
            parameters: { type: 'object', properties: {} },
            func: async () => 'ok',
          },
          {
            name: 'tool_b',
            description: 'B',
            parameters: { type: 'object', properties: {} },
            func: async () => 'ok',
          },
        ],
      }
    );
    gen.setId('root');

    gen.applyOptimizedComponents({
      // Collide with sibling — rename must be skipped.
      'root::fn:tool_a:name': 'tool_b',
      // Unknown key — silently ignored.
      'unknown::nope': 'whatever',
    });

    const after = gen.getOptimizableComponents();
    expect(after.find((c) => c.key === 'root::fn:tool_a:name')?.current).toBe(
      'tool_a'
    );
    expect(after.find((c) => c.key === 'root::fn:tool_b:name')?.current).toBe(
      'tool_b'
    );
  });

  it('applies optimized instruction components from componentMap', () => {
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );
    gen.setId('root');
    gen.setInstruction('before');

    gen.applyOptimization(
      new AxOptimizedProgramImpl({
        bestScore: 1,
        stats: {} as any,
        componentMap: { 'root::instruction': 'component instruction' },
        optimizerType: 'test',
        optimizationTime: 0,
      })
    );

    expect(gen.getInstruction()).toBe('component instruction');
  });
});

describe('component key utilities', () => {
  it('parses keys with and without subKey', () => {
    expect(parseComponentKey('root::instruction')).toEqual({
      programId: 'root',
      kind: 'instruction',
    });
    expect(parseComponentKey('root.actor::fn:lookup:desc')).toEqual({
      programId: 'root.actor',
      kind: 'fn',
      subKey: 'lookup:desc',
    });
    expect(parseComponentKey('not-a-key')).toBeNull();
  });

  it('formats keys symmetrically', () => {
    expect(formatComponentKey('root', 'description')).toBe('root::description');
    expect(formatComponentKey('root', 'fn', 'foo:desc')).toBe(
      'root::fn:foo:desc'
    );
  });
});

describe('built-in validators', () => {
  it('snakeCaseIdentifier rejects camelCase and overlong names', () => {
    const v = axOptimizableValidators.snakeCaseIdentifier(8);
    expect(v('ok_name')).toBe(true);
    expect(typeof v('CamelCase')).toBe('string');
    expect(typeof v('this_is_too_long_for_eight')).toBe('string');
  });

  it('preservesPlaceholders enforces required placeholders', () => {
    const v = axOptimizableValidators.preservesPlaceholders(['name', 'date']);
    expect(v('Hello {{name}} on {{date}}')).toBe(true);
    expect(typeof v('Hello {{name}}')).toBe('string');
  });

  it('nonEmpty rejects whitespace-only', () => {
    const v = axOptimizableValidators.nonEmpty();
    expect(v('hello')).toBe(true);
    expect(typeof v('   ')).toBe('string');
  });
});
