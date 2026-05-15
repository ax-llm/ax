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

describe('OpenAI Chat: thinkingTokenBudget=highest → reasoning_effort=xhigh', () => {
  it('maps thinkingTokenBudget "highest" to reasoning_effort "xhigh"', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT55 },
    });
    const capture: { lastBody?: any } = {};
    ai.setOptions({ fetch: captureFetch(capture) });

    await ai.chat(
      {
        model: AxAIOpenAIModel.GPT55,
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false, thinkingTokenBudget: 'highest' }
    );

    expect(capture.lastBody?.reasoning_effort).toBe('xhigh');
  });

  it('still maps "high" to "high" (no regression)', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT55 },
    });
    const capture: { lastBody?: any } = {};
    ai.setOptions({ fetch: captureFetch(capture) });

    await ai.chat(
      {
        model: AxAIOpenAIModel.GPT55,
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(capture.lastBody?.reasoning_effort).toBe('high');
  });
});

describe('OpenAI Responses: thinkingTokenBudget=highest → reasoning.effort=xhigh', () => {
  const baseConfig = { model: AxAIOpenAIResponsesModel.GPT55 } as any;

  it('maps highest → xhigh through createChatReq', () => {
    const impl = new AxAIOpenAIResponsesImpl(baseConfig, false);

    const [, req] = impl.createChatReq(
      {
        model: AxAIOpenAIResponsesModel.GPT55,
        chatPrompt: [{ role: 'user', content: 'hi' }],
      } as any,
      { thinkingTokenBudget: 'highest' } as any
    );

    expect((req as AxAIOpenAIResponsesRequest<any>).reasoning?.effort).toBe(
      'xhigh'
    );
  });

  it('still maps high → high (no regression)', () => {
    const impl = new AxAIOpenAIResponsesImpl(baseConfig, false);

    const [, req] = impl.createChatReq(
      {
        model: AxAIOpenAIResponsesModel.GPT55,
        chatPrompt: [{ role: 'user', content: 'hi' }],
      } as any,
      { thinkingTokenBudget: 'high' } as any
    );

    expect((req as AxAIOpenAIResponsesRequest<any>).reasoning?.effort).toBe(
      'high'
    );
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
