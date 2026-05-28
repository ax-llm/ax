import { describe, expect, it } from 'vitest';
import type { AxChatResponse } from '../types.js';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type {
  AxAIOpenAIResponsesResponse,
  OpenAIResponsesResponseDelta,
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
    } as unknown as OpenAIResponsesResponseDelta;

    const out = impl.createChatStreamResp(event, {}) as AxChatResponse;
    expect(out.results[0]!.citations).toBeDefined();
    const urls = out.results[0]!.citations!.map((a) => a.url);
    expect(urls).toEqual(['https://example.com']);
  });
});

describe('OpenAI Responses usage normalization', () => {
  it('normalizes current Responses usage details', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    impl.createChatResp({
      id: 'res_usage',
      object: 'response',
      created: 1,
      model: 'gpt-5-mini',
      output: [],
      usage: {
        input_tokens: 120,
        output_tokens: 9,
        total_tokens: 129,
        input_tokens_details: { cached_tokens: 50 },
        output_tokens_details: { reasoning_tokens: 4 },
      },
    } as unknown as AxAIOpenAIResponsesResponse);

    expect(impl.getTokenUsage()).toEqual({
      promptTokens: 70,
      completionTokens: 9,
      totalTokens: 129,
      reasoningTokens: 4,
      cacheReadTokens: 50,
    });
  });

  it('keeps legacy Responses usage aliases working', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    impl.createChatResp({
      id: 'res_legacy_usage',
      object: 'response',
      created: 1,
      model: 'gpt-4o',
      output: [],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 3,
        total_tokens: 23,
      },
    } as unknown as AxAIOpenAIResponsesResponse);

    expect(impl.getTokenUsage()).toEqual({
      promptTokens: 20,
      completionTokens: 3,
      totalTokens: 23,
    });
  });

  it('normalizes streamed Responses completion usage', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    impl.createChatStreamResp(
      {
        type: 'response.completed',
        sequence_number: 1,
        response: {
          id: 'res_stream_usage',
          object: 'response',
          created: 1,
          model: 'gpt-5-mini',
          output: [],
          usage: {
            input_tokens: 50,
            output_tokens: 7,
            total_tokens: 57,
            input_tokens_details: { cached_tokens: 10 },
          },
        },
      } as unknown as OpenAIResponsesResponseDelta,
      {}
    );

    expect(impl.getTokenUsage()).toEqual({
      promptTokens: 40,
      completionTokens: 7,
      totalTokens: 57,
      cacheReadTokens: 10,
    });
  });

  it('persists streamed response ids across later events', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);
    const state = {};

    const created = impl.createChatStreamResp(
      {
        type: 'response.created',
        sequence_number: 1,
        response: { id: 'res_persist' },
      } as unknown as OpenAIResponsesResponseDelta,
      state
    ) as AxChatResponse;
    const delta = impl.createChatStreamResp(
      {
        type: 'response.output_text.delta',
        sequence_number: 2,
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: 'hello',
      } as unknown as OpenAIResponsesResponseDelta,
      state
    ) as AxChatResponse;

    expect(created.remoteId).toBe('res_persist');
    expect(delta.remoteId).toBe('res_persist');
  });
});
