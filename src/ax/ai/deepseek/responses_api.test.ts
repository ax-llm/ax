import { describe, expect, it, vi } from 'vitest';
import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import { AxAIOpenAIResponsesProfile } from '../provider_profiles.js';
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
  it('advertises native structured outputs as unsupported', () => {
    const ai = new AxAIOpenAIResponsesProfile({
      name: 'deepseek-responses',
      apiKey: 'key',
    });

    expect(
      ai.getFeatures(AxAIDeepSeekModel.DeepSeekV4Flash).structuredOutputs
    ).toBe(false);
  });

  it('uses AxGen function fallback instead of schema response format', async () => {
    const sig = f()
      .input('question', f.string())
      .output(
        'user',
        f.object({
          name: f.string(),
          age: f.number(),
        })
      )
      .build();
    const gen = ax(sig);
    const ai = new AxAIOpenAIResponsesProfile({
      name: 'deepseek-responses',
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: false },
    });
    const capture: { body?: Record<string, any> } = {};

    ai.setOptions({
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        capture.body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'resp-structured-fallback',
            object: 'response',
            created: 0,
            model: AxAIDeepSeekModel.DeepSeekV4Flash,
            output: [
              {
                type: 'function_call',
                id: 'item-final',
                call_id: 'call-final',
                name: '__axOutput',
                arguments: JSON.stringify({
                  user: { name: 'Alice', age: 30 },
                }),
                status: 'completed',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }),
    });

    const result = await gen.forward(
      ai,
      { question: 'Who is Alice?' },
      { stream: false, maxRetries: 0 }
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(capture.body?.text).toBeUndefined();
    expect(capture.body?.response_format).toBeUndefined();
    expect(capture.body?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '__axOutput' })])
    );
  });

  it('uses /responses and replays plain-text reasoning before tool items', async () => {
    const capture: { body?: Record<string, any>; url?: string } = {};
    const ai = new AxAIOpenAIResponsesProfile({
      name: 'deepseek-responses',
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
