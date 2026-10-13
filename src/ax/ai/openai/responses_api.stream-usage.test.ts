import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import { AxAIOpenAIResponses } from './responses_api_base.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const config = {
  model: AxAIOpenAIResponsesModel.GPT55,
  maxTokens: 16,
  stream: true,
} as any;

const event = (type: string, usage?: Record<string, number>) =>
  ({
    type,
    sequence_number: 1,
    response: { id: `res_${type}`, status: 'in_progress', usage },
  }) as any;

describe('Responses API streamed usage across calls', () => {
  it('does not report the previous stream usage when a new stream starts', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);
    impl.createChatStreamResp(
      event('response.completed', {
        input_tokens: 900,
        output_tokens: 300,
        total_tokens: 1200,
      }),
      {}
    );
    expect(impl.getTokenUsage()?.totalTokens).toBe(1200);

    // A second call on the same instance: nothing is known about its usage yet.
    impl.createChatStreamResp(event('response.created'), {});
    expect(impl.getTokenUsage()).toBeUndefined();
  });
});

describe('AxAIOpenAIResponses streamed usage on a reused client', () => {
  const sse = (events: readonly unknown[]) => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const e of events) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(e)}\n\n`)
            );
          }
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
  };
  const streamEvents = (id: string, text: string, total: number) => [
    {
      type: 'response.created',
      sequence_number: 0,
      response: { id, status: 'in_progress' },
    },
    {
      type: 'response.output_text.delta',
      sequence_number: 1,
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: 'response.completed',
      sequence_number: 2,
      response: {
        id,
        status: 'completed',
        usage: {
          input_tokens: total - 1,
          output_tokens: 1,
          total_tokens: total,
        },
      },
    },
  ];

  it('never shows the first call usage on the second call chunks', async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () =>
        sse(streamEvents('res_1', 'one', 1200))
      )
      .mockImplementationOnce(async () =>
        sse(streamEvents('res_2', 'two', 30))
      );
    const ai = new AxAIOpenAIResponses({
      apiKey: 'key',
      config: { model: AxAIOpenAIResponsesModel.GPT55 },
    });
    ai.setOptions({ fetch });

    const totals = async () => {
      const stream = (await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { stream: true }
      )) as ReadableStream<any>;
      const seen: number[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const total = value.modelUsage?.tokens?.totalTokens;
        if (typeof total === 'number') seen.push(total);
      }
      return seen;
    };

    expect(await totals()).not.toContain(30);
    expect(await totals()).not.toContain(1200);
  });
});
