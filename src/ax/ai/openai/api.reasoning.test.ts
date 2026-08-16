import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAI } from './api.js';
import { AxAIOpenAIModel } from './chat_types.js';
import { axModelInfoOpenAI, axModelInfoOpenAIResponses } from './info.js';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import {
  AxAIOpenAIResponsesModel,
  type AxAIOpenAIResponsesRequest,
} from './responses_types.js';

function captureFetch(capture: { lastBody?: any }) {
  return vi.fn().mockImplementation(async (_url: any, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        capture.lastBody = JSON.parse(init.body);
      } catch {}
    }
    return new Response(
      JSON.stringify({
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
}

async function chatEffort(
  model: AxAIOpenAIModel,
  options: Record<string, unknown>,
  config: Record<string, unknown> = {}
) {
  const ai = new AxAIOpenAI({ apiKey: 'key', config: { model, ...config } });
  const capture: { lastBody?: any } = {};
  ai.setOptions({ fetch: captureFetch(capture) });

  await ai.chat(
    { model, chatPrompt: [{ role: 'user', content: 'hi' }] },
    { stream: false, ...options }
  );

  return capture.lastBody?.reasoning_effort;
}

function responsesReasoning(
  model: AxAIOpenAIResponsesModel,
  options: Record<string, unknown>,
  config: Record<string, unknown> = {}
) {
  const impl = new AxAIOpenAIResponsesImpl({ model, ...config } as any, false);

  const [, req] = impl.createChatReq(
    { model, chatPrompt: [{ role: 'user', content: 'hi' }] } as any,
    options as any
  );

  return (req as AxAIOpenAIResponsesRequest<any>).reasoning;
}

// effort.test.ts is the exhaustive spec for the ladders themselves. These cases
// only prove both request builders route through the resolver and hand it the
// model, so they cover the rungs where the two ladders disagree.
describe('OpenAI reasoning effort ladder', () => {
  // `highest` is where the two surfaces part: Chat Completions rejects `max`,
  // so it stops at `xhigh` while Responses goes the rung higher.
  const budgets = [
    {
      budget: 'medium',
      legacy: 'high',
      chat56: 'medium',
      responses56: 'medium',
    },
    { budget: 'highest', legacy: 'xhigh', chat56: 'xhigh', responses56: 'max' },
  ] as const;

  it.each(budgets)(
    'Chat maps $budget to $legacy on gpt-5.5 and $chat56 on gpt-5.6',
    async ({ budget, legacy, chat56 }) => {
      await expect(
        chatEffort(AxAIOpenAIModel.GPT55, { thinkingTokenBudget: budget })
      ).resolves.toBe(legacy);
      await expect(
        chatEffort(AxAIOpenAIModel.GPT56, { thinkingTokenBudget: budget })
      ).resolves.toBe(chat56);
    }
  );

  it.each(budgets)(
    'Responses maps $budget to $legacy on gpt-5.5 and $responses56 on gpt-5.6',
    ({ budget, legacy, responses56 }) => {
      expect(
        responsesReasoning(AxAIOpenAIResponsesModel.GPT55, {
          thinkingTokenBudget: budget,
        })?.effort
      ).toBe(legacy);
      expect(
        responsesReasoning(AxAIOpenAIResponsesModel.GPT56, {
          thinkingTokenBudget: budget,
        })?.effort
      ).toBe(responses56);
    }
  );

  // The 5.6 branch keys off the model name, so the suffixed variants must land
  // on the same ladder as the `gpt-5.6` alias.
  it.each([
    AxAIOpenAIModel.GPT56Sol,
    AxAIOpenAIModel.GPT56Terra,
    AxAIOpenAIModel.GPT56Luna,
  ])('Chat applies the 5.6 ladder to %s', async (model) => {
    await expect(
      chatEffort(model, { thinkingTokenBudget: 'highest' })
    ).resolves.toBe('xhigh');
  });

  it.each([
    AxAIOpenAIResponsesModel.GPT56Sol,
    AxAIOpenAIResponsesModel.GPT56Terra,
    AxAIOpenAIResponsesModel.GPT56Luna,
  ])('Responses applies the 5.6 ladder to %s', (model) => {
    expect(
      responsesReasoning(model, { thinkingTokenBudget: 'highest' })?.effort
    ).toBe('max');
    expect(
      responsesReasoning(model, {
        thinkingTokenBudget: 'none',
        showThoughts: true,
      })
    ).toEqual({ effort: 'none' });
  });
});

// GPT-5.6 defaults an omitted effort to 'medium', so 'none' has to travel as an
// explicit value rather than a dropped field.
describe('OpenAI thinkingTokenBudget=none', () => {
  it('sends an explicit none for gpt-5.6 and omits the field otherwise', async () => {
    await expect(
      chatEffort(AxAIOpenAIModel.GPT56, { thinkingTokenBudget: 'none' })
    ).resolves.toBe('none');
    await expect(
      chatEffort(AxAIOpenAIModel.GPT55, { thinkingTokenBudget: 'none' })
    ).resolves.toBeUndefined();
  });

  it('drops the reasoning summary when reasoning is disabled', () => {
    expect(
      responsesReasoning(AxAIOpenAIResponsesModel.GPT56, {
        thinkingTokenBudget: 'none',
        showThoughts: true,
      })
    ).toEqual({ effort: 'none' });
  });

  // Without a budget to override it the effort comes straight from config, so
  // this pins the summary down where the request object is first built.
  it('drops the summary for a configured none effort', () => {
    expect(
      responsesReasoning(
        AxAIOpenAIResponsesModel.GPT56,
        { showThoughts: true },
        { reasoningEffort: 'none' }
      )
    ).toEqual({ effort: 'none' });
  });

  it('still requests a summary when reasoning is enabled', () => {
    expect(
      responsesReasoning(AxAIOpenAIResponsesModel.GPT56, {
        thinkingTokenBudget: 'high',
        showThoughts: true,
      })
    ).toEqual({ effort: 'high', summary: 'auto' });
  });

  it('drops the reasoning object entirely for non-5.6 models', () => {
    expect(
      responsesReasoning(AxAIOpenAIResponsesModel.GPT55, {
        thinkingTokenBudget: 'none',
        showThoughts: true,
      })
    ).toBeUndefined();
  });
});

// `reasoningEffort` is the provider-native escape hatch and is forwarded
// verbatim — including the rungs the budget ladder cannot reach.
describe('OpenAI explicit reasoningEffort', () => {
  it.each(['xhigh', 'max'] as const)(
    'forwards %s unchanged on gpt-5.6 responses',
    (effort) => {
      expect(
        responsesReasoning(
          AxAIOpenAIResponsesModel.GPT56,
          {},
          { reasoningEffort: effort }
        )?.effort
      ).toBe(effort);
    }
  );

  it('forwards xhigh unchanged on gpt-5.6 chat', async () => {
    await expect(
      chatEffort(AxAIOpenAIModel.GPT56, {}, { reasoningEffort: 'xhigh' })
    ).resolves.toBe('xhigh');
  });

  // The chat config type no longer offers `max`, but the escape hatch is a
  // passthrough rather than a validator — the same hook lets DeepSeek send its
  // own `max`. A caller who forces one past the type still gets it on the wire,
  // and OpenAI answers with a 400. Pinned so nobody adds a silent clamp here.
  it('forwards an unsupported chat effort as-is rather than clamping it', async () => {
    await expect(
      chatEffort(AxAIOpenAIModel.GPT56, {}, { reasoningEffort: 'max' })
    ).resolves.toBe('max');
  });

  it('is overridden by an explicit thinkingTokenBudget', async () => {
    await expect(
      chatEffort(
        AxAIOpenAIModel.GPT56,
        { thinkingTokenBudget: 'low' },
        { reasoningEffort: 'xhigh' }
      )
    ).resolves.toBe('low');
  });
});

describe('OpenAI reasoning content compatibility', () => {
  it('does not send or expose the DeepSeek reasoning_content extension', async () => {
    const capture: { lastBody?: any } = {};
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT56, stream: false },
    });
    ai.setOptions({
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capture.lastBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'chat-openai',
            model: AxAIOpenAIModel.GPT56,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'done',
                  reasoning_content: 'provider-private reasoning',
                },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    const response = await ai.chat(
      {
        model: AxAIOpenAIModel.GPT56,
        chatPrompt: [
          { role: 'user', content: 'Continue.' },
          {
            role: 'assistant',
            content: 'Previous answer.',
            thought: 'DeepSeek-only trace.',
          },
        ],
      },
      { stream: false }
    );

    expect(capture.lastBody?.messages?.[1]).toEqual({
      role: 'assistant',
      content: 'Previous answer.',
    });
    if (response instanceof ReadableStream) {
      throw new Error('Expected non-streaming response');
    }
    expect(response.results[0]?.thought).toBeUndefined();
    expect(response.results[0]?.thoughtBlocks).toBeUndefined();
  });
});

describe('OpenAI model catalog: new 2026 entries are registered', () => {
  it('has gpt-5.5 in chat catalog with 1M context window and thinkingBudget', () => {
    const entry = axModelInfoOpenAI.find(
      (m) => m.name === AxAIOpenAIModel.GPT55
    );
    expect(entry).toBeDefined();
    expect(entry?.contextWindow).toBe(1_000_000);
    expect(entry?.supported?.thinkingBudget).toBe(true);
  });

  it('has gpt-5.5-pro in chat catalog marked isExpensive', () => {
    const entry = axModelInfoOpenAI.find(
      (m) => m.name === AxAIOpenAIModel.GPT55Pro
    );
    expect(entry).toBeDefined();
    expect(entry?.isExpensive).toBe(true);
    expect(entry?.contextWindow).toBe(1_000_000);
  });

  it('has gpt-5.5 and gpt-5.5-pro in responses catalog', () => {
    const gpt55 = axModelInfoOpenAIResponses.find(
      (m) => m.name === AxAIOpenAIResponsesModel.GPT55
    );
    const gpt55Pro = axModelInfoOpenAIResponses.find(
      (m) => m.name === AxAIOpenAIResponsesModel.GPT55Pro
    );
    expect(gpt55?.supported?.thinkingBudget).toBe(true);
    expect(gpt55Pro?.isExpensive).toBe(true);
  });

  // Rates as published by OpenAI; the long-context tier bills the whole
  // request at 2x input / 1.5x output above the 272K threshold.
  it.each([
    {
      name: AxAIOpenAIModel.GPT56Sol,
      rates: [5, 30, 0.5],
      longRates: [10, 45, 1],
    },
    {
      name: AxAIOpenAIModel.GPT56Terra,
      rates: [2, 12, 0.2],
      longRates: [4, 18, 0.4],
    },
    {
      name: AxAIOpenAIModel.GPT56Luna,
      rates: [0.2, 1.2, 0.02],
      longRates: [0.4, 1.8, 0.04],
    },
  ])('has $name in both catalogs with published rates', (expected) => {
    for (const catalog of [axModelInfoOpenAI, axModelInfoOpenAIResponses]) {
      const entry = catalog.find((m) => m.name === expected.name);
      expect(entry).toBeDefined();
      expect([
        entry?.promptTokenCostPer1M,
        entry?.completionTokenCostPer1M,
        entry?.cacheReadTokenCostPer1M,
      ]).toEqual(expected.rates);
      expect([
        entry?.longContextPromptTokenCostPer1M,
        entry?.longContextCompletionTokenCostPer1M,
        entry?.longContextCacheReadTokenCostPer1M,
      ]).toEqual(expected.longRates);
      expect(entry?.longContextThreshold).toBe(272_000);
      expect(entry?.contextWindow).toBe(1_050_000);
      expect(entry?.maxTokens).toBe(128_000);
      expect(entry?.supported?.thinkingBudget).toBe(true);
    }
  });

  it('routes the gpt-5.6 alias to the sol entry in both catalogs', () => {
    for (const catalog of [axModelInfoOpenAI, axModelInfoOpenAIResponses]) {
      const entry = catalog.find((m) => m.name === AxAIOpenAIModel.GPT56Sol);
      expect(entry?.aliases).toContain(AxAIOpenAIModel.GPT56);
    }
  });

  it('has new audio/realtime models in chat catalog', () => {
    const audio15 = axModelInfoOpenAI.find(
      (m) => m.name === AxAIOpenAIModel.GPTAudio15
    );
    const realtime15 = axModelInfoOpenAI.find(
      (m) => m.name === AxAIOpenAIModel.GPTRealtime15
    );
    const realtimeTranslate = axModelInfoOpenAI.find(
      (m) => m.name === AxAIOpenAIModel.GPTRealtimeTranslate
    );
    expect(audio15?.audio?.input).toBe(true);
    expect(realtime15?.audio?.output).toBe(true);
    expect(realtimeTranslate?.audio?.input).toBe(true);
  });
});
