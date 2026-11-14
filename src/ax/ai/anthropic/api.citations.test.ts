import { describe, expect, it, vi } from 'vitest';
import { AxAIAnthropic } from './api.js';
import { AxAIAnthropicModel } from './types.js';

// Builds a non-streaming Anthropic response whose text block carries citations.
const jsonFetch = (content: readonly unknown[]) =>
  vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content,
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
  );

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

const makeAI = () =>
  new AxAIAnthropic({
    apiKey: 'key',
    config: { model: AxAIAnthropicModel.Claude55Haiku },
  });

const charLocation = {
  type: 'char_location',
  cited_text: 'the exact sentence',
  document_index: 0,
  document_title: 'discharge-summary.pdf',
  start_char_index: 120,
  end_char_index: 139,
};

const pageLocation = {
  type: 'page_location',
  cited_text: 'a page span',
  document_index: 1,
  document_title: 'labs.pdf',
  start_page_number: 2,
  end_page_number: 3,
};

const contentBlockLocation = {
  type: 'content_block_location',
  cited_text: 'a block span',
  document_index: 1,
  document_title: 'labs.pdf',
  start_block_index: 4,
  end_block_index: 6,
};

const urlCitation = {
  type: 'web_search_result_location',
  url: 'https://example.test/article',
  title: 'Article',
  cited_text: 'quoted from the web',
};

describe('AxAIAnthropic citations', () => {
  it('keeps document citations instead of dropping them for lacking a url', async () => {
    const ai = makeAI();
    ai.setOptions({
      fetch: jsonFetch([
        {
          type: 'text',
          text: 'Answer with evidence.',
          citations: [
            charLocation,
            pageLocation,
            contentBlockLocation,
            urlCitation,
          ],
        },
      ]),
    });

    const res = await ai.chat(
      {
        model: 'fast',
        chatPrompt: [{ role: 'user', content: 'question' }],
      },
      { stream: false }
    );

    const citations = res.results[0]?.citations ?? [];
    expect(citations).toHaveLength(4);

    expect(citations[0]).toEqual({
      type: 'char_location',
      snippet: 'the exact sentence',
      documentIndex: 0,
      documentTitle: 'discharge-summary.pdf',
      startCharIndex: 120,
      endCharIndex: 139,
    });
    expect(citations[1]).toEqual({
      type: 'page_location',
      snippet: 'a page span',
      documentIndex: 1,
      documentTitle: 'labs.pdf',
      startPageNumber: 2,
      endPageNumber: 3,
    });
    expect(citations[2]).toEqual({
      type: 'content_block_location',
      snippet: 'a block span',
      documentIndex: 1,
      documentTitle: 'labs.pdf',
      startBlockIndex: 4,
      endBlockIndex: 6,
    });
    // URL citations keep working exactly as before.
    expect(citations[3]).toEqual({
      url: 'https://example.test/article',
      title: 'Article',
      snippet: 'quoted from the web',
    });
  });

  it('keeps document citations announced at content_block_start while streaming', async () => {
    const ai = makeAI();
    ai.setOptions({
      fetch: streamFetch([
        {
          type: 'message_start',
          message: {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'text',
            text: '',
            citations: [charLocation],
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Answer' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 2 },
        },
        { type: 'message_stop' },
      ]),
    });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'question' }] },
      { stream: true }
    )) as ReadableStream<any>;

    const citations: any[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const result of value?.results ?? []) {
        if (Array.isArray(result.citations))
          citations.push(...result.citations);
      }
    }

    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({
      type: 'char_location',
      snippet: 'the exact sentence',
      documentIndex: 0,
      documentTitle: 'discharge-summary.pdf',
      startCharIndex: 120,
      endCharIndex: 139,
    });
  });

  it('keeps a document citation streamed as citations_delta', async () => {
    const ai = makeAI();
    ai.setOptions({
      fetch: streamFetch([
        {
          type: 'message_start',
          message: {
            id: 'msg_3',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'citations_delta', citation: pageLocation },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Answer' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 2 },
        },
        { type: 'message_stop' },
      ]),
    });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'question' }] },
      { stream: true }
    )) as ReadableStream<any>;

    const citations: any[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const result of value?.results ?? []) {
        if (Array.isArray(result.citations))
          citations.push(...result.citations);
      }
    }

    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual({
      type: 'page_location',
      snippet: 'a page span',
      documentIndex: 1,
      documentTitle: 'labs.pdf',
      startPageNumber: 2,
      endPageNumber: 3,
    });
  });
});
