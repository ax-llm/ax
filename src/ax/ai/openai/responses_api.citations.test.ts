import { describe, expect, it } from 'vitest';
import type { AxChatResponse } from '../types.js';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type {
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesResponseDelta,
} from './responses_types.js';

const config = {
  maxTokens: 1,
  stream: false,
} as unknown as Parameters<
  ConstructorParameters<typeof AxAIOpenAIResponsesImpl>[0]
>[0];

describe('OpenAI Responses annotation mapping', () => {
  it('non-streaming: maps output_text.annotations url_citation to result.annotations', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    const resp = {
      id: 'res1',
      output: [
        {
          type: 'message',
          id: 'msg1',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'foo bar',
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://openai.com',
                  title: 'OpenAI',
                },
              ],
            },
          ],
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as unknown as AxAIOpenAIResponsesResponse;

    const out = impl.createChatResp(resp) as AxChatResponse;
    expect(out.results[0]!.citations).toBeDefined();
    const urls = out.results[0]!.citations!.map((a) => a.url);
    expect(urls).toEqual(['https://openai.com']);
  });

  it('streaming: maps response.output_item.added message content annotations', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    const event = {
      type: 'response.output_item.added',
      response: { id: 'res2' },
      item: {
        id: 'msg2',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'hello',
            annotations: [
              {
                type: 'url_citation',
                url: 'https://example.com',
                title: 'Example',
              },
            ],
          },
        ],
      },
    } as unknown as AxAIOpenAIResponsesResponseDelta;

    const out = impl.createChatStreamResp(event) as AxChatResponse;
    expect(out.results[0]!.citations).toBeDefined();
    const urls = out.results[0]!.citations!.map((a) => a.url);
    expect(urls).toEqual(['https://example.com']);
  });
});
