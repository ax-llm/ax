import { describe, expect, it } from 'vitest';
import { AxAIAnthropicModel } from './anthropic/types.js';
import { axGetSupportedAIModels } from './catalog.js';
import { AxAIDeepSeekModel } from './deepseek/types.js';
import {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from './google-gemini/types.js';
import { AxAIOpenAIModel } from './openai/chat_types.js';
import { axAIProfiles } from './provider_profiles.js';
// axir-nonportable:start webllm
import { AxAIWebLLMModel } from './webllm/types.js';

// axir-nonportable:end webllm
import { AxAIGrokModel } from './x-grok/types.js';

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
        'deepseek-responses',
        'mistral',
        'reka',
        'grok',
        // axir-nonportable:start webllm
        'webllm',
        // axir-nonportable:end webllm
      ])
    );
    // axir-nonportable:start webllm
    expect(providerNames).toHaveLength(axAIProfiles().length);
    // axir-nonportable:end webllm
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

    expect(anthropic?.defaultModel).toBe(AxAIAnthropicModel.Claude37Sonnet);
    expect(claude?.capabilities).toMatchObject({
      thinkingBudget: true,
      showThoughts: true,
    });

    const gemini = providers.find(
      (provider) => provider.name === 'google-gemini'
    );
    const gemini35Flash = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini35Flash
    );
    const gemini37Flash = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini37Flash
    );
    const gemini36Flash = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini36Flash
    );
    const gemini35FlashLite = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini35FlashLite
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
    expect(gemini37Flash).toMatchObject({
      provider: 'google-gemini',
      type: 'text',
      promptTokenCostPer1M: 1.5,
      completionTokenCostPer1M: 7.5,
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
        temperature: false,
        topP: false,
      },
    });
    expect(gemini36Flash).toMatchObject({
      provider: 'google-gemini',
      type: 'text',
      promptTokenCostPer1M: 1.5,
      completionTokenCostPer1M: 7.5,
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
        temperature: false,
        topP: false,
      },
    });
    expect(gemini35FlashLite).toMatchObject({
      provider: 'google-gemini',
      type: 'text',
      promptTokenCostPer1M: 0.3,
      completionTokenCostPer1M: 2.5,
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
        temperature: false,
        topP: false,
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
    // axir-nonportable:start webllm
    const webllm = providers.find((provider) => provider.name === 'webllm');
    const llama32 = webllm?.models.find(
      (model) => model.name === AxAIWebLLMModel.Llama32_3B_Instruct
    );

    expect(webllm?.defaultModel).toBe(AxAIWebLLMModel.Llama32_3B_Instruct);
    expect(llama32).toMatchObject({
      provider: 'webllm',
      type: 'text',
      isDefault: true,
      promptTokenCostPer1M: 0,
      completionTokenCostPer1M: 0,
    });
    // axir-nonportable:end webllm
  });

  it('returns provider and model thinking levels and service tiers', () => {
    const providers = axGetSupportedAIModels();
    const portableThinkingLevels = [
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'highest',
    ];

    const openai = providers.find((provider) => provider.name === 'openai');
    const gpt56Luna = openai?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPT56Luna
    );
    const realtime = openai?.models.find(
      (model) => model.name === AxAIOpenAIModel.GPTRealtime2
    );

    expect(openai?.capabilities).toEqual({
      thinking: true,
      thinkingLevels: portableThinkingLevels,
      serviceTiers: ['standard', 'flex', 'priority'],
    });
    expect(gpt56Luna?.capabilities.thinkingLevels).toEqual(
      portableThinkingLevels
    );
    expect(gpt56Luna?.capabilities.serviceTiers).toEqual([
      'standard',
      'flex',
      'priority',
    ]);
    expect(realtime?.capabilities.serviceTiers).toEqual([]);

    const gemini = providers.find(
      (provider) => provider.name === 'google-gemini'
    );
    const geminiLive = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiModel.Gemini31FlashLive
    );
    const geminiEmbedding = gemini?.models.find(
      (model) => model.name === AxAIGoogleGeminiEmbedModel.GeminiEmbedding2
    );

    expect(geminiLive?.capabilities.serviceTiers).toEqual([]);
    expect(geminiEmbedding?.capabilities.serviceTiers).toEqual([]);

    const grok = providers.find((provider) => provider.name === 'grok');
    const grok46 = grok?.models.find(
      (model) => model.name === AxAIGrokModel.Grok46
    );
    const grok3Mini = grok?.models.find(
      (model) => model.name === AxAIGrokModel.Grok3Mini
    );
    const grokVoice = grok?.models.find(
      (model) => model.name === AxAIGrokModel.GrokVoiceThinkFast
    );

    expect(grok46?.capabilities.thinkingLevels).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'highest',
    ]);
    expect(grok46?.capabilities.serviceTiers).toEqual(['standard', 'priority']);
    expect(grok3Mini?.capabilities.thinkingLevels).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'highest',
    ]);
    expect(grokVoice?.capabilities.serviceTiers).toEqual([]);

    const azure = providers.find(
      (provider) => provider.name === 'azure-openai'
    );
    expect(azure?.models).toEqual([]);
    expect(azure?.capabilities.serviceTiers).toEqual(['standard', 'priority']);
  });

  it.each([
    {
      label: 'Claude 5 Sonnet',
      name: AxAIAnthropicModel.Claude5Sonnet,
      pricing: {
        promptTokenCostPer1M: 2,
        completionTokenCostPer1M: 10,
        cacheReadTokenCostPer1M: 0.2,
        cacheWriteTokenCostPer1M: 2.5,
      },
      fastPricing: undefined,
    },
    {
      label: 'Claude 4.8 Opus',
      name: AxAIAnthropicModel.Claude48Opus,
      pricing: {
        promptTokenCostPer1M: 5,
        completionTokenCostPer1M: 25,
        cacheReadTokenCostPer1M: 0.5,
        cacheWriteTokenCostPer1M: 6.25,
      },
      fastPricing: {
        fastPromptTokenCostPer1M: 10,
        fastCompletionTokenCostPer1M: 50,
        fastCacheReadTokenCostPer1M: 1,
        fastCacheWriteTokenCostPer1M: 12.5,
      },
    },
  ])('exposes $label token pricing', ({ name, pricing, fastPricing }) => {
    // The Anthropic and Vertex enums share these model ids, so the catalog
    // carries one entry per surface. Assert every copy: the catalog sorts by
    // price, so checking only the first would let a stale duplicate through.
    const models = axGetSupportedAIModels()
      .find((provider) => provider.name === 'anthropic')
      ?.models.filter((entry) => entry.name === name);

    expect(models?.length).toBeGreaterThan(0);
    for (const model of models ?? []) {
      expect(model).toMatchObject({
        provider: 'anthropic',
        type: 'text',
        currency: 'usd',
        maxTokens: 128000,
        contextWindow: 1_000_000,
        capabilities: {
          thinkingBudget: true,
          showThoughts: true,
          structuredOutputs: true,
        },
        ...pricing,
      });
    }

    // Fast mode is first-party only, so just one of the copies carries it.
    if (fastPricing) {
      expect(models).toContainEqual(expect.objectContaining(fastPricing));
    }
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
        thinkingLevels: [],
        showThoughts: false,
        structuredOutputs: false,
        temperature: true,
        topP: true,
        audioInput: false,
        audioOutput: false,
        serviceTiers: [],
      },
    });
    if (firstModel) {
      firstModel.promptTokenCostPer1M = 999;
      firstModel.capabilities.structuredOutputs = false;
      firstModel.capabilities.serviceTiers.push('priority');
    }
    firstOpenAI?.capabilities.serviceTiers.push('auto');

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
    expect(secondModel?.capabilities.serviceTiers).toEqual([
      'standard',
      'flex',
      'priority',
    ]);
    expect(secondOpenAI?.capabilities.serviceTiers).toEqual([
      'standard',
      'flex',
      'priority',
    ]);
  });

  it('marks dynamic providers without inventing static pricing', () => {
    const providers = axGetSupportedAIModels();

    for (const providerName of ['azure-openai'] as const) {
      const provider = providers.find((item) => item.name === providerName);

      expect(provider?.isDynamic).toBe(true);
      expect(provider?.models).toHaveLength(0);
    }
  });
});
