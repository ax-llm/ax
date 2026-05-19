import { describe, expect, it, vi } from 'vitest';

import { AxAIGoogleGemini } from './api.js';
import { axModelInfoGoogleGemini } from './info.js';
import { AxAIGoogleGeminiModel } from './types.js';

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
  it.each([
    AxAIGoogleGeminiModel.Gemini35Flash,
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
});
