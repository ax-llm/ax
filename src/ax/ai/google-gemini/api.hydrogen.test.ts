import { describe, expect, it, vi } from 'vitest';

import { axGetSupportedAIModels } from '../catalog.js';
import { ai } from '../wrap.js';
import type { AxAIGoogleGeminiConfig } from './types.js';
import { AxAIGoogleGeminiModel } from './types.js';

const model = AxAIGoogleGeminiModel.Gemini4Hydrogen;
const prompt = { chatPrompt: [{ role: 'user' as const, content: 'Hello' }] };

function setup(config: Partial<AxAIGoogleGeminiConfig> = {}, vertex = false) {
  const bodies: any[] = [];
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      candidates: [
        { content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' },
      ],
    });
  });
  const llm = ai({
    name: 'google-gemini',
    apiKey: vertex ? async () => 'test-token' : 'test-key',
    ...(vertex ? { projectId: 'test-project', region: 'global' } : {}),
    config: { model, ...config },
    options: { fetch },
  });
  return { llm, bodies, fetch };
}

describe('Gemini 4 Hydrogen', () => {
  it.each([false, true])(
    'maps all logical thinking levels (Vertex: %s)',
    async (vertex) => {
      const { llm, bodies, fetch } = setup({ maxTokens: 4096 }, vertex);
      const levels = [
        ['none', 'low'],
        ['minimal', 'low'],
        ['low', 'low'],
        ['medium', 'medium'],
        ['high', 'high'],
        ['highest', 'xhigh'],
      ] as const;
      for (const [requested, expected] of levels) {
        await llm.chat(prompt, {
          stream: false,
          thinkingTokenBudget: requested,
          showThoughts: true,
        });
        expect(bodies.at(-1).generationConfig).toMatchObject({
          maxOutputTokens: 4096,
          thinkingConfig: {
            thinkingLevel: expected,
            includeThoughts: requested !== 'none',
          },
        });
        expect(
          bodies.at(-1).generationConfig.thinkingConfig
        ).not.toHaveProperty('thinkingBudget');
      }
      expect(String(fetch.mock.calls[0]?.[0])).toContain(
        'models/gemini-4-hydrogen:generateContent'
      );
    }
  );

  it('leaves omitted thinking at the provider default and rejects explicit context caching', async () => {
    const { llm, bodies, fetch } = setup();
    await llm.chat(prompt, { stream: false });
    expect(bodies[0].generationConfig).not.toHaveProperty('thinkingConfig');
    expect(llm.getFeatures().caching.supported).toBe(false);
    await expect(
      llm.chat(prompt, {
        stream: false,
        contextCache: { name: 'cachedContents/test' },
      })
    ).rejects.toThrow(/Context caching is not supported/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'omits ignored sampling and rejected parameters (Vertex: %s)',
    async (vertex) => {
      const { llm, bodies } = setup(
        { temperature: 0.4, topP: 0.8, topK: 10, n: 3, frequencyPenalty: 0.2 },
        vertex
      );
      await llm.chat(
        {
          ...prompt,
          modelConfig: { presencePenalty: 0.3, frequencyPenalty: 0.5, n: 2 },
        },
        { stream: false }
      );
      for (const field of [
        'temperature',
        'topP',
        'topK',
        'presencePenalty',
        'frequencyPenalty',
        'candidateCount',
      ]) {
        expect(bodies[0].generationConfig).not.toHaveProperty(field);
      }
    }
  );

  it('accepts native xhigh and honors an explicit highest mapping', async () => {
    const { llm, bodies } = setup({
      thinking: { thinkingLevel: 'xhigh' },
      thinkingLevelMapping: { highest: 'medium' },
    });
    await llm.chat(prompt, { stream: false });
    expect(bodies[0].generationConfig.thinkingConfig.thinkingLevel).toBe(
      'xhigh'
    );
    await llm.chat(prompt, { stream: false, thinkingTokenBudget: 'highest' });
    expect(bodies[1].generationConfig.thinkingConfig.thinkingLevel).toBe(
      'medium'
    );
  });

  it('resolves thinking after selecting a model preset', async () => {
    const { fetch, bodies } = setup();
    const llm = ai({
      name: 'google-gemini',
      apiKey: 'test-key',
      config: { model: AxAIGoogleGeminiModel.Gemini38Flash },
      models: [
        {
          key: 'hydrogen',
          model,
          description: 'Hydrogen',
          thinkingTokenBudget: 'highest',
        },
      ],
      options: { fetch },
    });
    await llm.chat({ ...prompt, model: 'hydrogen' }, { stream: false });
    expect(bodies[0].generationConfig.thinkingConfig.thinkingLevel).toBe(
      'xhigh'
    );
  });

  it('rejects numeric thinking budgets before transport', async () => {
    expect(() => setup({ thinking: { thinkingTokenBudget: 1024 } })).toThrow(
      /do not support numeric thinkingTokenBudget/
    );
    const { llm, fetch } = setup();
    await expect(
      llm.chat(prompt, { stream: false, thinkingTokenBudget: 1024 as any })
    ).rejects.toThrow(/do not support numeric thinkingTokenBudget/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects output caps requiring continuation before transport', async () => {
    const { llm, fetch } = setup({ maxTokens: 65_537 });
    await expect(llm.chat(prompt, { stream: false })).rejects.toThrow(
      /continuation support/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Gemini 3 highest thinking at high', async () => {
    const { llm, bodies } = setup({
      model: AxAIGoogleGeminiModel.Gemini38Flash,
    });
    await llm.chat(prompt, { stream: false, thinkingTokenBudget: 'highest' });
    expect(bodies[0].generationConfig.thinkingConfig.thinkingLevel).toBe(
      'high'
    );
  });

  it('exposes model limits, pricing, and capabilities in the public catalog', () => {
    const hydrogen = axGetSupportedAIModels()
      .find((p) => p.name === 'google-gemini')
      ?.models.find((m) => m.name === model);
    expect(hydrogen).toMatchObject({
      name: 'gemini-4-hydrogen',
      type: 'text',
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      promptTokenCostPer1M: 1.5,
      completionTokenCostPer1M: 7.5,
      cacheReadTokenCostPer1M: 0.075,
      serviceTierPricing: {
        flex: {
          promptTokenCostPer1M: 0.75,
          completionTokenCostPer1M: 3.75,
          cacheReadTokenCostPer1M: 0.0375,
        },
        priority: {
          promptTokenCostPer1M: 2.7,
          completionTokenCostPer1M: 13.5,
          cacheReadTokenCostPer1M: 0.135,
        },
      },
      capabilities: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
        temperature: false,
        topP: false,
      },
    });
  });
});
