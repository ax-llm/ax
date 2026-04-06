import { describe, expect, it, vi } from 'vitest';
import { AxAIOllama } from './api.js';

function createMockFetch(body: unknown, capture: { lastBody?: any }) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (init?.body && typeof init.body === 'string') {
          capture.lastBody = JSON.parse(init.body);
        }
      } catch {}
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

describe('AxAIOllama thinking controls', () => {
  it('passes thinkingTokenBudget none through as think false', async () => {
    const ai = new AxAIOllama({
      apiKey: 'not-set',
      config: { model: 'qwen3.5:0.8b' },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    const res = await ai.chat(
      {
        model: 'qwen3.5:0.8b',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false, thinkingTokenBudget: 'none' }
    );

    expect(res.results[0]?.content).toBe('ok');
    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody.think).toBe(false);
  });

  it('passes non-none thinkingTokenBudget through as think true', async () => {
    const ai = new AxAIOllama({
      apiKey: 'not-set',
      config: { model: 'qwen3:0.6b' },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    await ai.chat(
      {
        model: 'qwen3:0.6b',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false, thinkingTokenBudget: 'low' }
    );

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody.think).toBe(true);
  });

  it('does not add think when no thinkingTokenBudget is provided', async () => {
    const ai = new AxAIOllama({
      apiKey: 'not-set',
      config: { model: 'qwen3:0.6b' },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    await ai.chat({
      model: 'qwen3:0.6b',
      chatPrompt: [{ role: 'user', content: 'hi' }],
    });

    expect(fetch).toHaveBeenCalled();
    expect('think' in capture.lastBody).toBe(false);
  });
});

describe('AxAIOllama think tag extraction (non-streaming)', () => {
  it('extracts <think> content into thought field', async () => {
    const ai = new AxAIOllama({
      apiKey: 'not-set',
      config: { model: 'qwen3:0.6b' },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '<think>I should say hi</think>\nHello!',
            },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    const res = await ai.chat(
      { model: 'qwen3:0.6b', chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'low' }
    );

    expect(res.results[0]?.thought).toBe('I should say hi');
    expect(res.results[0]?.content).toBe('Hello!');
  });

  it('leaves content unchanged when no <think> tags present', async () => {
    const ai = new AxAIOllama({
      apiKey: 'not-set',
      config: { model: 'qwen3:0.6b' },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

    ai.setOptions({ fetch });

    const res = await ai.chat(
      { model: 'qwen3:0.6b', chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    expect(res.results[0]?.thought).toBeUndefined();
    expect(res.results[0]?.content).toBe('Hello!');
  });
});
