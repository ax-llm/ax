// cspell:ignore noul jev
import { describe, expect, it, vi } from 'vitest';
import { ax } from '../../dsp/template.js';
import {
  AxAIServiceNetworkError,
  AxMediaNotSupportedError,
} from '../../util/apicall.js';
import { AxBalancer } from '../balance.js';
import {
  axAnalyzeRequestRequirements,
  axGetCompatibilityReport,
  axSelectOptimalProvider,
  axValidateProviderCapabilities,
} from '../capabilities.js';
import { AxMockAIService } from '../mock/api.js';
import { AxProviderRouter } from '../router.js';
import type { AxChatRequest } from '../types.js';
import { ai } from '../wrap.js';

const plain: AxChatRequest = {
  chatPrompt: [{ role: 'user', content: 'Help' }],
};
const schemaRequest = (field: object, required = true): AxChatRequest => ({
  ...plain,
  responseFormat: {
    type: 'json_schema',
    schema: {
      name: 'output',
      schema: {
        type: 'object',
        properties: { answer: field },
        required: required ? ['answer'] : [],
        additionalProperties: false,
      },
    },
  },
});
const typesafeProvider = () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: 'jev-latest',
          answers: { answer: { type: 'noul', noul: 0.9 } },
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  return {
    provider: ai({ name: 'typesafe', apiKey: 'key', options: { fetch } }),
    fetch,
  };
};
const generativeProvider = (structuredOutputs = true) => {
  const provider = new AxMockAIService<string>({
    name: 'generative',
    models: [],
    features: { streaming: false, functions: true, structuredOutputs },
  });
  provider.chat = vi.fn(async () => ({
    results: [
      { index: 0, content: 'Reply: Hello', finishReason: 'stop' as const },
    ],
  }));
  return provider;
};

