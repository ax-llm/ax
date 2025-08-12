import { ReadableStream } from 'node:stream/web';
import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { AxGen } from './generate.js';

function createStreamingResponse(
  chunks: AxChatResponse['results'][],
  perChunkUsage: (i: number) => AxChatResponse['modelUsage']
): ReadableStream<AxChatResponse> {
  return new ReadableStream<AxChatResponse>({
    start(controller) {
      let idx = 0;
      const pump = () => {
        if (idx >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue({
          results: chunks[idx]!,
          modelUsage: perChunkUsage(idx),
        });
        idx++;
        setTimeout(pump, 1);
      };
      setTimeout(pump, 1);
    },
  });
}

describe('getUsage citations aggregation', () => {
  it('non-streaming: aggregates annotations into usage.citations and dedupes', async () => {
    const gen = new AxGen<{ userQuestion: string }, { responseText: string }>(
      'userQuestion:string -> responseText:string'
    );

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Answer',
            citations: [
              {
                url: 'https://example.com/a',
                title: 'A',
                description: 'foo',
              },
              {
                url: 'https://example.com/b',
                title: 'B',
              },
            ],
          },
          {
            index: 0,
            content: 'More',
            citations: [
              {
                url: 'https://example.com/a',
              },
            ],
          },
        ],
        modelUsage: {
          ai: 'mock-ai-service',
          model: 'mock-model',
          tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        },
      },
    });

    await gen.forward(ai as any, { userQuestion: 'hi' }, { stream: false });
    const usage = gen.getUsage();
    expect(usage).toHaveLength(1);
    const citations = usage[0]!.citations!;
    expect(citations.map((c) => c.url).sort()).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('streaming: aggregates across chunks and dedupes', async () => {
    const gen = new AxGen<{ userQuestion: string }, { responseText: string }>(
      'userQuestion:string -> responseText:string'
    );

    const chunks: AxChatResponse['results'][] = [
      [
        {
          index: 0,
          content: 'p1 ',
          citations: [{ url: 'https://example.org/1', title: 'One' }],
        },
      ],
      [
        {
          index: 0,
          content: 'p2 ',
          citations: [{ url: 'https://example.org/2', title: 'Two' }],
        },
      ],
      [
        {
          index: 0,
          content: 'p3',
          citations: [{ url: 'https://example.org/1' }],
        },
      ],
    ];

    const stream = createStreamingResponse(chunks, (i) => ({
      ai: 'mock-ai-service',
      model: 'mock-model',
      tokens: {
        promptTokens: 1 + i,
        completionTokens: 2 + i,
        totalTokens: 3 + 2 * i,
      },
    }));

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: async () => stream,
    });

    await gen.forward(ai as any, { userQuestion: 'hello' }, { stream: true });
    const usage = gen.getUsage();
    expect(usage).toHaveLength(1);
    const urls = (usage[0]!.citations ?? []).map((c) => c.url).sort();
    expect(urls).toEqual(['https://example.org/1', 'https://example.org/2']);
  });
});
