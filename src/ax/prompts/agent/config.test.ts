import { describe, expect, it } from 'vitest';

import {
  ACTOR_MODEL_POLICY_MIGRATION_ERROR,
  computeEffectiveChatBudget,
  CONTEXT_POLICY_SUMMARIZER_OPTIONS_MIGRATION_ERROR,
  DEFAULT_RLM_MAX_RUNTIME_CHARS,
  DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS,
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
      maxRuntimeChars: DEFAULT_RLM_MAX_RUNTIME_CHARS,
      stateSummary: {
        enabled: true,
        maxChars: DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS,
      },
      stateInspection: {
        enabled: false,
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
      maxRuntimeChars: DEFAULT_RLM_MAX_RUNTIME_CHARS,
      stateSummary: {
        enabled: true,
        maxChars: DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS,
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

  it('should accept top-level summarizer options', () => {
    expect(
      resolveContextPolicy(
        {
          preset: 'checkpointed',
          budget: 'balanced',
        },
        {
          model: 'summary-model',
          modelConfig: { temperature: 0.2 },
        }
      )
    ).toMatchObject({
      summarizerOptions: {
        model: 'summary-model',
        modelConfig: { temperature: 0.2 },
      },
    });
  });

  it('should accept a separate top-level maxRuntimeChars override', () => {
    expect(
      resolveContextPolicy(
        {
          preset: 'checkpointed',
          budget: 'expanded',
        },
        undefined,
        4_200
      )
    ).toMatchObject({
      targetPromptChars: 20_000,
      maxRuntimeChars: 4_200,
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

  it('should reject nested summarizer options', () => {
    expect(() =>
      resolveContextPolicy({
        preset: 'checkpointed',
        summarizerOptions: { model: 'summary-model' },
      } as never)
    ).toThrow(CONTEXT_POLICY_SUMMARIZER_OPTIONS_MIGRATION_ERROR);
  });

  it('should default runtime truncation independently from budget', () => {
    expect(
      resolveContextPolicy({
        preset: 'checkpointed',
        budget: 'compact',
      }).maxRuntimeChars
    ).toBe(DEFAULT_RLM_MAX_RUNTIME_CHARS);
    expect(
      resolveContextPolicy({
        preset: 'checkpointed',
        budget: 'expanded',
      }).maxRuntimeChars
    ).toBe(DEFAULT_RLM_MAX_RUNTIME_CHARS);
  });

  it('should keep state summary maxChars independent from budget', () => {
    expect(
      resolveContextPolicy({
        preset: 'checkpointed',
        budget: 'compact',
      }).stateSummary.maxChars
    ).toBe(DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS);
    expect(
      resolveContextPolicy({
        preset: 'checkpointed',
        budget: 'expanded',
      }).stateSummary.maxChars
    ).toBe(DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS);
  });
});

describe('computeEffectiveChatBudget', () => {
  it('should return full budget when no system prompt overhead', () => {
    expect(computeEffectiveChatBudget(16_000, 0)).toBe(16_000);
  });

  it('should scale down proportionally for medium system prompt', () => {
    // 10K system → ratio = 1 - 10000/30000 = 0.667 → 16000 * 0.667 = 10667
    expect(computeEffectiveChatBudget(16_000, 10_000)).toBe(10_666);
  });

  it('should hit the floor for very large system prompt', () => {
    // 30K+ system → clamped to minRatio 0.25 → 16000 * 0.25 = 4000
    expect(computeEffectiveChatBudget(16_000, 30_000)).toBe(4_000);
    expect(computeEffectiveChatBudget(16_000, 50_000)).toBe(4_000);
  });

  it('should respect custom maxSystemChars and minRatio', () => {
    // 10K system, max 20K → ratio = 1 - 10000/20000 = 0.5 → 16000 * 0.5 = 8000
    expect(computeEffectiveChatBudget(16_000, 10_000, 20_000, 0.3)).toBe(8_000);
    // Hits custom floor
    expect(computeEffectiveChatBudget(16_000, 20_000, 20_000, 0.3)).toBe(4_800);
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
