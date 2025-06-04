import { describe, it, expect } from 'vitest'
import {
  AxAIOpenAIImpl,
  axAIOpenAIDefaultConfig,
} from './api.js' // Assuming AxAIOpenAIImpl can be imported for testing
import type {
  AxAIOpenAIConfig,
  AxAIOpenAIModel,
} from './chat_types.js'
import type {
  AxInternalChatRequest,
  AxAIPromptConfig,
} from '../types.js'

// Helper to create a minimal AxAIOpenAIImpl instance for testing createChatReq
const createTestInstance = (
  configOverrides?: Partial<AxAIOpenAIConfig<AxAIOpenAIModel>>
) => {
  const fullConfig: AxAIOpenAIConfig<AxAIOpenAIModel> = {
    ...axAIOpenAIDefaultConfig(),
    apiKey: 'test-key', // apiKey is often required by the base or impl
    ...(configOverrides as AxAIOpenAIConfig<AxAIOpenAIModel>),
  }
  // The second argument to AxAIOpenAIImpl constructor is streamingUsage (boolean)
  return new AxAIOpenAIImpl(fullConfig, false)
}

describe('AxAIOpenAIImpl.createChatReq', () => {
  const baseInternalReq: AxInternalChatRequest<AxAIOpenAIModel> = {
    model: 'gpt-4o' as AxAIOpenAIModel, // Example model
    chatPrompt: [{ role: 'user', content: 'Hello' }],
    // modelConfig, functions, functionCall can be added if needed by specific tests
  }

  it('should not set reasoning_effort when thinkingTokenBudget is "disable"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'disable',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.reasoning_effort).toBeUndefined()
  })

  it('should set reasoning_effort to "low" when thinkingTokenBudget is "minimal"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'minimal',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.reasoning_effort).toBe('low')
  })

  it('should set reasoning_effort to "medium" when thinkingTokenBudget is "low"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'low',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.reasoning_effort).toBe('medium')
  })

  it('should set reasoning_effort to "high" when thinkingTokenBudget is "medium"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'medium',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.reasoning_effort).toBe('high')
  })

  it('should set reasoning_effort to "high" when thinkingTokenBudget is "high"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'high',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.reasoning_effort).toBe('high')
  })

  it('should set reasoning_effort to "high" when thinkingTokenBudget is "highest"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'highest',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.reasoning_effort).toBe('high')
  })

  it('should not set reasoning_effort if thinkingTokenBudget is undefined in promptConfig but defined in instance config and is "disable"', () => {
    // This case is tricky. The current implementation has two places where reasoning_effort can be set:
    // 1. From this.config.reasoningEffort (instance config)
    // 2. From promptConfig.thinkingTokenBudget (call-specific config)
    // The promptConfig seems to take precedence or add to it.
    // If promptConfig.thinkingTokenBudget is undefined, it falls back to this.config.reasoningEffort.
    // The original code was:
    // if (this.config.reasoningEffort) { reqValue.reasoning_effort = this.config.reasoningEffort; }
    // if (config.thinkingTokenBudget && config.thinkingTokenBudget !== 'disable') { ... }
    // This means instance config always applies if present, and then promptConfig overwrites if present and not 'disable'.
    // This test should verify that if promptConfig.thinkingTokenBudget is NOT set,
    // and this.config.reasoningEffort was somehow set to a value that implies "disable" (which is not directly possible for reasoningEffort),
    // or if this.config.thinkingTokenBudget (if it existed) was 'disable', it would be ignored.
    // The current implementation has `this.config.reasoningEffort` not `this.config.thinkingTokenBudget`.
    // Let's test the scenario where `this.config.reasoningEffort` is set, and `promptConfig.thinkingTokenBudget` is undefined.

    const instanceWithReasoningEffort = createTestInstance({ reasoningEffort: 'auto' }); // some baseline
    const promptConfig: AxAIPromptConfig = {
      // thinkingTokenBudget is undefined
    }
    const [, chatReq] = instanceWithReasoningEffort.createChatReq(baseInternalReq, promptConfig)
    // It should use the instance's reasoningEffort
    expect(chatReq.reasoning_effort).toBe('auto');
  })

  it('should overwrite instance reasoning_effort if promptConfig.thinkingTokenBudget is "minimal"', () => {
    const instanceWithReasoningEffort = createTestInstance({ reasoningEffort: 'auto' });
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'minimal',
    }
    const [, chatReq] = instanceWithReasoningEffort.createChatReq(baseInternalReq, promptConfig)
    expect(chatReq.reasoning_effort).toBe('low'); // promptConfig overrides instance default
  })

  it('should clear instance reasoning_effort if promptConfig.thinkingTokenBudget is "disable"', () => {
    const instanceWithReasoningEffort = createTestInstance({ reasoningEffort: 'auto' });
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'disable',
    }
    const [, chatReq] = instanceWithReasoningEffort.createChatReq(baseInternalReq, promptConfig)
    // The logic is:
    // 1. `reqValue.reasoning_effort = this.config.reasoningEffort;` (if this.config.reasoningEffort exists)
    // 2. `if (config.thinkingTokenBudget && config.thinkingTokenBudget !== 'disable') { ... }`
    // If thinkingTokenBudget is 'disable', the second block is skipped.
    // So, `reasoning_effort` remains what `this.config.reasoningEffort` set it to.
    // This means "disable" does NOT clear a pre-existing reasoning_effort from instance config.
    // This seems like a potential bug or unintended interaction based on the subtask description.
    // The subtask: "If it's "disable", reasoning_effort should not be set in the API request."
    // This implies it *should* be undefined.
    // With the new logic, 'disable' will explicitly set it to undefined.
    expect(chatReq.reasoning_effort).toBeUndefined();
    // If the requirement is that 'disable' *always* removes it, the implementation of createChatReq needs changing:
    // e.g., after the two blocks, add:
    // if (config.thinkingTokenBudget === 'disable') { delete reqValue.reasoning_effort; }
    // Or, the initial if (this.config.reasoningEffort) block should also check config.thinkingTokenBudget !== 'disable'
  })

})
