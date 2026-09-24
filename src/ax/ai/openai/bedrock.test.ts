import { describe, expect, it, vi } from 'vitest';
import { getModelInfo } from '../../dsp/modelinfo.js';
import { ai } from '../wrap.js';
import { AxAIOpenAI } from './api.js';
import type { AxAIOpenAIModel } from './chat_types.js';
import { axResolveOpenAIResponsesReasoningEffort } from './effort.js';
import { axModelInfoOpenAI, axModelInfoOpenAIResponses } from './info.js';
import {
  axIsGPT6Astra,
  axIsGPT6Family,
  axIsGPT56Family,
  axSupportsOpenAIBreakpointCaching,
  axSupportsOpenAIChatSessions,
} from './model_family.js';
import type { AxAIOpenAIResponsesModel } from './responses_types.js';

// Amazon Bedrock names OpenAI models `openai.<model>` on bedrock-mantle and
// names cross-Region inference profiles `<geography>.openai.<model>` on
// bedrock-runtime.
const runtime = 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1';
const mantle = 'https://bedrock-mantle.us-west-2.api.aws/openai/v1';

const response = (model: string) =>
  Response.json({
    id: 'r1',
    object: 'response',
    model,
    output: [
      {
        type: 'message',
        id: 'm1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'ok', annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });

const completion = (model: string) =>
  Response.json({
    id: 'c1',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

/** A fetch spy that answers every request with `reply` and keeps the calls. */
const spy = (reply: (model: string) => Response) =>
  vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    reply(JSON.parse(String(init?.body)).model)
  );

const sent = (fetch: ReturnType<typeof spy>) =>
  fetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String(init?.body)),
  }));

describe('Bedrock OpenAI model IDs', () => {
  it('belong to the family their OpenAI name does', () => {
    for (const model of [
      'openai.gpt-6-sol',
      'us.openai.gpt-6-luna',
      'global.openai.gpt-6-sol',
      'us-gov.openai.gpt-6-luna',
      // Geographies are matched by shape, so a future profile still resolves.
      'eu.openai.gpt-6-sol',
    ]) {
      expect(axIsGPT6Family(model)).toBe(true);
      expect(axIsGPT6Astra(model)).toBe(false);
    }
    for (const model of [
      'openai.gpt-6-astra',
      'us.openai.gpt-6-astra',
      'global.openai.gpt-6-astra',
    ]) {
      expect(axIsGPT6Family(model)).toBe(true);
      expect(axIsGPT6Astra(model)).toBe(true);
    }
    for (const model of [
      'openai.gpt-5.6-sol',
      'us.openai.gpt-5.6-terra',
      'global.openai.gpt-5.6-luna',
    ]) {
      expect(axIsGPT56Family(model)).toBe(true);
    }
    for (const model of [
      'openai.gpt-oss-120b-1:0',
      'us.anthropic.gpt-6-sol',
      'openai/gpt-6-sol',
      'us..openai.gpt-6-sol',
      'us.openai.gpt-6',
    ]) {
      expect(axIsGPT6Family(model)).toBe(false);
    }
  });

  it('keep off the OpenAI platform features Bedrock does not serve', () => {
    // Bedrock serves prompt caching on the Responses API only, and has no
    // async tools, steering or reasoning updates, so no chat sessions either.
    for (const model of ['us.openai.gpt-6-sol', 'openai.gpt-5.6-sol']) {
      expect(axSupportsOpenAIBreakpointCaching(model)).toBe(false);
    }
    for (const model of ['us.openai.gpt-6-astra', 'openai.gpt-6-astra']) {
      expect(axSupportsOpenAIChatSessions(model)).toBe(false);
    }
    expect(axSupportsOpenAIBreakpointCaching('gpt-6-sol')).toBe(true);
    expect(axSupportsOpenAIChatSessions('gpt-6-astra')).toBe(true);
  });

  it('resolve the built-in model info', () => {
    for (const [model, name] of [
      ['us.openai.gpt-6-sol', 'gpt-6-sol'],
      ['global.openai.gpt-6-astra', 'gpt-6-astra'],
      ['us-gov.openai.gpt-6-luna', 'gpt-6-luna'],
      ['global.openai.gpt-5.6-sol', 'gpt-5.6-sol'],
    ] as const) {
      for (const modelInfo of [axModelInfoOpenAI, axModelInfoOpenAIResponses]) {
        const info = getModelInfo({ model, modelInfo });
        expect(info?.name).toBe(name);
        expect(info?.notSupported).toMatchObject({
          temperature: true,
          topP: true,
        });
      }
    }
  });

  it.each([
    ['us.openai.gpt-6-sol', runtime],
    ['global.openai.gpt-6-astra', runtime],
    ['us.openai.gpt-5.6-sol', runtime],
    ['openai.gpt-6-luna', mantle],
  ])(
    'sends %s to Responses without sampling parameters',
    async (model, apiURL) => {
      const fetch = spy(response);
      const provider = ai({
        name: 'openai-responses',
        apiKey: 'bedrock-key',
        apiURL,
        config: { model: model as AxAIOpenAIResponsesModel },
        options: { fetch },
      });
      await provider.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { stream: false }
      );
      const [request] = sent(fetch);
      expect(request?.url).toBe(`${apiURL}/responses`);
      expect(request?.body.model).toBe(model);
      // The defaults are temperature 0.7 and top_p 1, which Bedrock refuses.
      expect(request?.body).not.toHaveProperty('temperature');
      expect(request?.body).not.toHaveProperty('top_p');
    }
  );

  it.each([
    ['us.openai.gpt-6-astra', runtime],
    ['global.openai.gpt-6-sol', runtime],
    ['openai.gpt-6-astra', mantle],
  ])(
    'routes %s tool calls on the openai provider to <apiURL>/responses',
    async (model, apiURL) => {
      const fetch = spy(response);
      const provider = ai({
        name: 'openai',
        apiKey: 'bedrock-key',
        apiURL,
        config: { model: model as AxAIOpenAIModel },
        options: { fetch },
      });
      await provider.chat(
        {
          chatPrompt: [{ role: 'user', content: 'hi' }],
          functions: [{ name: 'lookup', description: 'lookup' }],
        },
        { stream: false }
      );
      const [request] = sent(fetch);
      // Bedrock's Chat Completions refuses these tools and points to Responses.
      expect(request?.url).toBe(`${apiURL}/responses`);
      expect(request?.body.tools).toHaveLength(1);
      expect(request?.body).not.toHaveProperty('temperature');
    }
  );

  it('applies the GPT-5.6 effort ladder and model info on Chat Completions', async () => {
    const fetch = spy(completion);
    const provider = ai({
      name: 'openai',
      apiKey: 'bedrock-key',
      apiURL: runtime,
      config: { model: 'us.openai.gpt-5.6-sol' as AxAIOpenAIModel },
      options: { fetch },
    });
    await provider.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'minimal' }
    );
    const [request] = sent(fetch);
    expect(request?.url).toBe(`${runtime}/chat/completions`);
    // GPT-5.6 serves no `minimal`, and refuses the default `temperature: 0`.
    expect(request?.body.reasoning_effort).toBe('low');
    expect(request?.body).not.toHaveProperty('temperature');
  });

  it('reports the model features but no chat sessions on the openai provider', async () => {
    const provider = ai({
      name: 'openai',
      apiKey: 'bedrock-key',
      apiURL: runtime,
      config: { model: 'us.openai.gpt-6-astra' as AxAIOpenAIModel },
    });
    const features = provider.getFeatures('us.openai.gpt-6-astra');
    expect(features).toMatchObject({
      functions: true,
      thinking: true,
      media: { images: { supported: true } },
      caching: { supported: true, types: ['ephemeral'] },
    });
    expect(features.asyncTools).toBeFalsy();
    expect(features.reasoningUpdates).toBeFalsy();
    expect(features.nativeSteering).toBeFalsy();
    await expect(
      provider.openChatSession({
        model: 'us.openai.gpt-6-astra',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toThrow(/does not support chat sessions/);
    // The same model on OpenAI's API keeps its sessions.
    expect(provider.getFeatures('gpt-6-astra').asyncTools).toBe(true);
  });

  it('reports the GPT-6 features on the openai-responses provider', () => {
    const provider = ai({
      name: 'openai-responses',
      apiKey: 'bedrock-key',
      apiURL: runtime,
      config: { model: 'global.openai.gpt-6-luna' as AxAIOpenAIResponsesModel },
    });
    expect(provider.getFeatures('global.openai.gpt-6-luna')).toMatchObject({
      thinking: true,
      hasThinkingBudget: true,
      media: { images: { supported: true } },
      caching: { supported: true, types: ['ephemeral'] },
    });
  });

  it('caches Responses prompts with the explicit breakpoints Bedrock documents', async () => {
    const fetch = spy(response);
    const provider = ai({
      name: 'openai-responses',
      apiKey: 'bedrock-key',
      apiURL: runtime,
      config: { model: 'us.openai.gpt-6-sol' as AxAIOpenAIResponsesModel },
      options: { fetch },
    });
    await provider.chat(
      {
        chatPrompt: [
          { role: 'system', content: 'Stable instructions.' },
          { role: 'user', content: 'hi', cache: true },
        ],
      },
      { stream: false, sessionId: 'conversation' }
    );
    const [request] = sent(fetch);
    expect(request?.body.prompt_cache_options).toEqual({
      mode: 'explicit',
      ttl: '30m',
    });
    expect(request?.body.prompt_cache_key).toBe('conversation');
    expect(
      request?.body.input[0].content.at(-1).prompt_cache_breakpoint
    ).toEqual({ mode: 'explicit' });
  });

  it('refuses to cache on Chat Completions, which Bedrock does not', async () => {
    const fetch = spy(completion);
    const provider = new AxAIOpenAI({
      apiKey: 'bedrock-key',
      apiURL: runtime,
      config: { model: 'us.openai.gpt-5.6-sol' as AxAIOpenAIModel },
      options: { fetch },
    });
    expect(provider.getFeatures().caching.supported).toBe(false);
    await expect(
      provider.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { stream: false, contextCache: {} }
      )
    ).rejects.toThrow(/Context caching is not supported/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the Astra reasoning contract', () => {
    expect(() =>
      axResolveOpenAIResponsesReasoningEffort('us.openai.gpt-6-astra', 'none')
    ).toThrow(/does not support disabling reasoning/);
    expect(
      axResolveOpenAIResponsesReasoningEffort('global.openai.gpt-6-sol', 'none')
    ).toBe('none');
  });

  it('estimates cost from the built-in pricing', () => {
    // Bedrock bills global cross-Region inference at OpenAI's rates.
    const provider = ai({
      name: 'openai-responses',
      apiKey: 'bedrock-key',
      apiURL: runtime,
      config: { model: 'global.openai.gpt-6-luna' as AxAIOpenAIResponsesModel },
    });
    expect(
      provider.getEstimatedCost({
        ai: 'openai-responses',
        model: 'global.openai.gpt-6-luna',
        tokens: {
          promptTokens: 200_000,
          completionTokens: 1_000_000,
          totalTokens: 1_200_000,
        },
      })
    ).toBeCloseTo(0.52);
  });
});
