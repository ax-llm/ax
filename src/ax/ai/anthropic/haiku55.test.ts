import { describe, expect, it, vi } from 'vitest';

import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import type { AxChatResponse } from '../types.js';
import { ai } from '../wrap.js';
import {
  type AxAIAnthropicChatRequest,
  type AxAIAnthropicEffortLevel,
  AxAIAnthropicModel,
} from './types.js';

const model = AxAIAnthropicModel.Claude55Haiku;
const prompt = [{ role: 'user' as const, content: 'Weather in Paris?' }];
const weather = {
  name: 'getWeather',
  description: 'Get weather for a city',
  parameters: {
    type: 'object' as const,
    properties: { city: { type: 'string' as const } },
    required: ['city'],
  },
};
const signed = { type: 'thinking', thinking: '', signature: 'signed-haiku' };
const toolUse = {
  type: 'tool_use',
  id: 'call_weather',
  name: weather.name,
  input: { city: 'Paris' },
};
const response = (content: unknown[] = [{ type: 'text', text: 'Sunny' }]) => ({
  id: 'msg_haiku55',
  type: 'message',
  role: 'assistant',
  model,
  content,
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 10 },
});

function setup({
  vertex = false,
  effort,
  modelId = model,
  responses = [response()],
}: {
  vertex?: boolean;
  effort?: AxAIAnthropicEffortLevel;
  modelId?: string;
  responses?: unknown[];
} = {}) {
  const bodies: AxAIAnthropicChatRequest[] = [];
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as AxAIAnthropicChatRequest);
    const reply = responses[Math.min(bodies.length - 1, responses.length - 1)];
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const llm = ai({
    name: 'anthropic',
    apiKey: vertex ? async () => 'vertex-token' : 'key',
    ...(vertex ? { projectId: 'demo-project', region: 'global' } : {}),
    config: {
      model: modelId as AxAIAnthropicModel,
      ...(effort ? { effort } : {}),
    },
    options: { fetch },
  });
  return { llm, bodies, fetch };
}

