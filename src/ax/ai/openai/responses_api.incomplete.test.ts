import { describe, expect, it } from 'vitest';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type { AxAIOpenAIResponsesResponse } from './responses_types.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const config = {
  model: AxAIOpenAIResponsesModel.GPT61Sol,
  maxTokens: 16,
  stream: false,
} as any;

const usage = {
  input_tokens: 11,
  output_tokens: 16,
  total_tokens: 27,
};

function incompleteResponse(reason: string): AxAIOpenAIResponsesResponse {
  return {
    id: 'res_incomplete',
    status: 'incomplete',
    incomplete_details: { reason },
    usage,
    output: [
      {
        type: 'message',
        id: 'msg_1',
        status: 'incomplete',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'partial answer' }],
      },
    ],
  } as unknown as AxAIOpenAIResponsesResponse;
}

describe('Responses API incomplete responses', () => {
  it('keeps completed responses without a message status as a normal stop', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, false);
    const response = incompleteResponse('max_output_tokens');
    const { status: _status, ...message } = response.output![0]!;
    const result = impl.createChatResp({
      ...response,
      status: 'completed',
      incomplete_details: null,
      output: [message],
    } as AxAIOpenAIResponsesResponse);
    expect(result.results[0]?.finishReason).toBe('stop');
  });

  it('reports a token limit even when no message was produced', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, false);
    const result = impl.createChatResp({
      ...incompleteResponse('max_output_tokens'),
      output: [],
    });
    expect(result.results[0]?.finishReason).toBe('length');
    expect(impl.getTokenUsage()?.totalTokens).toBe(27);
  });

  it('uses the terminal incomplete status after an earlier completed message', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, false);
    const response = incompleteResponse('max_output_tokens');
    const result = impl.createChatResp({
      ...response,
      output: response.output!.map((item) => ({
        ...item,
        status: 'completed',
      })),
    } as AxAIOpenAIResponsesResponse);
    expect(result.results[0]?.finishReason).toBe('length');
  });

  it('reports a response cut by max_output_tokens as length, not content_filter', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, false);
    const result = impl.createChatResp(incompleteResponse('max_output_tokens'));
    expect(result.results[0]?.finishReason).toBe('length');
  });

  it('reports a response stopped by the content filter as content_filter', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, false);
    const result = impl.createChatResp(incompleteResponse('content_filter'));
    expect(result.results[0]?.finishReason).toBe('content_filter');
  });

  it('records usage from a streamed response.incomplete event', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);
    impl.createChatStreamResp(
      {
        type: 'response.incomplete',
        sequence_number: 9,
        response: {
          id: 'res_stream',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage,
        },
      } as any,
      {}
    );
    expect(impl.getTokenUsage()?.completionTokens).toBe(16);
  });

  it('reports a streamed content-filter stop as content_filter', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);
    const result = impl.createChatStreamResp(
      {
        type: 'response.incomplete',
        sequence_number: 9,
        response: {
          id: 'res_stream',
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          usage,
        },
      } as any,
      {}
    );
    expect(result.results[0]?.finishReason).toBe('content_filter');
  });

  it('keeps length for a streamed max_output_tokens stop', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);
    const result = impl.createChatStreamResp(
      {
        type: 'response.incomplete',
        sequence_number: 9,
        response: {
          id: 'res_stream',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage,
        },
      } as any,
      {}
    );
    expect(result.results[0]?.finishReason).toBe('length');
  });
});
