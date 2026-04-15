import { describe, expect, it } from 'vitest';
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

describe('OpenAI Responses cached token usage', () => {
  it('maps non-streaming input_tokens_details.cached_tokens to cacheReadTokens', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    const resp = {
      id: 'res1',
      output: [
        {
          type: 'message',
          id: 'msg1',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'cached reply' }],
        },
      ],
      usage: {
        input_tokens: 2006,
        output_tokens: 300,
        total_tokens: 2306,
        input_tokens_details: {
          cached_tokens: 1920,
        },
      },
    } as unknown as AxAIOpenAIResponsesResponse;

    impl.createChatResp(resp);

    expect(impl.getTokenUsage()).toEqual({
      promptTokens: 2006,
      completionTokens: 300,
      totalTokens: 2306,
      cacheReadTokens: 1920,
    });
  });

  it('maps streaming response.completed input cached tokens to cacheReadTokens', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    const event = {
      type: 'response.completed',
      response: {
        id: 'res2',
        usage: {
          input_tokens: 1500,
          output_tokens: 120,
          total_tokens: 1620,
          input_tokens_details: {
            cached_tokens: 1024,
          },
        },
      },
    } as unknown as AxAIOpenAIResponsesResponseDelta;

    impl.createChatStreamResp(event);

    expect(impl.getTokenUsage()).toEqual({
      promptTokens: 1500,
      completionTokens: 120,
      totalTokens: 1620,
      cacheReadTokens: 1024,
    });
  });
});
