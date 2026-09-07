import { describe, expect, it } from 'vitest';
import { axGetSupportedAIModels } from '../catalog.js';
import { ai } from '../wrap.js';
import { AxAIOpenAIModel } from './chat_types.js';
import {
  axResolveOpenAIChatReasoningEffort,
  axResolveOpenAIResponsesReasoningEffort,
} from './effort.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const model = AxAIOpenAIModel.GPT6Astra;
describe('GPT-6 Astra', () => {
  it('exposes correct catalog and runtime capabilities', () => {
    for (const name of ['openai', 'openai-responses'] as const) {
      const provider = ai({ name, apiKey: 'test', config: { model } });
      const catalog = axGetSupportedAIModels()
        .find((p) => p.name === name)
        ?.models.find((m) => m.name === model);
      expect(catalog?.capabilities.thinkingLevels).not.toContain('none');
      expect(catalog).toMatchObject({
        contextWindow: 1_050_000,
        maxTokens: 128_000,
        promptTokenCostPer1M: 10,
      });
      expect(provider.getFeatures(model).functions).toBe(true);
      expect(provider.getFeatures(model).caching.supported).toBe(true);
    }
  });
  it('maps portable effort without changing the GPT-5.6 contract', () => {
    for (const resolve of [
      axResolveOpenAIChatReasoningEffort,
      axResolveOpenAIResponsesReasoningEffort,
    ]) {
      expect(() => resolve(model, 'none')).toThrow(/reasoning/);
      expect(resolve(model, 'minimal')).toBe('low');
      expect(resolve(model, 'low')).toBe('low');
      expect(resolve(model, 'medium')).toBe('medium');
      expect(resolve(model, 'high')).toBe('high');
      expect(resolve('gpt-5.6-sol', 'none')).toBe('none');
    }
    expect(axResolveOpenAIResponsesReasoningEffort(model, 'highest')).toBe(
      'max'
    );
  });
  it('automatically routes OpenAI Astra tools through Responses', async () => {
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
  });
  it('bills cache writes at the long-context rate only above the threshold', () => {
    const provider = ai({ name: 'openai', apiKey: 'test', config: { model } });
    const cost = (input: number) =>
      provider.getEstimatedCost({
        ai: 'openai',
        model,
        tokens: {
          promptTokens: 0,
          completionTokens: 100,
          cacheCreationTokens: input,
          totalTokens: input + 100,
        },
      });
    expect(cost(272_000)).toBeCloseTo(3.405);
    expect(cost(272_001)).toBeCloseTo(6.807525);
  });
  it('sends Astra Responses caching and filters unsupported parameters', async () => {
    let body: any;
    const provider = ai({
      name: 'openai-responses',
      apiKey: 'test',
      config: { model: AxAIOpenAIResponsesModel.GPT6Astra },
      options: {
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({
            id: 'r',
            model,
            output: [
              {
                type: 'message',
                id: 'm',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
          });
        },
      },
    });
    await provider.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi', cache: true }],
        modelConfig: { temperature: 0.8, topP: 1 },
      },
      { stream: false, thinkingTokenBudget: 'low', sessionId: 'conversation' }
    );
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.reasoning.effort).toBe('low');
    expect(body.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(body.prompt_cache_key).toBe('conversation');
    expect(body.input[0].content[0].prompt_cache_breakpoint).toEqual({
      mode: 'explicit',
    });
  });
});

it('preserves provider and alias defaults in normalized sessions, with request overrides', async () => {
  const requests: any[] = [];
  const provider = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model, maxTokens: 1200 },
    models: [
      {
        key: 'smart',
        model,
        description: 'Astra',
        modelConfig: { maxTokens: 700 },
        thinkingTokenBudget: 'high',
      },
    ],
    options: {
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(
          `data: ${JSON.stringify({ type: 'response.completed', response: { id: `r${requests.length}`, model, status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`
        );
      },
    },
  });
  for (const request of [
    { model, chatPrompt: [] },
    { model: 'smart', chatPrompt: [] },
    { model: 'smart', chatPrompt: [], modelConfig: { maxTokens: 300 } },
  ] as const) {
    const session = await provider.openChatSession({
      ...request,
      chatPrompt: [{ role: 'user', content: 'hello' }],
    });
    for await (const event of session.events())
      if (event.type === 'response.completed') break;
    session.close();
  }
  expect(requests.map((r) => r.max_output_tokens)).toEqual([1200, 700, 300]);
  expect(requests[1].reasoning.effort).toBe('high');
});
