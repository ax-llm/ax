import { describe, expect, it, vi } from 'vitest';
import { AxAIAnthropic } from './api.js';
import { AxAIAnthropicModel } from './types.js';

// Builds a streaming Response from Anthropic SSE events.
const streamFetch = (events: readonly unknown[]) =>
  vi.fn().mockImplementation(async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

const streamedUsage = async (events: readonly unknown[]) => {
  const ai = new AxAIAnthropic({
    apiKey: 'key',
    config: { model: AxAIAnthropicModel.Claude55Haiku },
  });
  ai.setOptions({ fetch: streamFetch(events) });
  const stream = (await ai.chat(
    { chatPrompt: [{ role: 'user', content: 'hello' }] },
    { stream: true }
  )) as ReadableStream<any>;
  let tokens: Record<string, unknown> | undefined;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    tokens = value.modelUsage?.tokens ?? tokens;
  }
  return tokens;
};

const events = (
  startUsage: Record<string, number>,
  deltaUsage: Record<string, number | null>
) => [
  {
    type: 'message_start',
    message: {
      id: 'msg_usage',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-haiku-5-5',
      stop_reason: null,
      usage: startUsage,
    },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'hi' },
  },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: deltaUsage,
  },
];

describe('AxAIAnthropic streamed usage', () => {
  it.each([
    {
      name: 'replaces earlier input and cache counts with explicit zeros',
      delta: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 7,
      },
      expected: {
        promptTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 7,
      },
    },
    {
      name: 'preserves earlier input and cache counts when the delta contains nulls',
      delta: {
        input_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        output_tokens: 7,
      },
      expected: {
        promptTokens: 50,
        cacheCreationTokens: 5,
        cacheReadTokens: 10,
        totalTokens: 72,
      },
    },
    {
      name: 'updates input tokens while preserving omitted cache counts',
      delta: { input_tokens: 80, output_tokens: 7 },
      expected: {
        promptTokens: 80,
        cacheCreationTokens: 5,
        cacheReadTokens: 10,
        totalTokens: 102,
      },
    },
  ])('$name', async ({ delta, expected }) => {
    const tokens = await streamedUsage(
      events(
        {
          input_tokens: 50,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 10,
          output_tokens: 1,
        },
        delta
      )
    );
    expect(tokens).toMatchObject({ ...expected, completionTokens: 7 });
  });

  it('takes the cumulative input and cache counts from message_delta', async () => {
    // With server tools, the final input and cache counts arrive on
    // message_delta, not on message_start.
    const tokens = await streamedUsage(
      events(
        { input_tokens: 0, output_tokens: 0 },
        {
          input_tokens: 1200,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 400,
          output_tokens: 25,
        }
      )
    );
    expect(tokens).toMatchObject({
      promptTokens: 1200,
      completionTokens: 25,
      cacheCreationTokens: 30,
      cacheReadTokens: 400,
      totalTokens: 1655,
    });
  });

  it('keeps the message_start counts when message_delta carries only output tokens', async () => {
    const tokens = await streamedUsage(
      events(
        {
          input_tokens: 50,
          cache_read_input_tokens: 10,
          output_tokens: 1,
        },
        { output_tokens: 7 }
      )
    );
    expect(tokens).toMatchObject({
      promptTokens: 50,
      completionTokens: 7,
      cacheReadTokens: 10,
      totalTokens: 67,
    });
  });
});
