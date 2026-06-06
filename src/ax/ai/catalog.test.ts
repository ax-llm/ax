import { describe, expect, it } from 'vitest';
import { AxAIAnthropicModel } from './anthropic/types.js';
import { axGetSupportedAIModels } from './catalog.js';
import { AxAIDeepSeekModel } from './deepseek/types.js';
import {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from './google-gemini/types.js';
import { AxAIOpenAIModel } from './openai/chat_types.js';

describe('axGetSupportedAIModels', () => {
  it('returns every ai() provider', () => {
    const providers = axGetSupportedAIModels();
    const providerNames = providers.map((provider) => provider.name);

    expect(providerNames).toEqual(
      expect.arrayContaining([
        'openai',
        'openai-responses',
        'azure-openai',
        'anthropic',
        'google-gemini',
        'cohere',
        'deepseek',
        'mistral',
        'huggingface',
        'reka',
        'grok',
        'litellm',
      ])
    );
    expect(providerNames).toHaveLength(12);
  });

  it('returns provider grouped model metadata with pricing', () => {
    const openai = axGetSupportedAIModels().find(
      (provider) => provider.name === 'openai'
    );
    const gpt5Mini = openai?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPT5Mini
    );

    expect(openai?.displayName).toBe('OpenAI');
    expect(openai?.defaultModel).toBe(AxAIOpenAIModel.GPT5Mini);
    expect(gpt5Mini).toMatchObject({
      provider: 'openai',
      type: 'text',
      isDefault: true,
      currency: 'usd',
      promptTokenCostPer1M: 0.25,
      completionTokenCostPer1M: 2,
    });
  });

  it('sorts models by cheapest token pricing first', () => {
    const openai = axGetSupportedAIModels().find(
      (provider) => provider.name === 'openai'
    );
    const textOpenAI = axGetSupportedAIModels({ type: 'text' }).find(
      (provider) => provider.name === 'openai'
    );

    expect(openai?.models.at(0)?.name).toBe('text-embedding-3-small');
    expect(textOpenAI?.models.at(0)?.name).toBe(AxAIOpenAIModel.GPT5Nano);
    expect(
      textOpenAI?.models.findIndex(
        (model) => model.name === AxAIOpenAIModel.GPT5Pro
      )
    ).toBeGreaterThan(
      textOpenAI?.models.findIndex(
        (model) => model.name === AxAIOpenAIModel.GPT41Nano
      ) ?? -1
    );
  });

  it('filters models by selector type', () => {
    const textProviders = axGetSupportedAIModels({ type: 'text' });
    const textOpenAI = textProviders.find(
      (provider) => provider.name === 'openai'
    );
    const embeddingOpenAI = axGetSupportedAIModels({
      type: 'embeddings',
    }).find((provider) => provider.name === 'openai');
    const codeOpenAI = axGetSupportedAIModels({ type: 'code' }).find(
      (provider) => provider.name === 'openai'
    );
    const audioOpenAI = axGetSupportedAIModels({ type: 'audio' }).find(
      (provider) => provider.name === 'openai'
    );

    expect(
      textOpenAI?.models.some((model) => model.type === 'embeddings')
    ).toBe(false);
    expect(textOpenAI?.models.some((model) => model.type === 'code')).toBe(
      true
    );
    expect(
      embeddingOpenAI?.models.every((model) => model.type === 'embeddings')
    ).toBe(true);
    expect(codeOpenAI?.models.every((model) => model.type === 'code')).toBe(
      true
    );
    expect(audioOpenAI?.models.every((model) => model.type === 'audio')).toBe(
      true
    );
  });

  it('normalizes model capabilities for selectors', () => {
    const providers = axGetSupportedAIModels();
    const openai = providers.find((provider) => provider.name === 'openai');
    const gpt5Nano = openai?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPT5Nano
    );
    const realtime = openai?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPTRealtime2
    );

    expect(gpt5Nano?.capabilities).toMatchObject({
      structuredOutputs: true,
      temperature: false,
      topP: false,
      audioInput: false,
      audioOutput: false,
    });
    expect(realtime?.capabilities).toMatchObject({
      thinkingBudget: true,
      audioInput: true,
      audioOutput: true,
    });

    const anthropic = providers.find(
      (provider) => provider.name === 'anthropic'
    );
    const claude = anthropic?.models.find(
      (model) => model.name === AxAIAnthropicModel.Claude37Sonnet
    );
    const claude48Opus = anthropic?.models.find(
      (model) => model.name === AxAIAnthropicModel.Claude48Opus
    );

    expect(anthropic?.defaultModel).toBe(AxAIAnthropicModel.Claude37Sonnet);
    expect(claude?.capabilities).toMatchObject({
      thinkingBudget: true,
      showThoughts: true,
    });
    expect(claude48Opus).toMatchObject({
      provider: 'anthropic',
      type: 'text',
      promptTokenCostPer1M: 5,
      completionTokenCostPer1M: 25,
      fastPromptTokenCostPer1M: 10,
      fastCompletionTokenCostPer1M: 50,
      maxTokens: 128000,
      contextWindow: 1_000_000,
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
      },
    });

    const gemini = providers.find(
      (provider) => provider.name === 'google-gemini'
    );
    const gemini35Flash = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini35Flash
    );
    const gemini31Live = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini31FlashLive
    );
    const geminiEmbedding2 = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiEmbedModel.GeminiEmbedding2
    );

    expect(gemini?.defaultEmbedModel).toBe(
      AxAIGoogleGeminiEmbedModel.GeminiEmbedding2
    );
    expect(gemini35Flash).toMatchObject({
      provider: 'google-gemini',
      type: 'text',
      promptTokenCostPer1M: 1.5,
      completionTokenCostPer1M: 9,
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
      },
    });
    expect(gemini31Live).toMatchObject({
      type: 'audio',
      capabilities: {
        audioInput: true,
        audioOutput: true,
      },
    });
    expect(geminiEmbedding2).toMatchObject({
      type: 'embeddings',
      isDefault: true,
      promptTokenCostPer1M: 0.2,
    });

    const deepseek = providers.find((provider) => provider.name === 'deepseek');
    const deepseekV4Flash = deepseek?.models.find(
      (model) => model.name === AxAIDeepSeekModel.DeepSeekV4Flash
    );

    expect(deepseek?.defaultModel).toBe(AxAIDeepSeekModel.DeepSeekV4Flash);
    expect(deepseekV4Flash).toMatchObject({
      provider: 'deepseek',
      type: 'text',
      isDefault: true,
      aliases: [
        AxAIDeepSeekModel.DeepSeekChat,
        AxAIDeepSeekModel.DeepSeekReasoner,
      ],
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
      },
    });
    expect(
      deepseek?.models.some(
        (model) => model.name === AxAIDeepSeekModel.DeepSeekCoder
      )
    ).toBe(false);
  });

  it('returns cloned metadata on each call', () => {
    const first = axGetSupportedAIModels();
    const firstOpenAI = first.find((provider) => provider.name === 'openai');
    const firstModel = firstOpenAI?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPT5Mini
    );

    firstOpenAI?.models.push({
      name: 'mutated',
      provider: 'openai',
      type: 'text',
      isDefault: false,
      capabilities: {
        thinkingBudget: false,
        showThoughts: false,
        structuredOutputs: false,
        temperature: true,
        topP: true,
        audioInput: false,
        audioOutput: false,
      },
    });
    if (firstModel) {
      firstModel.promptTokenCostPer1M = 999;
      firstModel.capabilities.structuredOutputs = false;
    }

    const secondOpenAI = axGetSupportedAIModels().find(
      (provider) => provider.name === 'openai'
    );
    const secondModel = secondOpenAI?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPT5Mini
    );

    expect(secondOpenAI?.models.some((model) => model.name === 'mutated')).toBe(
      false
    );
    expect(secondModel?.promptTokenCostPer1M).toBe(0.25);
    expect(secondModel?.capabilities.structuredOutputs).toBe(true);
  });

  it('marks dynamic providers without inventing static pricing', () => {
    const providers = axGetSupportedAIModels();

    for (const providerName of [
      'azure-openai',
      'huggingface',
      'litellm',
    ] as const) {
      const provider = providers.find((item) => item.name === providerName);

      expect(provider?.isDynamic).toBe(true);
      expect(provider?.models).toHaveLength(0);
    }
  });
});