describe('Typesafe request compatibility', () => {
  it.each([
    plain,
    schemaRequest({ type: 'string' }),
    schemaRequest({ type: 'number', minimum: 0, maximum: 100 }),
    schemaRequest({ type: 'object', properties: {} }),
    schemaRequest({ type: 'array', items: { type: 'boolean' } }),
    schemaRequest({ type: 'boolean' }, false),
  ])(
    'excludes incompatible request %# even when degradation is enabled',
    (request) => {
      const { provider, fetch } = typesafeProvider();
      const fallback = generativeProvider();
      expect(
        axSelectOptimalProvider(request, [provider, fallback], {
          allowDegradation: true,
        })
      ).toBe(fallback);
      expect(() =>
        axSelectOptimalProvider(request, [provider], { allowDegradation: true })
      ).toThrow('No providers support');
      expect(
        axValidateProviderCapabilities(
          provider,
          axAnalyzeRequestRequirements(request),
          request
        ).isSupported
      ).toBe(false);
      const report = axGetCompatibilityReport(request, [provider]);
      expect(report.recommendedProvider).toBeNull();
      expect(
        report.providerScores[0]!.missingCapabilities.length
      ).toBeGreaterThan(0);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('preserves the unsupported field in selection errors', () => {
    const { provider } = typesafeProvider();
    expect(() =>
      axSelectOptimalProvider(schemaRequest({ type: 'number' }), [provider])
    ).toThrow('cannot evaluate output "answer"');
  });

  it.each([{ type: 'boolean' }, { type: 'string', enum: ['yes', 'no'] }])(
    'accepts supported schema %j',
    (field) => {
      const { provider, fetch } = typesafeProvider();
      expect(
        axSelectOptimalProvider(schemaRequest(field), [provider], {
          requireExactMatch: true,
        })
      ).toBe(provider);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('validates model aliases without credentials, network calls, mutations, or metrics', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'custom-model',
            answers: { answer: { type: 'noul', noul: 0.9 } },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
    );
    const credentialProvider = vi.fn(async () => ({
      Authorization: 'Bearer key',
    }));
    const provider = ai({
      name: 'typesafe',
      credentialProvider,
      models: [
        { key: 'valid', model: 'custom-model' },
        {
          key: 'invalid',
          model: 'custom-model',
          modelConfig: { temperature: 0.5 },
        },
      ],
      options: { fetch },
    });
    const request = { ...schemaRequest({ type: 'boolean' }), model: 'valid' };
    const original = structuredClone(request);
    const metrics = provider.getMetrics();
    provider.validateChatRequest(request);
    expect(() =>
      provider.validateChatRequest({ ...request, model: 'invalid' })
    ).toThrow('temperature');
    expect(request).toEqual(original);
    expect(provider.getMetrics()).toEqual(metrics);
    expect(provider.getLastUsedChatModel()).toBeUndefined();
    expect(credentialProvider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await provider.chat(request);
    expect(
      JSON.parse(
        (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
          .body as string
      ).model
    ).toBe('custom-model');
  });

  it('supports ordinary signatures through a Typesafe-only balancer', async () => {
    const { provider, fetch } = typesafeProvider();
    const balanced = new AxBalancer([provider], { debug: false });
    expect(balanced.getFeatures().requiresStructuredOutput).toBe(true);
    expect(
      await ax('ticket:string -> answer:boolean').forward(balanced, {
        ticket: 'Help',
      })
    ).toEqual({ answer: true });
    await expect(
      ax('ticket:string -> answer:number(min 0, max 100)').forward(balanced, {
        ticket: 'Help',
      })
    ).rejects.toThrow('cannot evaluate output "answer"');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps mixed pools compatible with generative providers without native JSON schemas', async () => {
    const { provider, fetch } = typesafeProvider();
    const generative = generativeProvider(false);
    const balanced = new AxBalancer([provider, generative], {
      debug: false,
      comparator: AxBalancer.inputOrderComparator,
    });
    expect(balanced.getFeatures().requiresStructuredOutput).not.toBe(true);
    expect(
      await ax('ticket:string -> reply:string').forward(balanced, {
        ticket: 'Help',
      })
    ).toEqual({ reply: 'Hello' });
    expect(fetch).not.toHaveBeenCalled();
    expect(generative.chat).toHaveBeenCalledWith(
      expect.not.objectContaining({ responseFormat: expect.anything() }),
      expect.anything()
    );
    await balanced.chat(schemaRequest({ type: 'boolean' }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'filters incompatible candidates before ranking/fallback (adaptive=%s)',
    async (adaptive) => {
      const { provider, fetch } = typesafeProvider();
      const first = generativeProvider();
      const last = generativeProvider();
      first.chat = vi.fn(async () => {
        throw new AxAIServiceNetworkError(
          new Error('offline'),
          'https://test',
          plain
        );
      });
      const balanced = new AxBalancer([first, provider, last], {
        comparator: AxBalancer.inputOrderComparator,
        debug: false,
        ...(adaptive
          ? {
              strategy: {
                type: 'adaptive' as const,
                deadlineMs: 1000,
                badOutcomeCost: 1,
                namespace: 'typesafe-test',
                routeKey: (_service: unknown, index: number) => String(index),
              },
            }
          : {}),
      });
      await balanced.chat(plain);
      expect(fetch).not.toHaveBeenCalled();
      expect(last.chat).toHaveBeenCalledTimes(1);
    }
  );

  it('checks the actual request during router selection and explicit fallback', async () => {
    const { provider, fetch } = typesafeProvider();
    const generative = generativeProvider();
    const router = new AxProviderRouter({
      providers: { primary: provider, alternatives: [generative] },
      routing: {
        preferenceOrder: ['capability'],
        capability: { requireExactMatch: false, allowDegradation: true },
      },
      processing: {},
    });
    expect((await router.chat(plain)).routing.provider).toBe(generative);
    generative.chat = vi.fn(async () => {
      throw new AxMediaNotSupportedError('test', 'generative');
    });
    const fallback = generativeProvider();
    const result = await router.chat(plain, {
      fallbackProviders: [provider, fallback],
    });
    expect(result.routing.provider).toBe(fallback);
    expect(fetch).not.toHaveBeenCalled();
    expect(fallback.chat).toHaveBeenCalledTimes(1);
  });
});