describe('Haiku 5.5', () => {
  describe.each([false, true])('Vertex=%s', (vertex) => {
    it('retains provider defaults when thinking is unspecified', async () => {
      const { llm, bodies } = setup({ vertex });
      await llm.chat({ chatPrompt: prompt }, { stream: false });
      expect(bodies[0]?.thinking).toBeUndefined();
      expect(bodies[0]?.output_config).toBeUndefined();
      expect(bodies[0]?.temperature).toBeUndefined();
    });

    it.each([undefined, 'low', 'medium', 'high'] as const)(
      'disables thinking at effort %s',
      async (effort) => {
        const { llm, bodies } = setup({ vertex, effort });
        await llm.chat(
          { chatPrompt: prompt },
          { stream: false, thinkingTokenBudget: 'none' }
        );
        expect(bodies[0]?.thinking).toEqual({ type: 'disabled' });
        expect(bodies[0]?.output_config).toEqual(
          effort ? { effort } : undefined
        );
      }
    );

    it.each(['xhigh', 'max'] as const)(
      'rejects disabled thinking at effort %s before transport',
      async (effort) => {
        const { llm, fetch } = setup({ vertex, effort });
        await expect(
          llm.chat(
            { chatPrompt: prompt },
            { stream: false, thinkingTokenBudget: 'none' }
          )
        ).rejects.toThrow(/cannot disable thinking/);
        expect(fetch).not.toHaveBeenCalled();
      }
    );

    it('lets per-request effort override provider effort', async () => {
      const { llm, bodies } = setup({ vertex, effort: 'max' });
      await llm.chat(
        { chatPrompt: prompt, modelConfig: { effort: 'medium' } },
        { stream: false, thinkingTokenBudget: 'none' }
      );
      expect(bodies[0]?.output_config).toEqual({ effort: 'medium' });
    });

    it.each([
      ['minimal', 'low'],
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
      ['highest', 'max'],
    ] as const)('maps %s to adaptive effort %s', async (budget, effort) => {
      const { llm, bodies } = setup({ vertex });
      await llm.chat(
        { chatPrompt: prompt },
        { stream: false, thinkingTokenBudget: budget, showThoughts: false }
      );
      expect(bodies[0]?.thinking).toEqual({
        type: 'adaptive',
        display: 'omitted',
      });
      expect(bodies[0]?.output_config).toEqual({ effort });
    });

    it('requests summarized thoughts and omits unsupported sampling', async () => {
      const { llm, bodies } = setup({ vertex });
      await llm.chat(
        {
          chatPrompt: prompt,
          modelConfig: { temperature: 0.5, topP: 0.5, topK: 10 },
        },
        { stream: false, thinkingTokenBudget: 'medium', showThoughts: true }
      );
      expect(bodies[0]?.thinking).toEqual({
        type: 'adaptive',
        display: 'summarized',
      });
      expect(bodies[0]?.temperature).toBeUndefined();
      expect(bodies[0]?.top_p).toBeUndefined();
      expect(bodies[0]?.top_k).toBeUndefined();
    });

    it.each([
      'required',
      { type: 'function', function: { name: weather.name } },
    ] as const)(
      'accepts forced tool choice %o with adaptive thinking',
      async (functionCall) => {
        const { llm, bodies } = setup({ vertex });
        await llm.chat(
          { chatPrompt: prompt, functions: [weather], functionCall },
          { stream: false, thinkingTokenBudget: 'medium' }
        );
        expect(bodies[0]?.tool_choice).toEqual(
          functionCall === 'required'
            ? { type: 'any' }
            : { type: 'tool', name: weather.name }
        );
        expect(bodies[0]?.thinking?.type).toBe('adaptive');
      }
    );

    it('uses native structured output', async () => {
      const { llm, bodies } = setup({
        vertex,
        responses: [response([{ type: 'text', text: '{"answer":["Sunny"]}' }])],
      });
      const signature = f()
        .input('question', f.string())
        .output('answer', f.string().array())
        .useStructured()
        .build();
      const result = await ax(signature).forward(
        llm,
        { question: 'Weather in Paris?' },
        { stream: false }
      );
      expect(result.answer).toEqual(['Sunny']);
      expect(bodies[0]?.output_config?.format?.type).toBe('json_schema');
      expect(llm.getFeatures().structuredOutputModes).toEqual([
        'native',
        'function',
      ]);
    });

    it('replays empty signed thinking without hoisting a later system message', async () => {
      const { llm, bodies } = setup({
        vertex,
        responses: [
          { ...response([signed, toolUse]), stop_reason: 'tool_use' },
          response(),
        ],
      });
      const options = {
        stream: false,
        thinkingTokenBudget: 'medium' as const,
        showThoughts: false,
      };
      const first = (await llm.chat(
        { chatPrompt: prompt, functions: [weather] },
        options
      )) as AxChatResponse;
      const result = first.results[0];
      expect(result?.thought).toBeUndefined();
      expect(result?.thoughtBlocks).toEqual([
        { data: '', encrypted: false, signature: signed.signature },
      ]);
      await llm.chat(
        {
          functions: [weather],
          chatPrompt: [
            ...prompt,
            {
              role: 'assistant',
              functionCalls: result?.functionCalls,
              thoughtBlocks: result?.thoughtBlocks,
            },
            { role: 'function', functionId: toolUse.id, result: 'Sunny' },
            { role: 'system', content: 'Be concise from now on.' },
          ],
        },
        options
      );
      expect(bodies[1]?.system).toBeUndefined();
      expect(bodies[1]?.messages[1]?.content).toEqual([signed, toolUse]);
      expect(bodies[1]?.messages[3]).toEqual({
        role: 'system',
        content: 'Be concise from now on.',
      });
    });

    it('keeps disabled thinking on a supplied tool call', async () => {
      const { llm, bodies } = setup({ vertex });
      await llm.chat(
        {
          functions: [weather],
          chatPrompt: [
            ...prompt,
            {
              role: 'assistant',
              functionCalls: [
                {
                  id: toolUse.id,
                  type: 'function',
                  function: { name: weather.name, params: toolUse.input },
                },
              ],
            },
            { role: 'function', functionId: toolUse.id, result: 'Sunny' },
          ],
        },
        { stream: false, thinkingTokenBudget: 'none' }
      );
      expect(bodies[0]?.thinking).toEqual({ type: 'disabled' });
    });

    it('preserves streamed signatures while thoughts are hidden', async () => {
      const events = [
        { type: 'message_start', message: response([]) },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: signed.signature },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: 'Sunny' },
        },
        { type: 'content_block_stop', index: 1 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 10 },
        },
        { type: 'message_stop' },
      ];
      const { llm } = setup({
        vertex,
        responses: [
          new Response(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(''),
            { headers: { 'Content-Type': 'text/event-stream' } }
          ),
        ],
      });
      const stream = await llm.chat(
        { chatPrompt: prompt },
        { stream: true, thinkingTokenBudget: 'medium', showThoughts: false }
      );
      const blocks = [];
      for await (const chunk of stream) {
        for (const result of chunk.results) {
          expect(result.thought).toBeUndefined();
          blocks.push(...(result.thoughtBlocks ?? []));
        }
      }
      expect(blocks).toContainEqual({
        data: '',
        encrypted: false,
        signature: signed.signature,
      });
    });
  });

  it.each([
    ['publishers/anthropic/models/claude-haiku-5-5', { type: 'disabled' }],
    ['claude-haiku-5-5@20261007', { type: 'disabled' }],
    ['claude-haiku-5-50', undefined],
    ['claude-haiku-4-5', undefined],
  ])('recognizes exact model version %s', async (modelId, thinking) => {
    const { llm, bodies } = setup({ modelId });
    await llm.chat(
      { chatPrompt: prompt },
      { stream: false, thinkingTokenBudget: 'none' }
    );
    expect(bodies[0]?.thinking).toEqual(thinking);
  });

  it.each([100_000, 100_001])(
    'prices a total input of %s including cached tokens',
    (totalInput) => {
      const { llm } = setup();
      const usage = {
        ai: 'anthropic',
        model,
        tokens: {
          promptTokens: 10_000,
          cacheReadTokens: 50_000,
          cacheCreationTokens: totalInput - 60_000,
          completionTokens: 1000,
          totalTokens: totalInput + 1000,
        },
      };
      const multiplier = totalInput > 100_000 ? 5 : 1;
      expect(llm.getEstimatedCost(usage)).toBeCloseTo(
        (multiplier *
          (10_000 * 0.1 +
            50_000 * 0.01 +
            (totalInput - 60_000) * 0.125 +
            1000 * 0.5)) /
          1_000_000
      );
    }
  );
});
