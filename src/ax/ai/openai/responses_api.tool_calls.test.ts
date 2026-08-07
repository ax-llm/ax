import { describe, expect, it } from 'vitest';
import type { AxChatResponse } from '../types.js';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type { AxAIOpenAIResponsesResponse } from './responses_types.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const config = {
  model: AxAIOpenAIResponsesModel.GPT55,
  maxTokens: 1,
  stream: false,
} as any;

describe('OpenAI Responses parallel tool calls (non-streaming)', () => {
  it('keeps every function_call item in the output array', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    // /v1/responses returns one output item per parallel tool call.
    const resp = {
      id: 'res_parallel',
      output: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          status: 'completed',
          name: 'getWeather',
          arguments: '{"city":"Paris"}',
        },
        {
          type: 'function_call',
          id: 'fc_2',
          call_id: 'call_2',
          status: 'completed',
          name: 'getTime',
          arguments: '{"city":"Paris"}',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as unknown as AxAIOpenAIResponsesResponse;

    const out = impl.createChatResp(resp) as AxChatResponse;
    const functionCalls = out.results[0]!.functionCalls;

    expect(functionCalls).toHaveLength(2);
    expect(functionCalls!.map((f) => f.function.name)).toEqual([
      'getWeather',
      'getTime',
    ]);
    expect(functionCalls!.map((f) => f.id)).toEqual(['fc_1', 'fc_2']);
    expect(out.results[0]!.finishReason).toBe('function_call');
  });

  it('still returns a single function_call unchanged', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    const resp = {
      id: 'res_single',
      output: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          status: 'completed',
          name: 'getWeather',
          arguments: '{"city":"Paris"}',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as unknown as AxAIOpenAIResponsesResponse;

    const out = impl.createChatResp(resp) as AxChatResponse;

    expect(out.results[0]!.functionCalls).toEqual([
      {
        id: 'fc_1',
        type: 'function',
        function: { name: 'getWeather', params: '{"city":"Paris"}' },
      },
    ]);
  });

  it('does not surface a provider-side tool call alongside a function_call', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, true);

    // Built-in tool items are mapped to synthetic function calls that the
    // caller cannot execute, so accumulating them would break the run.
    const resp = {
      id: 'res_mixed',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          queries: ['weather in Paris'],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          status: 'completed',
          name: 'getWeather',
          arguments: '{"city":"Paris"}',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as unknown as AxAIOpenAIResponsesResponse;

    const out = impl.createChatResp(resp) as AxChatResponse;
    const functionCalls = out.results[0]!.functionCalls;

    expect(functionCalls!.map((f) => f.function.name)).toEqual(['getWeather']);
  });
});
