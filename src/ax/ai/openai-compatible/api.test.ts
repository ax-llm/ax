import { describe, expect, it } from 'vitest';

import { AxAIOpenAICompatible } from './api.js';

describe('AxAIOpenAICompatible', () => {
  it('throws when endpoint is missing', () => {
    expect(
      () =>
        new AxAIOpenAICompatible({
          name: 'openai-compatible',
          apiKey: 'test',
          // @ts-expect-error testing runtime validation
          endpoint: '',
        })
    ).toThrow('OpenAI-compatible endpoint not set');
  });

  it('sets custom endpoint, headers, and provider name', async () => {
    const llm = new AxAIOpenAICompatible({
      name: 'openai-compatible',
      apiKey: 'test',
      endpoint: 'https://api.example.com/v1',
      headers: { 'x-provider': 'custom' },
      providerName: 'Example Gateway',
    });

    expect((llm as any).apiURL).toBe('https://api.example.com/v1');
    expect(llm.getName()).toBe('Example Gateway');

    const headers = await (llm as any).headers();
    expect(headers).toMatchObject({
      Authorization: 'Bearer test',
      'x-provider': 'custom',
    });
  });

  it('allows overriding support metadata', () => {
    const llm = new AxAIOpenAICompatible({
      name: 'openai-compatible',
      apiKey: 'test',
      endpoint: 'https://api.example.com/v1',
      supportFor: () => ({
        functions: false,
        streaming: false,
        media: {
          images: { supported: false, formats: [] },
          audio: { supported: false, formats: [] },
          files: { supported: false, formats: [], uploadMethod: 'none' },
          urls: { supported: false, webSearch: false, contextFetching: false },
        },
        caching: { supported: false, types: [] },
        thinking: false,
        multiTurn: false,
      }),
    });

    const features = llm.getFeatures('any-model');
    expect(features.functions).toBe(false);
    expect(features.streaming).toBe(false);
  });
});
