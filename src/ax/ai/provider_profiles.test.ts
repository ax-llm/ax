import { describe, expect, it, vi } from 'vitest';
import {
  axAIProfiles,
  axGetAIProfile,
  axResolveAIProfileFeatures,
  axResolveAIProfileId,
} from './provider_profiles.js';
import { ai } from './wrap.js';

type Capture = {
  url?: string;
  headers?: Headers;
  body?: Record<string, unknown>;
};

const createMockFetch = (capture: Capture) =>
  vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    capture.url = String(url);
    capture.headers = new Headers(init?.headers);
    if (typeof init?.body === 'string') capture.body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-profile',
        model: capture.body?.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

describe('named AI deployment profiles', () => {
  it('publishes the fixed profile catalog with unique aliases and sources', () => {
    const profiles = axAIProfiles();
    expect(profiles).toHaveLength(46);
    expect(new Set(profiles.map((profile) => profile.id)).size).toBe(
      profiles.length
    );
    expect(profiles.every((profile) => profile.sources.length > 0)).toBe(true);
    expect(
      profiles.every((profile) =>
        /^\d{4}-\d{2}-\d{2}$/.test(profile.reviewedAt)
      )
    ).toBe(true);
    expect(axGetAIProfile('together').reviewedAt).toBe('2026-08-18');
  });

  it('keeps official OpenAI separate from conservative compatibility', () => {
    expect(axResolveAIProfileId('openai')).toBe('openai');
    expect(axGetAIProfile('openai').baseURL).toBe('https://api.openai.com/v1');
    expect(axGetAIProfile('openai-compatible').baseURL).toBeUndefined();
    expect(
      axGetAIProfile('openai-compatible').capabilities.structuredOutputs
    ).toBe(false);
  });

  it('publishes verified portable tiers for every named profile', () => {
    const expected = new Map<string, readonly string[]>([
      ['openai', ['standard', 'flex', 'priority']],
      ['openai-responses', ['standard', 'flex', 'priority']],
      ['google-gemini', ['standard', 'flex', 'priority']],
      ['azure-openai', ['standard', 'priority']],
      ['azure-foundry', ['standard', 'priority']],
      ['amazon-bedrock', ['standard', 'flex', 'priority']],
      ['mistral', ['standard', 'priority']],
      ['groq', ['standard', 'flex', 'priority']],
      ['openrouter', ['standard', 'flex', 'priority']],
      ['deepinfra', ['standard', 'priority']],
      ['cerebras', ['standard', 'flex', 'priority']],
      ['grok', ['standard', 'priority']],
      ['databricks', ['standard', 'priority']],
      ['fireworks', ['standard', 'priority']],
    ]);

    for (const profile of axAIProfiles()) {
      expect(profile.capabilities.serviceTiers ?? []).toEqual(
        expected.get(profile.id) ?? []
      );
    }
  });

  it('maps standard tier through every OpenAI-compatible named profile', async () => {
    const cases = [
      ['openai', 'default'],
      ['azure-openai', 'default'],
      ['azure-foundry', 'default'],
      ['amazon-bedrock', 'default'],
      ['mistral', 'standard_only'],
      ['groq', 'on_demand'],
      ['openrouter', undefined],
      ['deepinfra', undefined],
      ['cerebras', 'default'],
      ['grok', 'default'],
      ['databricks', 'default'],
      ['fireworks', 'default'],
    ] as const;

    for (const [name, expectedWireTier] of cases) {
      const capture: Capture = {};
      const profile = axGetAIProfile(name);
      const service = ai({
        name,
        apiKey: 'key',
        apiURL: profile.baseURL ?? 'https://profile.test/v1',
        config: { model: profile.defaultModel ?? 'test-model', stream: false },
        options: { fetch: createMockFetch(capture) },
      });
      await service.chat(
        { chatPrompt: [{ role: 'user', content: 'ping' }] },
        { serviceTier: 'standard' }
      );
      expect(capture.body?.service_tier, name).toBe(expectedWireTier);
    }
  });

  it('maps and reports tiers through the OpenAI Responses profile', async () => {
    const capture: Capture = {};
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') capture.body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: 'resp-tier',
          object: 'response',
          created: 1,
          model: 'gpt-5-mini',
          service_tier: 'priority',
          output: [
            {
              id: 'msg-tier',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'ok', annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const service = ai({
      name: 'openai-responses',
      apiKey: 'key',
      config: { model: 'gpt-5-mini', stream: false },
      options: { fetch },
    });

    const response = await service.chat(
      { chatPrompt: [{ role: 'user', content: 'ping' }] },
      { serviceTier: 'priority' }
    );

    expect(capture.body?.service_tier).toBe('priority');
    if (response instanceof ReadableStream) {
      throw new Error('Expected a non-streaming response');
    }
    expect(response.modelUsage?.tokens?.serviceTier).toBe('priority');
  });

  it('fails before transport for an unsupported explicit tier', async () => {
    const fetch = vi.fn();
    const service = ai({
      name: 'anthropic',
      apiKey: 'key',
      config: { model: 'claude-sonnet-4-5', stream: false },
      options: { fetch },
    });

    await expect(
      service.chat(
        { chatPrompt: [{ role: 'user', content: 'ping' }] },
        { serviceTier: 'priority' }
      )
    ).rejects.toThrow('not verified');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unverified DeepInfra flex tier before transport', async () => {
    const fetch = vi.fn();
    const service = ai({
      name: 'deepinfra',
      apiKey: 'key',
      config: { model: 'deepseek-ai/DeepSeek-R1', stream: false },
      options: { fetch },
    });

    await expect(
      service.chat(
        { chatPrompt: [{ role: 'user', content: 'ping' }] },
        { serviceTier: 'flex' }
      )
    ).rejects.toThrow('not verified');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows an exact modelInfo tier opt-in on a conservative profile', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'openai-compatible',
      apiURL: 'https://compatible.test/v1',
      config: { model: 'custom-flex', stream: false },
      modelInfo: [
        {
          name: 'custom-flex',
          provider: 'openai-compatible',
          supported: { serviceTiers: ['flex'] },
        },
      ],
      options: { fetch: createMockFetch(capture) },
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'ping' }] },
      { serviceTier: 'flex' }
    );
    expect(capture.body?.service_tier).toBe('flex');
  });

  it('resolves OrcaRouter as a named OpenAI-compatible gateway', async () => {
    const profile = axGetAIProfile('orcarouter');
    expect(axResolveAIProfileId('orcarouter')).toBe('orcarouter');
    expect(profile.baseURL).toBe('https://api.orcarouter.ai/v1');
    expect(profile.authentication.required).toBe(true);
    expect(profile.defaultModel).toBe('orcarouter/auto');
    expect(profile.capabilities.functions).toBe(true);
    expect(profile.capabilities.structuredOutputs).toBe(false);

    const capture: Capture = {};
    const service = ai({
      name: 'orcarouter',
      apiKey: 'key',
      config: { model: 'orcarouter/auto', stream: false },
      options: { fetch: createMockFetch(capture) },
    });
    await service.chat({
      chatPrompt: [{ role: 'user', content: 'ping' }],
    });
    expect(capture.url).toBe('https://api.orcarouter.ai/v1/chat/completions');
    expect(capture.headers?.has('authorization')).toBe(true);
  });

  it('rejects unknown names instead of silently selecting OpenAI compatibility', () => {
    expect(() => axResolveAIProfileId('togethre')).toThrow(
      'Unknown AI profile "togethre"'
    );
  });

  it('runs a simple compatibility-only provider without a provider class', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'reka',
      apiKey: 'key',
      config: { model: 'reka-flash', stream: false },
      options: { fetch: createMockFetch(capture) },
    });

    const response = await service.chat({
      chatPrompt: [{ role: 'user', content: 'hi' }],
    });

    expect(response).not.toBeInstanceOf(ReadableStream);
    expect(capture.url).toBe('https://api.reka.ai/v1/chat/completions');
    expect(capture.body?.model).toBe('reka-flash');
  });

  it('applies native DeepSeek rules only in the DeepSeek profile', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'deepseek',
      apiKey: 'key',
      config: { model: 'deepseek-v4-flash', stream: false },
      options: { fetch: createMockFetch(capture) },
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'think' }] },
      { stream: false, thinkingTokenBudget: 'low' }
    );

    expect(capture.body?.thinking).toEqual({ type: 'enabled' });
    expect(capture.body?.reasoning_effort).toBe('low');
    expect(capture.body).not.toHaveProperty('temperature');
  });

  it('defaults verified DeepSeek V4 deployment rules to maximum thinking', async () => {
    const cases = [
      {
        name: 'deepseek',
        model: 'deepseek-v4-flash',
        expectedReasoning: undefined,
        expectedEffort: 'max',
        expectedThinking: { type: 'enabled' },
      },
      {
        name: 'together',
        model: 'deepseek-ai/DeepSeek-V4-Pro',
        expectedReasoning: undefined,
        expectedEffort: 'max',
        expectedThinking: undefined,
      },
      {
        name: 'fireworks',
        model: 'accounts/fireworks/models/deepseek-v4',
        expectedReasoning: undefined,
        expectedEffort: 'max',
        expectedThinking: undefined,
      },
      {
        name: 'openrouter',
        model: 'deepseek/deepseek-v4',
        expectedReasoning: { effort: 'max' },
        expectedEffort: undefined,
        expectedThinking: undefined,
      },
    ] as const;

    for (const testCase of cases) {
      const capture: Capture = {};
      const service = ai({
        name: testCase.name,
        apiKey: 'key',
        config: { model: testCase.model, stream: false },
        options: { fetch: createMockFetch(capture) },
      });

      await service.chat({ chatPrompt: [{ role: 'user', content: 'think' }] });

      expect(capture.body?.reasoning_effort).toEqual(testCase.expectedEffort);
      expect(capture.body?.reasoning).toEqual(testCase.expectedReasoning);
      expect(capture.body?.thinking).toEqual(testCase.expectedThinking);
    }
  });

  it('lets an explicit none disable profile default thinking levels', async () => {
    const cases = [
      {
        name: 'deepseek',
        model: 'deepseek-v4-pro',
        expectedReasoning: undefined,
        expectedEffort: undefined,
        expectedThinking: { type: 'disabled' },
      },
      {
        name: 'together',
        model: 'deepseek-ai/DeepSeek-V4-Pro',
        expectedReasoning: undefined,
        expectedEffort: undefined,
        expectedThinking: undefined,
      },
      {
        name: 'fireworks',
        model: 'accounts/fireworks/models/deepseek-v4',
        expectedReasoning: undefined,
        expectedEffort: 'none',
        expectedThinking: undefined,
      },
      {
        name: 'openrouter',
        model: 'deepseek/deepseek-v4',
        expectedReasoning: { effort: 'none' },
        expectedEffort: undefined,
        expectedThinking: undefined,
      },
    ] as const;

    for (const testCase of cases) {
      const capture: Capture = {};
      const service = ai({
        name: testCase.name,
        apiKey: 'key',
        config: { model: testCase.model, stream: false },
        options: { fetch: createMockFetch(capture) },
      });

      await service.chat(
        { chatPrompt: [{ role: 'user', content: 'answer directly' }] },
        { thinkingTokenBudget: 'none' }
      );

      expect(capture.body?.reasoning_effort).toEqual(testCase.expectedEffort);
      expect(capture.body?.reasoning).toEqual(testCase.expectedReasoning);
      expect(capture.body?.thinking).toEqual(testCase.expectedThinking);
    }
  });

  it('uses Together rules for a Together-hosted DeepSeek model', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'together',
      apiKey: 'key',
      config: {
        model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
        stream: false,
      },
      options: { fetch: createMockFetch(capture) },
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'think' }] },
      { stream: false, thinkingTokenBudget: 'medium' }
    );

    expect(capture.url).toBe('https://api.together.xyz/v1/chat/completions');
    expect(capture.body?.reasoning_effort).toBe('high');
    expect(capture.body).not.toHaveProperty('thinking');
  });

  it('replays Together reasoning with Together fields', async () => {
    const capture: Capture = {};
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capture.url = String(url);
      if (typeof init?.body === 'string') capture.body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-together-reasoning',
          model: 'deepseek-ai/DeepSeek-V4-Pro',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Use the lookup.',
                reasoning: 'Check the inventory first.',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const service = ai({
      name: 'together',
      apiKey: 'key',
      config: { model: 'deepseek-ai/DeepSeek-V4-Pro', stream: false },
      options: { fetch },
    });

    const first = await service.chat(
      { chatPrompt: [{ role: 'user', content: 'Plan the lookup.' }] },
      { thinkingTokenBudget: 'low' }
    );
    if (first instanceof ReadableStream) {
      throw new Error('expected a non-streaming response');
    }
    expect(first.results[0]?.thought).toBe('Check the inventory first.');

    await service.chat({
      chatPrompt: [
        { role: 'user', content: 'Plan the lookup.' },
        {
          role: 'assistant',
          content: 'Use the lookup.',
          thought: first.results[0]?.thought,
        },
        { role: 'user', content: 'Continue.' },
      ],
    });

    expect(
      (capture.body?.messages as Record<string, unknown>[])[1]
    ).toMatchObject({
      content: 'Use the lookup.',
      reasoning: 'Check the inventory first.',
      role: 'assistant',
    });
    expect(
      (capture.body?.messages as Record<string, unknown>[])[1]
    ).not.toHaveProperty('reasoning_content');
  });

  it('uses OpenRouter reasoning objects and extracts its reasoning field', async () => {
    const capture: Capture = {};
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capture.url = String(url);
      if (typeof init?.body === 'string') capture.body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-openrouter',
          model: 'deepseek/deepseek-v4',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'ok',
                reasoning: 'route thought',
                reasoning_details: [
                  {
                    type: 'reasoning.summary',
                    summary: 'route summary',
                    id: 'reasoning-1',
                    format: 'unknown',
                  },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const service = ai({
      name: 'openrouter',
      apiKey: 'key',
      config: { model: 'deepseek/deepseek-v4', stream: false },
      options: { fetch },
    });

    const response = await service.chat(
      { chatPrompt: [{ role: 'user', content: 'think' }] },
      { thinkingTokenBudget: 'high' }
    );

    expect(capture.body?.reasoning).toEqual({ effort: 'high' });
    expect(capture.body).not.toHaveProperty('reasoning_effort');
    if (response instanceof ReadableStream) {
      throw new Error('expected a non-streaming response');
    }
    expect(response.results[0]?.thought).toBe('route thought');
    expect(response.results[0]?.thoughtBlocks?.[0]?.data).toContain(
      'reasoning.summary'
    );

    await service.chat({
      chatPrompt: [
        { role: 'user', content: 'think' },
        {
          role: 'assistant',
          content: 'ok',
          thought: response.results[0]?.thought,
          thoughtBlocks: response.results[0]?.thoughtBlocks,
        },
        { role: 'user', content: 'continue' },
      ],
    });
    expect(
      (
        (capture.body?.messages as Record<string, unknown>[])[1]
          ?.reasoning_details as unknown[]
      )[0]
    ).toMatchObject({ id: 'reasoning-1', type: 'reasoning.summary' });
  });

  it('uses Fireworks model rules without native DeepSeek payload fields', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'fireworks',
      apiKey: 'key',
      config: {
        model: 'accounts/fireworks/models/deepseek-v4',
        stream: false,
      },
      options: { fetch: createMockFetch(capture) },
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'think' }] },
      { thinkingTokenBudget: 'low' }
    );

    expect(capture.body?.reasoning_effort).toBe('high');
    expect(capture.body).not.toHaveProperty('thinking');
  });

  it('keeps profile model matching scoped to the selected deployment', () => {
    expect(
      axResolveAIProfileFeatures(
        'together',
        'deepseek-ai/DeepSeek-V4-Flash-0731'
      ).thinking
    ).toBe(true);
    expect(
      axResolveAIProfileFeatures(
        'openai-compatible',
        'deepseek-ai/DeepSeek-V4-Flash-0731'
      ).thinking
    ).toBe(false);
  });

  it('resolves Vertex structured-output modes per model', () => {
    expect(
      axResolveAIProfileFeatures('vertex-ai', 'unknown-third-party-model')
        .structuredOutputModes
    ).toEqual(['function']);
    expect(
      axResolveAIProfileFeatures('vertex-ai', 'google/gemini-3.5-flash')
        .structuredOutputModes
    ).toEqual(['native', 'function', 'json_object']);
    expect(
      axResolveAIProfileFeatures('vertex-ai', 'google/gemma-4-26b-a4b-it-maas')
        .structuredOutputModes
    ).toEqual(['json_object', 'function']);
  });

  it('applies Vertex Gemma MaaS thinking defaults and explicit disable', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'vertex-ai',
      apiKey: 'vertex-token',
      apiURL: 'https://vertex.test/v1',
      config: {
        model: 'google/gemma-4-26b-a4b-it-maas',
        stream: false,
      },
      options: { fetch: createMockFetch(capture) },
    });

    await service.chat({
      chatPrompt: [{ role: 'user', content: 'think' }],
      responseFormat: { type: 'json_object' },
    });
    expect(capture.body?.chat_template_kwargs).toEqual({
      enable_thinking: true,
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'answer directly' }] },
      { thinkingTokenBudget: 'none' }
    );
    expect(capture.body?.chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
  });

  it('renews credentials for every attempt and lets fresh headers override static auth', async () => {
    const headers: Headers[] = [];
    let calls = 0;
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'retry' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          id: 'renewed',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    let token = 0;
    const credentialRequests: Record<string, unknown>[] = [];
    const service = ai({
      name: 'vertex-ai',
      apiKey: 'stale-token',
      apiURL: 'https://vertex.test/v1',
      config: { model: 'google/gemini-3.5-flash', stream: false },
      credentialProvider: async (request) => {
        credentialRequests.push(request);
        token++;
        return { Authorization: `Bearer fresh-${token}` };
      },
      options: { fetch },
    });

    await service.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { retry: { initialDelayMs: 0 } }
    );

    expect(headers.map((value) => value.get('authorization'))).toEqual([
      'Bearer fresh-1',
      'Bearer fresh-2',
    ]);
    expect(credentialRequests).toEqual([
      {
        profile: 'vertex-ai',
        operation: 'chat',
        method: 'POST',
        url: 'https://vertex.test/v1/chat/completions',
      },
      {
        profile: 'vertex-ai',
        operation: 'chat',
        method: 'POST',
        url: 'https://vertex.test/v1/chat/completions',
      },
    ]);
  });

  it('identifies Responses API credential requests by operation', async () => {
    const credentialRequests: Record<string, unknown>[] = [];
    const service = ai({
      name: 'openai-responses',
      config: { model: 'gpt-5-mini', stream: false },
      credentialProvider: async (request) => {
        credentialRequests.push(request);
        return { Authorization: 'Bearer fresh-token' };
      },
      options: {
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                id: 'resp-renewed',
                object: 'response',
                model: 'gpt-5-mini',
                output: [
                  {
                    type: 'message',
                    id: 'msg-renewed',
                    role: 'assistant',
                    status: 'completed',
                    content: [
                      { type: 'output_text', text: 'ok', annotations: [] },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 1,
                  output_tokens: 1,
                  total_tokens: 2,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        ),
      },
    });

    await service.chat({ chatPrompt: [{ role: 'user', content: 'hello' }] });

    expect(credentialRequests).toEqual([
      {
        profile: 'openai-responses',
        operation: 'responses',
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
      },
    ]);
  });

  it('aborts credential-provider failures before transport', async () => {
    const fetch = vi.fn();
    const service = ai({
      name: 'vertex-ai',
      apiURL: 'https://vertex.test/v1',
      config: { model: 'google/gemini-3.5-flash', stream: false },
      credentialProvider: async () => {
        throw new Error('credential refresh failed');
      },
      options: { fetch },
    });

    await expect(
      service.chat({ chatPrompt: [{ role: 'user', content: 'hello' }] })
    ).rejects.toThrow('credential refresh failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not retry a completed 401 after credential refresh', async () => {
    let credentialCalls = 0;
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'bad fresh token' } }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    const service = ai({
      name: 'vertex-ai',
      apiURL: 'https://vertex.test/v1',
      config: { model: 'google/gemini-3.5-flash', stream: false },
      credentialProvider: async () => {
        credentialCalls++;
        return { Authorization: 'Bearer rejected-fresh-token' };
      },
      options: { fetch },
    });

    await expect(
      service.chat(
        { chatPrompt: [{ role: 'user', content: 'hello' }] },
        { retry: { initialDelayMs: 0, maxRetries: 3 } }
      )
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(credentialCalls).toBe(1);
  });

  it('applies exact caller modelInfo before profile model rules and defaults', () => {
    const service = ai({
      name: 'openai-compatible',
      apiURL: 'https://profile.test/v1',
      config: { model: 'custom-reasoner', stream: false },
      modelInfo: [
        {
          name: 'custom-reasoner',
          supported: {
            thinkingBudget: true,
            showThoughts: true,
            structuredOutputs: true,
          },
        },
      ],
    });

    expect(service.getFeatures('custom-reasoner')).toMatchObject({
      thinking: true,
      hasThinkingBudget: true,
      hasShowThoughts: true,
      structuredOutputs: true,
    });
    expect(service.getFeatures('another-model')).toMatchObject({
      thinking: false,
      structuredOutputs: false,
    });
  });

  it('fails explicitly requested unverified features before sending', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'openai-compatible',
      apiURL: 'https://profile.test/v1',
      config: { model: 'unknown-model', stream: false },
      options: { fetch: createMockFetch(capture) },
    });

    await expect(
      service.chat(
        { chatPrompt: [{ role: 'user', content: 'think' }] },
        { thinkingTokenBudget: 'high' }
      )
    ).rejects.toThrow('Thinking is not verified');
    await expect(
      service.chat({
        chatPrompt: [{ role: 'user', content: 'json' }],
        responseFormat: {
          type: 'json_schema',
          schema: { type: 'object' },
        },
      })
    ).rejects.toThrow('Structured output is not verified');
    expect(capture.url).toBeUndefined();
  });

  it('defaults verified top-provider reasoning models to their strongest effort', async () => {
    const cases = [
      { name: 'grok', model: 'grok-4.6', expectedEffort: 'xhigh' },
      { name: 'grok', model: 'grok-4.5', expectedEffort: 'high' },
      { name: 'groq', model: 'openai/gpt-oss-120b', expectedEffort: 'high' },
      { name: 'groq', model: 'qwen/qwen3.6-27b', expectedEffort: 'default' },
      { name: 'cerebras', model: 'gpt-oss-120b', expectedEffort: 'high' },
      { name: 'cerebras', model: 'gemma-4-31b', expectedEffort: 'high' },
      {
        name: 'deepinfra',
        model: 'deepseek-ai/DeepSeek-R1-0528',
        expectedEffort: 'high',
      },
    ] as const;

    for (const testCase of cases) {
      const capture: Capture = {};
      const service = ai({
        name: testCase.name,
        apiKey: 'key',
        config: { model: testCase.model, stream: false },
        options: { fetch: createMockFetch(capture) },
      });

      await service.chat({ chatPrompt: [{ role: 'user', content: 'think' }] });

      expect(capture.body?.reasoning_effort).toBe(testCase.expectedEffort);
    }
  });

  it('preserves explicit none only where the deployment documents it', async () => {
    const supported = [
      { name: 'groq', model: 'qwen/qwen3.6-27b' },
      { name: 'cerebras', model: 'gemma-4-31b' },
      { name: 'deepinfra', model: 'deepseek-ai/DeepSeek-R1' },
    ] as const;

    for (const testCase of supported) {
      const capture: Capture = {};
      const service = ai({
        name: testCase.name,
        apiKey: 'key',
        config: { model: testCase.model, stream: false },
        options: { fetch: createMockFetch(capture) },
      });

      await service.chat(
        { chatPrompt: [{ role: 'user', content: 'answer directly' }] },
        { thinkingTokenBudget: 'none' }
      );

      expect(capture.body?.reasoning_effort).toBe('none');
    }

    const unsupported = [
      { name: 'grok', model: 'grok-4.6' },
      { name: 'grok', model: 'grok-4.5' },
      { name: 'groq', model: 'openai/gpt-oss-120b' },
      { name: 'cerebras', model: 'gpt-oss-120b' },
    ] as const;

    for (const testCase of unsupported) {
      const fetch = createMockFetch({});
      const service = ai({
        name: testCase.name,
        apiKey: 'key',
        config: { model: testCase.model, stream: false },
        options: { fetch },
      });

      await expect(
        service.chat(
          { chatPrompt: [{ role: 'user', content: 'answer directly' }] },
          { thinkingTokenBudget: 'none' }
        )
      ).rejects.toThrow(/does not support|cannot be disabled/);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('keeps Hugging Face router reasoning conservative across dynamic routes', () => {
    expect(
      axResolveAIProfileFeatures(
        'huggingface-router',
        'deepseek-ai/DeepSeek-R1:fastest'
      ).thinking
    ).toBe(false);
  });

  it('maps search options through the Grok operation dialect', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'grok',
      apiKey: 'key',
      config: { model: 'grok-4.3', stream: false },
      options: {
        fetch: createMockFetch(capture),
        searchParameters: {
          returnCitations: true,
          sources: [{ type: 'web', safeSearch: true }],
        },
      },
    });

    await service.chat({ chatPrompt: [{ role: 'user', content: 'news' }] });

    expect(capture.body?.search_parameters).toEqual({
      return_citations: true,
      sources: [{ type: 'web', safe_search: true }],
    });
  });

  for (const profile of axAIProfiles()) {
    it(`resolves ${profile.id} endpoint, auth, operations, and capabilities`, async () => {
      expect(axResolveAIProfileId(profile.id)).toBe(profile.id);
      expect(profile.operations).not.toEqual({});
      expect(
        [profile.baseURL, profile.requiresApiURL, profile.endpoint].filter(
          Boolean
        )
      ).toHaveLength(profile.transport === 'webllm' ? 0 : 1);

      if (profile.transport !== 'openai-chat') return;
      const capture: Capture = {};
      const apiURL =
        profile.requiresApiURL || profile.endpoint
          ? 'https://profile.test/v1'
          : profile.baseURL;
      const service = ai({
        name: profile.id,
        ...(profile.authentication.required ? { apiKey: 'profile-key' } : {}),
        ...(apiURL ? { apiURL } : {}),
        config: { model: profile.defaultModel ?? 'test-model', stream: false },
        options: { fetch: createMockFetch(capture) },
      });
      await service.chat({ chatPrompt: [{ role: 'user', content: 'ping' }] });

      expect(capture.url).toBe(
        `${apiURL!.replace(/\/$/, '')}${profile.operations.chat!.path}`
      );
      if (profile.authentication.required) {
        const expectedHeader =
          profile.authentication.type === 'api-key-header'
            ? (profile.authentication.header ?? 'api-key')
            : profile.authentication.type === 'x-api-key'
              ? 'x-api-key'
              : 'authorization';
        expect(capture.headers?.has(expectedHeader)).toBe(true);
      }
      expect(
        service.getFeatures(profile.defaultModel ?? 'test-model').functions
      ).toBe(profile.capabilities.functions);
    });
  }

  it('demotes Ax-generated forced output tools but rejects caller-forced tools', async () => {
    const capture: Capture = {};
    const service = ai({
      name: 'deepseek',
      apiKey: 'key',
      config: { model: 'deepseek-v4-flash', stream: false },
      options: { fetch: createMockFetch(capture) },
    });
    const request = {
      chatPrompt: [{ role: 'user' as const, content: 'return output' }],
      functions: [
        { name: '__axOutput', description: 'output', parameters: {} },
      ],
      functionCall: {
        type: 'function' as const,
        function: { name: '__axOutput' },
      },
    };

    await service.chat(request, { functionCallSource: 'ax' });
    expect(capture.body).not.toHaveProperty('tool_choice');
    await expect(
      service.chat(
        {
          ...request,
          functions: [{ name: 'lookup', description: 'lookup' }],
          functionCall: {
            type: 'function',
            function: { name: 'lookup' },
          },
        },
        { functionCallSource: 'caller' }
      )
    ).rejects.toThrow('does not support explicitly forced tool choices');
  });
});
