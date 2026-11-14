import { describe, expect, it, vi } from 'vitest';
import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import { AxProviderRouter } from '../router.js';
import type { AxChatResponse, AxDocumentSource } from '../types.js';
import { ai as createAI } from '../wrap.js';
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
  const document = {
    type: 'document' as const,
    source: { type: 'text' as const, data: 'The source passage.' },
    title: 'Evidence',
    context: 'Read as background',
    citations: { enabled: true },
    cache: true,
  };

  it('keeps earlier stream snapshots unchanged when later citations arrive', async () => {
    const ai = makeAI();
    ai.setOptions({
      fetch: streamFetch([
        {
          type: 'message_start',
          message: {
            id: 'snapshots',
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'text_delta', text: 'Claim' },
        },
        {
          type: 'content_block_delta',
          index: 2,
          delta: { type: 'citations_delta', citation: charLocation },
        },
        { type: 'content_block_stop', index: 2 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 1 },
        },
        { type: 'message_stop' },
      ]),
    });
    const response = await ai.chat(
      { chatPrompt: [{ role: 'user', content: [document] }] },
      { stream: true }
    );
    const chunks: AxChatResponse[] = [];
    for await (const chunk of response as ReadableStream<AxChatResponse>)
      chunks.push(chunk);
    const blocks = chunks.flatMap((chunk) =>
      chunk.results.flatMap((result) => result.textBlocks ?? [])
    );
    expect(blocks[0]).toEqual({ index: 2, text: '' });
    expect(blocks[1]).toEqual({ index: 2, text: 'Claim' });
    expect(blocks[2]).toMatchObject({
      index: 2,
      text: 'Claim',
      citations: [{ type: 'char_location', documentIndex: 0 }],
    });
  });

  it('ignores invalid citations and keeps an uploaded source identity', async () => {
    const ai = makeAI();
    ai.setOptions({
      fetch: jsonFetch([
        {
          type: 'text',
          text: 'Answer',
          citations: [
            null,
            {},
            { cited_text: 'unlocated' },
            { ...charLocation, file_id: 'file_source' },
          ],
        },
      ]),
    });
    const response = await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'Question' }] },
      { stream: false }
    );
    expect(response.results[0]?.citations).toHaveLength(1);
    expect(response.results[0]?.citations?.[0]?.fileId).toBe('file_source');
  });

  it.each([
    [
      { type: 'text', data: 'A passage' },
      { type: 'text', media_type: 'text/plain', data: 'A passage' },
    ],
    [
      { type: 'base64', mediaType: 'application/pdf', data: 'cGRm' },
      { type: 'base64', media_type: 'application/pdf', data: 'cGRm' },
    ],
    [
      { type: 'url', url: 'https://example.test/doc.pdf' },
      { type: 'url', url: 'https://example.test/doc.pdf' },
    ],
    [
      { type: 'file', fileId: 'file_test' },
      { type: 'file', file_id: 'file_test' },
    ],
    [
      {
        type: 'content',
        content: [
          { type: 'text', text: 'One' },
          { type: 'text', text: 'Two' },
        ],
      },
      {
        type: 'content',
        content: [
          { type: 'text', text: 'One' },
          { type: 'text', text: 'Two' },
        ],
      },
    ],
  ] as [AxDocumentSource, unknown][])(
    'sends document source %j with citation controls',
    async (source, expected) => {
      const ai = makeAI();
      const fetch = jsonFetch([{ type: 'text', text: 'Answer' }]);
      ai.setOptions({ fetch });
      await ai.chat(
        { chatPrompt: [{ role: 'user', content: [{ ...document, source }] }] },
        { stream: false }
      );
      const body = JSON.parse(fetch.mock.calls[0]![1].body);
      expect(body.messages[0].content[0]).toEqual({
        type: 'document',
        source: expected,
        title: 'Evidence',
        context: 'Read as background',
        citations: { enabled: true },
        cache_control: { type: 'ephemeral' },
      });
    }
  );

  it('accepts existing PDF file values and preserves citation metadata', async () => {
    const ai = makeAI();
    const fetch = jsonFetch([{ type: 'text', text: 'Answer: supported' }]);
    ai.setOptions({ fetch });
    const gen = ax(
      f().input('source', f.file()).output('answer', f.string()).build()
    );
    await gen.forward(
      ai,
      {
        source: {
          mimeType: 'application/pdf',
          data: 'cGRm',
          title: 'PDF',
          citations: { enabled: true },
        },
      },
      { stream: false }
    );
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(
      body.messages
        .at(-1)
        .content.find((part: { type: string }) => part.type === 'document')
    ).toMatchObject({
      title: 'PDF',
      citations: { enabled: true },
      source: { type: 'base64', media_type: 'application/pdf', data: 'cGRm' },
    });
  });

  it('rejects mixed citation settings across messages before transport', async () => {
    const ai = makeAI();
    const fetch = jsonFetch([]);
    ai.setOptions({ fetch });
    await expect(
      ai.chat(
        {
          chatPrompt: [
            { role: 'user', content: [document] },
            {
              role: 'user',
              content: [{ ...document, citations: { enabled: false } }],
            },
          ],
        },
        { stream: false }
      )
    ).rejects.toThrow('all documents');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects native structured output with citations before transport', async () => {
    const ai = makeAI();
    const fetch = jsonFetch([]);
    ai.setOptions({ fetch });
    const gen = ax(
      f()
        .input('source', f.file())
        .output('answer', f.string())
        .useStructured()
        .build()
    );
    await expect(
      gen.forward(ai, { source: document }, { stream: false })
    ).rejects.toThrow('cannot be combined with native structured outputs');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'text', data: '' },
    { type: 'file', fileId: '' },
    { type: 'url', url: 'file:///tmp/private' },
    { type: 'content', content: [] },
    { type: 'content', content: [{ type: 'text', text: '' }] },
    { type: 'base64', mediaType: 'image/png', data: 'abc' },
  ])(
    'rejects malformed document source %j before transport',
    async (source) => {
      const ai = makeAI();
      const fetch = jsonFetch([]);
      ai.setOptions({ fetch });
      await expect(
        ai.chat(
          {
            chatPrompt: [
              {
                role: 'user',
                content: [{ ...document, source: source as AxDocumentSource }],
              },
            ],
          },
          { stream: false }
        )
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('routes documents to Anthropic without dropping sources or citation controls', async () => {
    const anthropic = makeAI();
    const fetch = jsonFetch([{ type: 'text', text: 'Answer' }]);
    anthropic.setOptions({ fetch });
    const openai = createAI({ name: 'openai', apiKey: 'test' });
    const wrongFetch = vi.fn();
    openai.setOptions({ fetch: wrongFetch });
    const router = new AxProviderRouter({
      providers: { primary: openai, alternatives: [anthropic] },
      routing: {
        preferenceOrder: ['capability'],
        capability: { requireExactMatch: false, allowDegradation: true },
      },
      processing: {},
    });
    await router.chat(
      { chatPrompt: [{ role: 'user', content: [document] }] },
      { stream: false }
    );
    expect(wrongFetch).not.toHaveBeenCalled();
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.messages[0].content[0]).toMatchObject({
      citations: { enabled: true },
      source: { type: 'text', data: document.source.data },
    });
  });

  it('rejects native documents on an incompatible provider before transport', async () => {
    const ai = createAI({ name: 'openai', apiKey: 'test' });
    const fetch = vi.fn();
    ai.setOptions({ fetch });
    await expect(
      ai.chat(
        { chatPrompt: [{ role: 'user', content: [document] }] },
        { stream: false }
      )
    ).rejects.toThrow('does not support native document inputs and citations');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('includes legacy PDF files when validating citation settings', async () => {
    const ai = makeAI();
    const fetch = vi.fn();
    ai.setOptions({ fetch });
    await expect(
      ai.chat(
        {
          chatPrompt: [
            {
              role: 'user',
              content: [
                document,
                {
                  type: 'file',
                  mimeType: 'application/pdf',
                  data: 'cGRm',
                },
              ],
            },
          ],
        },
        { stream: false }
      )
    ).rejects.toThrow('all documents');
    expect(fetch).not.toHaveBeenCalled();
  });

  for (const stream of [false, true]) {
    it(`keeps output text associations and AxGen citations with stream=${stream}`, async () => {
      const ai = makeAI();
      const second = {
        ...charLocation,
        start_char_index: 200,
        end_char_index: 210,
        cited_text: 'other text',
      };
      const content = [
        { type: 'text', text: 'Answer: ', citations: [] },
        { type: 'text', text: 'Claim one. ', citations: [charLocation] },
        { type: 'text', text: 'Claim two.', citations: [second] },
      ];
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'msg_blocks',
            type: 'message',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        ...content.flatMap((block, index) => [
          {
            type: 'content_block_start',
            index,
            content_block: { type: 'text', text: '' },
          },
          {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: block.text },
          },
          ...block.citations.map((citation) => ({
            type: 'content_block_delta',
            index,
            delta: { type: 'citations_delta', citation },
          })),
          { type: 'content_block_stop', index },
        ]),
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 8 },
        },
        { type: 'message_stop' },
      ];
      ai.setOptions({
        fetch: stream ? streamFetch(events) : jsonFetch(content),
      });
      const gen = ax('source:file -> answer:string');
      if (stream) {
        for await (const _ of gen.streamingForward(ai, { source: document })) {
          /* consume */
        }
      } else {
        expect(
          await gen.forward(ai, { source: document }, { stream: false })
        ).toEqual({ answer: 'Claim one. Claim two.' });
      }
      const blocks = gen.getChatLog()[0]?.textBlocks;
      expect(
        blocks?.map((block) => [block.index, block.text, block.resultIndex])
      ).toEqual([
        [0, 'Answer: ', 0],
        [1, 'Claim one. ', 0],
        [2, 'Claim two.', 0],
      ]);
      expect(blocks?.[0]?.citations).toBeUndefined();
      expect(blocks?.[1]?.citations?.[0]?.startCharIndex).toBe(120);
      expect(blocks?.[2]?.citations?.[0]?.startCharIndex).toBe(200);
      expect(
        gen.getUsage()[0]?.citations?.map((citation) => citation.startCharIndex)
      ).toEqual([120, 200]);
    });
  }

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
