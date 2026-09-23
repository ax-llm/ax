import { describe, expect, it } from 'vitest';
import { axGetSupportedAIModels } from '../catalog.js';
import { axNormalizeAppliedServiceTier } from '../service_tier.js';
import { ai } from '../wrap.js';
import { AxAIOpenAI } from './api.js';
import { AxAIOpenAIModel } from './chat_types.js';
import {
  axResolveOpenAIChatReasoningEffort,
  axResolveOpenAIResponsesReasoningEffort,
} from './effort.js';
import {
  axIsGPT6Astra,
  axIsGPT6Family,
  axSupportsOpenAIBreakpointCaching,
} from './model_family.js';
import { axValidateOpenAIResponseRequest } from './responses_client.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const tiers = [AxAIOpenAIModel.GPT6Sol, AxAIOpenAIModel.GPT6Luna] as const;

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

describe('GPT-6 Sol and Luna', () => {
  it('belong to the GPT-6 family without inheriting Astra-only contracts', () => {
    for (const model of [...tiers, 'gpt-6-sol-2026-09-14']) {
      expect(axIsGPT6Family(model)).toBe(true);
      expect(axIsGPT6Astra(model)).toBe(false);
      expect(axSupportsOpenAIBreakpointCaching(model)).toBe(true);
    }
    expect(axIsGPT6Family(AxAIOpenAIModel.GPT6Astra)).toBe(true);
    for (const model of ['gpt-6', 'gpt-60-sol', 'gpt-5.6-sol', 'gpt-6-nova']) {
      expect(axIsGPT6Family(model)).toBe(false);
    }
  });

  it.each(tiers)(
    'exposes %s in both catalogs with `none` thinking',
    (model) => {
      for (const name of ['openai', 'openai-responses'] as const) {
        const entry = axGetSupportedAIModels()
          .find((p) => p.name === name)
          ?.models.find((m) => m.name === model);
        expect(entry).toMatchObject({
          contextWindow: 1_050_000,
          maxTokens: 128_000,
        });
        expect(entry?.capabilities.thinkingLevels).toContain('none');
        expect(entry?.capabilities.temperature).toBe(false);
      }
    }
  );

  it.each(tiers)(
    'maps portable effort onto the GPT-5.6 ladders for %s',
    (model) => {
      // An omitted effort means `medium`, so `none` has to be sent explicitly.
      expect(axResolveOpenAIChatReasoningEffort(model, 'none')).toBe('none');
      expect(axResolveOpenAIResponsesReasoningEffort(model, 'none')).toBe(
        'none'
      );
      // Neither surface serves `minimal`; only Responses serves `max`.
      expect(axResolveOpenAIChatReasoningEffort(model, 'minimal')).toBe('low');
      expect(axResolveOpenAIChatReasoningEffort(model, 'highest')).toBe(
        'xhigh'
      );
      expect(axResolveOpenAIResponsesReasoningEffort(model, 'highest')).toBe(
        'max'
      );
    }
  );

  it.each(tiers)('routes %s tool calls through Responses', async (model) => {
    let url = '';
    const provider = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model },
      options: {
        fetch: async (input) => {
          url = String(input);
          return Response.json({
            id: 'r1',
            model,
            output: [],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          });
        },
      },
    });
    await provider.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        functions: [{ name: 'lookup', description: 'lookup' }],
      },
      { stream: false }
    );
    expect(url).toContain('/responses');
    expect(provider.getFeatures(model).functions).toBe(true);
    expect(provider.getFeatures(model).media.images.supported).toBe(true);
    expect(provider.getFeatures(model).caching.supported).toBe(true);
  });

  it('refuses Chat Completions tools while reasoning, since OpenAI returns a 400', async () => {
    const provider = new AxAIOpenAI({
      apiKey: 'test',
      config: { model: AxAIOpenAIModel.GPT6Luna },
      options: { fetch: async () => completion('gpt-6-luna') },
    });
    await expect(
      provider.chat(
        {
          chatPrompt: [{ role: 'user', content: 'hi' }],
          functions: [{ name: 'lookup', description: 'lookup' }],
        },
        { stream: false }
      )
    ).rejects.toThrow(
      /function tools on Chat Completions only with reasoning disabled/
    );
  });

  it('sends Chat Completions tools once reasoning is disabled', async () => {
    let body: any;
    const provider = new AxAIOpenAI({
      apiKey: 'test',
      config: { model: AxAIOpenAIModel.GPT6Sol },
      options: {
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return completion('gpt-6-sol');
        },
      },
    });
    await provider.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        functions: [{ name: 'lookup', description: 'lookup' }],
        modelConfig: { temperature: 0.3 },
      },
      { stream: false, thinkingTokenBudget: 'none' }
    );
    expect(body.reasoning_effort).toBe('none');
    expect(body.tools).toHaveLength(1);
    expect(body.temperature).toBeUndefined();
  });

  it('caches Chat Completions prompts with explicit breakpoints and a ttl', async () => {
    let body: any;
    const provider = new AxAIOpenAI({
      apiKey: 'test',
      config: { model: AxAIOpenAIModel.GPT6Luna },
      options: {
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return completion('gpt-6-luna');
        },
      },
    });
    await provider.chat(
      {
        chatPrompt: [
          { role: 'system', content: 'Stable instructions.', cache: true },
          { role: 'user', content: 'hi' },
        ],
      },
      { stream: false, sessionId: 'conversation' }
    );
    expect(body.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(body.prompt_cache_key).toBe('conversation');
    expect(body.messages[0].content.at(-1).prompt_cache_breakpoint).toEqual({
      mode: 'explicit',
    });
  });

  it('validates Responses requests with family rules but not Astra rules', () => {
    const sol = axValidateOpenAIResponseRequest({
      model: AxAIOpenAIResponsesModel.GPT6Sol,
      input: 'hi',
      reasoning: { effort: 'none' },
      temperature: 0.5,
      top_p: 0.9,
      prompt_cache_retention: '24h',
    } as any);
    expect(sol.reasoning?.effort).toBe('none');
    expect(sol.temperature).toBeUndefined();
    expect(sol.top_p).toBeUndefined();
    // Sol and Luna accept extended retention; only Astra has it stripped.
    expect((sol as any).prompt_cache_retention).toBe('24h');

    expect(() =>
      axValidateOpenAIResponseRequest({
        model: AxAIOpenAIResponsesModel.GPT6Luna,
        input: [
          {
            type: 'configuration_update',
            reasoning: { effort: 'high' },
          },
        ],
      } as any)
    ).toThrow(/configuration_update requires GPT-6 Astra/);
  });

  it('bills Luna cache writes at the long-context rate only above the threshold', () => {
    const provider = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model: AxAIOpenAIModel.GPT6Luna },
    });
    const cost = (input: number) =>
      provider.getEstimatedCost({
        ai: 'openai',
        model: AxAIOpenAIModel.GPT6Luna,
        tokens: {
          promptTokens: 0,
          completionTokens: 1_000_000,
          cacheCreationTokens: input,
          totalTokens: input + 1_000_000,
        },
      });
    expect(cost(272_000)).toBeCloseTo(0.5 + 0.272 * 0.125);
    expect(cost(272_001)).toBeCloseTo(0.75 + 0.272001 * 0.25);
  });

  it('reads a served `fast` tier as priority', () => {
    expect(axNormalizeAppliedServiceTier('fast')).toBe('priority');
  });
});
