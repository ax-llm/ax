import { describe, expect, it, vi } from 'vitest';
import { AxAIDeepSeek } from './api.js';
import { AxAIDeepSeekModel } from './types.js';

const promptWithPriorToolTurn = [
  { role: 'user' as const, content: 'Continue the lookup.' },
  {
    role: 'assistant' as const,
    thought: 'I need the warehouse query.',
    functionCalls: [
      {
        id: 'call-1',
        type: 'function' as const,
        function: { name: 'query', params: '{"region":"East"}' },
      },
    ],
  },
  {
    role: 'function' as const,
    functionId: 'call-1',
    result: '{"totalRevenue":42}',
  },
];

describe('DeepSeek Chat reasoning replay', () => {
  it('round-trips reasoning_content on assistant tool turns', async () => {
    const capture: { body?: Record<string, any> } = {};
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: false },
    });
    ai.setOptions({
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capture.body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'chat-1',
            object: 'chat.completion',
            created: 0,
            model: AxAIDeepSeekModel.DeepSeekV4Flash,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'done' },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    await ai.chat(
      {
        model: AxAIDeepSeekModel.DeepSeekV4Flash,
        chatPrompt: promptWithPriorToolTurn,
      },
      { stream: false }
    );

    const assistant = capture.body?.messages?.[1];
    expect(assistant?.reasoning_content).toBe('I need the warehouse query.');
    expect(assistant?.tool_calls?.[0]?.function?.name).toBe('query');
  });

  it('preserves streamed reasoning deltas', async () => {
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: true },
    });
    ai.setOptions({
      fetch: vi.fn(async () => {
        const encoder = new TextEncoder();
        const chunks = [
          {
            id: 'chat-stream',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: null,
                  reasoning_content: 'plan',
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: 'chat-stream',
            choices: [
              {
                index: 0,
                delta: { content: 'done' },
                finish_reason: 'stop',
              },
            ],
          },
        ];
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
              );
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    });

    const stream = await ai.chat(
      {
        model: AxAIDeepSeekModel.DeepSeekV4Flash,
        chatPrompt: [{ role: 'user', content: 'Think then answer.' }],
      },
      { stream: true }
    );
    const reader = stream.getReader();
    const results: any[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      results.push(next.value.results[0]);
    }

    expect(results.some((result) => result.thought === 'plan')).toBe(true);
  });
});
