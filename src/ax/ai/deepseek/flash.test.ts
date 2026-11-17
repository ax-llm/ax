import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAIProfile, axGetAIProfile } from '../provider_profiles.js';
import { axModelInfoDeepSeek } from './info.js';
import { AxAIDeepSeekModel } from './types.js';

// DeepSeek retired V4-Flash on 2026-09-10. `deepseek-flash` is the id for the
// current Flash model (DeepSeek-V4.1-Flash); `deepseek-v4-flash` is still
// accepted and served by the same model.

const okResponse = () =>
  new Response(
    JSON.stringify({
      id: 'chat-1',
      object: 'chat.completion',
      created: 0,
      model: AxAIDeepSeekModel.DeepSeekFlash,
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

const createClient = (model?: AxAIDeepSeekModel) => {
  const capture: { body?: Record<string, any> } = {};
  const ai = new AxAIOpenAIProfile({
    name: 'deepseek',
    apiKey: 'key',
    config: { ...(model ? { model } : {}), stream: false },
  });
  ai.setOptions({
    fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capture.body = JSON.parse(String(init?.body));
      return okResponse();
    }),
  });
  return { ai, capture };
};

describe('DeepSeek Flash (V4.1)', () => {
  it('is the default model for the chat and Responses profiles', () => {
    expect(axGetAIProfile('deepseek').defaultModel).toBe(
      AxAIDeepSeekModel.DeepSeekFlash
    );
    expect(axGetAIProfile('deepseek-responses').defaultModel).toBe(
      AxAIDeepSeekModel.DeepSeekFlash
    );
  });

  it('sends deepseek-flash with maximum thinking by default', async () => {
    const { ai, capture } = createClient();

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Return ok.' }],
        modelConfig: { temperature: 0.2 },
      },
      { stream: false }
    );

    expect(capture.body?.model).toBe(AxAIDeepSeekModel.DeepSeekFlash);
    expect(capture.body?.thinking).toEqual({ type: 'enabled' });
    expect(capture.body?.reasoning_effort).toBe('max');
    expect(capture.body).not.toHaveProperty('temperature');
  });

  it('omits tool_choice and replays reasoning on deepseek-flash tool turns', async () => {
    const { ai, capture } = createClient(AxAIDeepSeekModel.DeepSeekFlash);

    await ai.chat(
      {
        chatPrompt: [
          { role: 'user', content: 'Continue the lookup.' },
          {
            role: 'assistant',
            thought: 'I need the warehouse query.',
            functionCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'query', params: '{"region":"East"}' },
              },
            ],
          },
          {
            role: 'function',
            functionId: 'call-1',
            result: '{"totalRevenue":42}',
          },
        ],
        functions: [
          {
            name: 'query',
            description: 'Query the warehouse.',
            parameters: {
              type: 'object',
              properties: { region: { type: 'string' } },
            },
          },
        ],
      },
      { stream: false }
    );

    expect(capture.body?.messages?.[1]?.reasoning_content).toBe(
      'I need the warehouse query.'
    );
    expect(capture.body).not.toHaveProperty('tool_choice');
  });

  it('advertises thinking support for deepseek-flash', () => {
    const { ai } = createClient();

    expect(ai.getFeatures(AxAIDeepSeekModel.DeepSeekFlash)).toMatchObject({
      hasThinkingBudget: true,
      hasShowThoughts: true,
      structuredOutputs: false,
      thinking: true,
    });
  });

  it('describes the current models and marks V4-Flash as retired', () => {
    const byName = (name: string) =>
      axModelInfoDeepSeek.find((model) => model.name === name);

    expect(byName(AxAIDeepSeekModel.DeepSeekFlash)).toMatchObject({
      promptTokenCostPer1M: 0.3,
      completionTokenCostPer1M: 1.2,
      cacheReadTokenCostPer1M: 0.006,
      contextWindow: 1_048_576,
      maxTokens: 393_216,
      modalities: { input: ['text', 'image'], output: ['text'] },
    });
    expect(byName(AxAIDeepSeekModel.DeepSeekV4Pro)).toMatchObject({
      promptTokenCostPer1M: 1.32,
      completionTokenCostPer1M: 3.96,
      cacheReadTokenCostPer1M: 0.044,
      modalities: { input: ['text'], output: ['text'] },
    });
    expect(byName(AxAIDeepSeekModel.DeepSeekV4Flash)).toMatchObject({
      isDeprecated: true,
      promptTokenCostPer1M: 0.3,
      completionTokenCostPer1M: 1.2,
    });
  });
});
