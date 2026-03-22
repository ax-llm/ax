import { describe, expect, it } from 'vitest';

import {
  ACTOR_MODEL_POLICY_MIGRATION_ERROR,
  MAX_RUNTIME_CHARS_MIGRATION_ERROR,
  resolveActorModelPolicy,
  resolveContextPolicy,
  selectActorModelFromPolicy,
} from './config.js';

describe('resolveContextPolicy', () => {
  it('should default to checkpointed balanced budgets', () => {
    expect(resolveContextPolicy(undefined)).toMatchObject({
      preset: 'checkpointed',
      budget: 'balanced',
      targetPromptChars: 16_000,
      maxRuntimeChars: 5_000,
      stateSummary: {
        enabled: true,
        maxChars: 1_200,
      },
      stateInspection: {
        enabled: true,
        contextThreshold: 13_600,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 16_000,
      },
    });
  });

  it('should derive compact adaptive internals from budget only', () => {
    expect(
      resolveContextPolicy({
        preset: 'adaptive',
        budget: 'compact',
      })
    ).toMatchObject({
      preset: 'adaptive',
      budget: 'compact',
      recentFullActions: 1,
      targetPromptChars: 12_000,
      maxRuntimeChars: 3_000,
      stateSummary: {
        enabled: true,
        maxChars: 800,
      },
      stateInspection: {
        enabled: true,
        contextThreshold: 10_200,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 9_000,
      },
    });
  });

  it('should reject removed state controls', () => {
    expect(() =>
      resolveContextPolicy({
        preset: 'checkpointed',
        state: { summary: true },
      } as never)
    ).toThrow(
      'contextPolicy.state.* has been removed. Use contextPolicy.budget instead.'
    );
  });

  it('should reject removed checkpoint controls', () => {
    expect(() =>
      resolveContextPolicy({
        preset: 'checkpointed',
        checkpoints: { triggerChars: 1 },
      } as never)
    ).toThrow(
      'contextPolicy.checkpoints.* has been removed. Use contextPolicy.budget instead.'
    );
  });

  it('should reject removed runtime truncation control', () => {
    expect(() => {
      throw new Error(MAX_RUNTIME_CHARS_MIGRATION_ERROR);
    }).toThrow(MAX_RUNTIME_CHARS_MIGRATION_ERROR);
  });
});

describe('actorModelPolicy', () => {
  it('should reject removed prompt-size routing', () => {
    expect(() =>
      resolveActorModelPolicy([
        {
          model: 'actor-large',
          abovePromptChars: 10_000,
        } as never,
      ])
    ).toThrow(ACTOR_MODEL_POLICY_MIGRATION_ERROR);
  });

  it('should select the last matching namespace or error-turn rule', () => {
    const policy = resolveActorModelPolicy([
      {
        model: 'actor-db',
        namespaces: ['db'],
      },
      {
        model: 'actor-retry',
        aboveErrorTurns: 2,
      },
      {
        model: 'actor-kb',
        namespaces: ['kb'],
      },
    ])!;

    expect(selectActorModelFromPolicy(policy, 0, ['db'])).toBe('actor-db');
    expect(selectActorModelFromPolicy(policy, 2, ['db'])).toBe('actor-retry');
    expect(selectActorModelFromPolicy(policy, 2, ['db', 'kb'])).toBe(
      'actor-kb'
    );
  });
});
