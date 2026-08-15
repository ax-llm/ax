import { describe, expect, it, vi } from 'vitest';
import { AxAIDeepSeekResponses } from './responses_api.js';
import { AxAIDeepSeekModel } from './types.js';

const responseWithToolCall = {
  id: 'resp-1',
  object: 'response',
  created: 0,
  model: AxAIDeepSeekModel.DeepSeekV4Flash,
  output: [
    {
      type: 'reasoning',
      id: 'reasoning-1',
      content: 'Use the warehouse tool.',
      status: 'completed',
    },
    {
      type: 'function_call',
      id: 'item-1',
      call_id: 'call-1',
      name: 'query',
      arguments: '{"region":"East"}',
      status: 'completed',
    },
  ],
  usage: {
    input_tokens: 10,
    output_tokens: 4,
    total_tokens: 14,
    output_tokens_details: { reasoning_tokens: 2 },
  },
};

describe('DeepSeek Responses compatibility', () => {
  it('uses /responses and replays plain-text reasoning before tool items', async () => {
    const capture: { body?: Record<string, any>; url?: string } = {};
    const ai = new AxAIDeepSeekResponses({
      apiKey: 'key',
      config: {
        model: AxAIDeepSeekModel.DeepSeekV4Pro,
        stream: false,
        reasoningEffort: 'high',
        reasoningSummary: 'detailed',
        store: true,
        parallelToolCalls: true,
      },
    });
    ai.setOptions({
      fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        capture.url = String(url);
        capture.body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(responseWithToolCall), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    });

    const response = await ai.chat(
      {
        model: AxAIDeepSeekModel.DeepSeekV4Pro,
        chatPrompt: [
          { role: 'user', content: 'Find East sales.' },
          {
            role: 'assistant',
            thought: 'Use the warehouse tool.',
            functionCalls: [
              {
                id: 'call-0',
                type: 'function',
                function: { name: 'query', params: '{"region":"North"}' },
              },
            ],
          },
          { role: 'function', functionId: 'call-0', result: '{"ok":true}' },
        ],
        functions: [
          {
            name: 'query',
            description: 'Query warehouse',
            parameters: { type: 'object' },
          },
        ],
      },
      { stream: false }
    );

    expect(capture.url).toBe('https://api.deepseek.com/responses');
    expect(capture.body?.store).toBeUndefined();
    expect(capture.body?.include).toBeUndefined();
    expect(capture.body?.previous_response_id).toBeUndefined();
    expect(capture.body?.parallel_tool_calls).toBeUndefined();
    expect(capture.body?.reasoning).toEqual({ effort: 'high' });
    expect(capture.body?.input?.map((item: any) => item.type)).toEqual([
      'message',
      'reasoning',
      'function_call',
      'function_call_output',
    ]);
    expect(capture.body?.input?.[1]).toEqual({
      type: 'reasoning',
      content: 'Use the warehouse tool.',
    });
    expect(response.results[0]).toMatchObject({
      thought: 'Use the warehouse tool.',
      functionCalls: [
        {
          id: 'call-1',
          function: { name: 'query', params: '{"region":"East"}' },
        },
      ],
      finishReason: 'function_call',
    });
  });
});
