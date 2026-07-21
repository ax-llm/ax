import { describe, expect, it, vi } from 'vitest';

import { AxAIGoogleGemini } from './api.js';
import { axModelInfoGoogleGemini } from './info.js';
import {
  AxAIGoogleGeminiModel,
  GEMINI_CONTEXT_CACHE_SUPPORTED_MODELS,
} from './types.js';

function createMockFetch(body: unknown) {
  return vi.fn().mockImplementation(async () => {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('Gemini grounding: File Search multimodal (May 2026) citations', () => {
  it('maps retrievedContext chunks (uri/title/media_id/page_numbers) to citations', async () => {
    const ai = new AxAIGoogleGemini({
      apiKey: 'key',
      config: { model: AxAIGoogleGeminiModel.Gemini25Flash },
    });

    const fetch = createMockFetch({
      candidates: [
        {
          content: {
            parts: [{ text: 'cited answer' }],
            role: 'model',
          },
          finishReason: 'STOP',
          groundingMetadata: {
            groundingChunks: [
              {
                retrievedContext: {
                  uri: 'gs://bucket/file.pdf',
                  title: 'Internal Report',
                  media_id: 'media_abc',
                  page_numbers: [3, 7],
                },
              },
              {
                maps: {
                  uri: 'https://maps.example.com',
                  title: 'Map',
                },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 2,
        totalTokenCount: 7,
        thoughtsTokenCount: 0,
      },
    });

    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        model: AxAIGoogleGeminiModel.Gemini25Flash,
        chatPrompt: [{ role: 'user', content: 'q' }],
      },
      { stream: false }
    )) as any;

    const citations = res.results[0]?.citations;
    expect(citations).toBeDefined();
    const fileCite = citations?.find(
      (c: any) => c.url === 'gs://bucket/file.pdf'
    );
    expect(fileCite).toBeDefined();
    expect(fileCite?.title).toBe('Internal Report');
    expect(fileCite?.mediaId).toBe('media_abc');
    expect(fileCite?.pageNumbers).toEqual([3, 7]);

    // existing maps grounding still works
    const mapCite = citations?.find(
      (c: any) => c.url === 'https://maps.example.com'
    );
    expect(mapCite).toBeDefined();
  });
});

describe('Gemini deprecation flags', () => {
  it('marks gemini-2.0-flash as deprecated on 2026-06-01', () => {
    const entry = axModelInfoGoogleGemini.find(
      (m) => m.name === AxAIGoogleGeminiModel.Gemini20Flash
    );
    expect(entry?.isDeprecated).toBe(true);
    expect(entry?.deprecatedOn).toBe('2026-06-01');
  });

  it('marks gemini-2.0-flash-lite as deprecated on 2026-06-01', () => {
    const entry = axModelInfoGoogleGemini.find(
      (m) => m.name === AxAIGoogleGeminiModel.Gemini20FlashLite
    );
    expect(entry?.isDeprecated).toBe(true);
    expect(entry?.deprecatedOn).toBe('2026-06-01');
  });

  it('no longer exposes text-embedding-004 in the embed enum', async () => {
    const { AxAIGoogleGeminiEmbedModel } = await import('./types.js');
    expect(
      (AxAIGoogleGeminiEmbedModel as any).TextEmbedding004
    ).toBeUndefined();
    expect(Object.values(AxAIGoogleGeminiEmbedModel)).not.toContain(
      'text-embedding-004'
    );
  });

  it('exposes gemini-embedding-2 in the embed enum', async () => {
    const { AxAIGoogleGeminiEmbedModel } = await import('./types.js');
    expect(AxAIGoogleGeminiEmbedModel.GeminiEmbedding2).toBe(
      'gemini-embedding-2'
    );
  });
});

describe('Gemini new model catalog entries', () => {
  it('exposes the new GA model IDs', () => {
    expect(AxAIGoogleGeminiModel.Gemini36Flash).toBe('gemini-3.6-flash');
    expect(AxAIGoogleGeminiModel.Gemini35FlashLite).toBe(
      'gemini-3.5-flash-lite'
    );
  });

  it.each([
    AxAIGoogleGeminiModel.Gemini36Flash,
    AxAIGoogleGeminiModel.Gemini35FlashLite,
  ])('supports explicit context caching for %s', (model) => {
    expect(GEMINI_CONTEXT_CACHE_SUPPORTED_MODELS).toContain(model);
  });

  it.each([
    AxAIGoogleGeminiModel.Gemini36Flash,
    AxAIGoogleGeminiModel.Gemini35Flash,
    AxAIGoogleGeminiModel.Gemini35FlashLite,
    AxAIGoogleGeminiModel.Gemini31FlashLite,
    AxAIGoogleGeminiModel.Gemini31FlashImage,
    AxAIGoogleGeminiModel.Gemini31FlashLive,
    AxAIGoogleGeminiModel.Gemini31FlashTTS,
    AxAIGoogleGeminiModel.NanoBanana2,
    AxAIGoogleGeminiModel.GeminiRoboticsER16,
  ])('has %s in info catalog', (model) => {
    const entry = axModelInfoGoogleGemini.find((m) => m.name === model);
    expect(entry).toBeDefined();
  });

  it.each([
    {
      model: AxAIGoogleGeminiModel.Gemini36Flash,
      inputCost: 1.5,
      outputCost: 7.5,
    },
    {
      model: AxAIGoogleGeminiModel.Gemini35FlashLite,
      inputCost: 0.3,
      outputCost: 2.5,
    },
  ])('describes $model limits, pricing, and capabilities', (expected) => {
    const entry = axModelInfoGoogleGemini.find(
      (model) => model.name === expected.model
    );

    expect(entry).toMatchObject({
      promptTokenCostPer1M: expected.inputCost,
      completionTokenCostPer1M: expected.outputCost,
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      supported: {
        thinkingBudget: true,
        showThoughts: true,
        structuredOutputs: true,
      },
      notSupported: { temperature: true, topP: true },
    });
  });
});
