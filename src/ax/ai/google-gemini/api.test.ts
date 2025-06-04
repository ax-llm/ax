import { describe, it, expect } from 'vitest'
import {
  AxAIGoogleGeminiImpl,
  axAIGoogleGeminiDefaultConfig,
} from './api.js' // Assuming AxAIGoogleGeminiImpl can be imported
import type {
  AxAIGoogleGeminiConfig,
  AxAIGoogleGeminiModel,
  AxAIGoogleGeminiGenerationConfig,
} from './types.js'
import type {
  AxInternalChatRequest,
  AxAIPromptConfig,
} from '../types.js'

// Helper to create a minimal AxAIGoogleGeminiImpl instance for testing createChatReq
const createTestInstance = (
  configOverrides?: Partial<AxAIGoogleGeminiConfig>
) => {
  const fullConfig: AxAIGoogleGeminiConfig = {
    ...axAIGoogleGeminiDefaultConfig(),
    apiKey: 'test-key', // apiKey might be needed by constructor or methods
    ...(configOverrides as AxAIGoogleGeminiConfig),
  }
  // Constructor: AxAIGoogleGeminiImpl(config, isVertex, endpointId, apiKey, options)
  return new AxAIGoogleGeminiImpl(fullConfig, false, undefined, 'test-key')
}

describe('AxAIGoogleGeminiImpl.createChatReq', () => {
  const baseInternalReq: AxInternalChatRequest<AxAIGoogleGeminiModel> = {
    model: 'gemini-1.5-flash-latest' as AxAIGoogleGeminiModel, // Example model
    chatPrompt: [{ role: 'user', content: 'Hello' }],
  }

  it('should set thinkingBudget to 0 in generationConfig.thinkingConfig when thinkingTokenBudget is "disable"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'disable',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(0)
  })

  it('should set thinkingBudget in generationConfig.thinkingConfig when thinkingTokenBudget is "minimal"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'minimal',
    }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)

    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(200)
  })

  it('should set thinkingBudget for "low"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = { thinkingTokenBudget: 'low' }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(800)
  })

  it('should set thinkingBudget for "medium"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = { thinkingTokenBudget: 'medium' }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(5000)
  })

  it('should set thinkingBudget for "high"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = { thinkingTokenBudget: 'high' }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(10000)
  })

  it('should set thinkingBudget for "highest"', () => {
    const instance = createTestInstance()
    const promptConfig: AxAIPromptConfig = { thinkingTokenBudget: 'highest' }
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig)
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(24500)
  })

  it('should use instance thinkingTokenBudget if promptConfig.thinkingTokenBudget is undefined', () => {
    // In Gemini, instance config has `this.config.thinking.thinkingTokenBudget`
    const instanceWithThinkingBudget = createTestInstance({
      thinking: { includeThoughts: true, thinkingTokenBudget: 1234 },
    })
    const promptConfig: AxAIPromptConfig = {
      // thinkingTokenBudget is undefined
    }
    const [, chatReq] = instanceWithThinkingBudget.createChatReq(baseInternalReq, promptConfig)
    // The logic:
    // 1. if (this.config.thinking?.thinkingTokenBudget) { thinkingConfig.thinkingBudget = this.config.thinking.thinkingTokenBudget }
    // 2. if (config.thinkingTokenBudget && config.thinkingTokenBudget !== 'disable') { switch ... thinkingConfig.thinkingBudget = ... }
    // So, if promptConfig.thinkingTokenBudget is undefined, the instance one (1234) should apply.
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(1234)
  })

  it('should overwrite instance thinkingTokenBudget if promptConfig.thinkingTokenBudget is "minimal"', () => {
    const instanceWithThinkingBudget = createTestInstance({
      thinking: { includeThoughts: true, thinkingTokenBudget: 1234 },
    })
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'minimal', // This is 200
    }
    const [, chatReq] = instanceWithThinkingBudget.createChatReq(baseInternalReq, promptConfig)
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(200)
  })

  it('should set thinkingBudget to 0 (overriding instance budget) when promptConfig.thinkingTokenBudget is "disable"', () => {
    const instanceWithThinkingBudget = createTestInstance({
      thinking: { includeThoughts: true, thinkingTokenBudget: 1234 },
    })
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'disable',
    }
    const [, chatReq] = instanceWithThinkingBudget.createChatReq(baseInternalReq, promptConfig)
    // With the new logic, 'disable' in promptConfig sets thinkingBudget to 0,
    // overriding the instance-set value of 1234.
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(0)
    // If 'disable' should always clear it, the implementation of createChatReq would need:
    // if (config.thinkingTokenBudget === 'disable' && chatReq.generationConfig?.thinkingConfig) {
    //   delete chatReq.generationConfig.thinkingConfig.thinkingBudget;
    // }
    // or ensure thinkingConfig itself is not set if only budget was in it.
  })

  it('should ensure thinkingConfig is defined if includeThoughts is true, even if budget is disabled', () => {
    const instance = createTestInstance({
      thinking: { includeThoughts: true }, // Instance wants thoughts
    });
    const promptConfig: AxAIPromptConfig = {
      thinkingTokenBudget: 'disable', // But disable budget for this call
    };
    const [, chatReq] = instance.createChatReq(baseInternalReq, promptConfig);

    // thinkingConfig should exist because of includeThoughts
    expect(chatReq.generationConfig?.thinkingConfig).toBeDefined();
    expect(chatReq.generationConfig?.thinkingConfig?.includeThoughts).toBe(true);
    // thinkingBudget should be 0 due to 'disable'
    expect(chatReq.generationConfig?.thinkingConfig?.thinkingBudget).toBe(0);
    // This case is different from the previous one. Here, the instance config for thinkingBudget is *not* set.
    // So `this.config.thinking.thinkingTokenBudget` doesn't set it.
    // Then `promptConfig.thinkingTokenBudget === 'disable'` prevents the switch from setting it.
    // So it correctly remains undefined.
  })

})
