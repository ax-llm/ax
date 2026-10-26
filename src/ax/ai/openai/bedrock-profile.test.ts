import { describe, expect, it, vi } from 'vitest';
import { ax } from '../../dsp/template.js';
import { ai } from '../wrap.js';

const apiURL = 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1';
const models = [
  'us.openai.gpt-6-sol',
  'openai.gpt-6-luna',
  'global.openai.gpt-6-astra',
  'us.openai.gpt-6.1-sol',
  'us.openai.gpt-5.6-sol',
] as const;
const tool = { name: 'lookup', description: 'Look up a record' };
const chatPrompt = [{ role: 'user' as const, content: 'hi' }];

function setup(model: string, reasoningEffort?: 'none' | 'high') {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) {
      const chunk = {
        id: 'bedrock-stream',
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    }
    return Response.json({
      id: 'bedrock-profile',
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '{"answer":{"message":"ok","code":7}}',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  const provider = ai({
    name: 'amazon-bedrock',
    apiKey: 'test',
    apiURL,
    config: {
      model,
      stream: false,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
    options: { fetch },
  });
  const payload = () => JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
  return { provider, fetch, payload };
}

describe('Bedrock OpenAI deployment model rules (#679)', () => {
  it.each(models)('maps reasoning budgets for %s', async (model) => {
    const { provider, payload } = setup(model);
    for (const [budget, effort] of [
      ['minimal', 'low'],
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
      ['highest', 'xhigh'],
    ] as const) {
      await provider.chat({ chatPrompt }, { thinkingTokenBudget: budget });
      expect(payload().reasoning_effort).toBe(effort);
      expect(payload()).not.toHaveProperty('temperature');
      expect(payload()).not.toHaveProperty('top_p');
      expect(payload()).not.toHaveProperty('stop');
    }
  });

  it.each(models)(
    'uses native schema output for AxGen on %s',
    async (model) => {
      const { provider, payload } = setup(model);
      const answer = await ax('question:string -> answer:object').forward(
        provider,
        { question: 'hi' }
      );
      expect(answer.answer).toEqual({ message: 'ok', code: 7 });
      expect(payload().response_format.type).toBe('json_schema');
      expect(payload()).not.toHaveProperty('tools');
    }
  );

  it.each(models)(
    'restricts %s to its verified service tier',
    async (model) => {
      const { provider, fetch, payload } = setup(model);
      for (const serviceTier of ['flex', 'priority'] as const) {
        await expect(
          provider.chat({ chatPrompt }, { serviceTier })
        ).rejects.toThrow(/not verified/);
      }
      expect(fetch).not.toHaveBeenCalled();
      await provider.chat({ chatPrompt }, { serviceTier: 'standard' });
      expect(payload().service_tier).toBe('default');
    }
  );

  it.each(['global.openai.gpt-6-astra', 'us.openai.gpt-6.1-sol'])(
    'rejects function tools and disabled reasoning for %s before transport',
    async (model) => {
      const { provider, fetch } = setup(model);
      await expect(
        provider.chat({ chatPrompt, functions: [tool] })
      ).rejects.toThrow(/does not permit function tools/);
      await expect(
        provider.chat({ chatPrompt }, { thinkingTokenBudget: 'none' })
      ).rejects.toThrow(/does not support disabling reasoning/);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    'us.openai.gpt-6-sol',
    'openai.gpt-6-luna',
    'us.openai.gpt-5.6-sol',
  ])(
    'requires explicitly disabled reasoning for tools on %s',
    async (model) => {
      const { provider, fetch, payload } = setup(model);
      await expect(
        provider.chat({ chatPrompt, functions: [tool] })
      ).rejects.toThrow(/only with reasoning disabled/);
      await expect(
        provider.chat(
          { chatPrompt, functions: [tool] },
          { thinkingTokenBudget: 'high' }
        )
      ).rejects.toThrow(/only with reasoning disabled/);
      expect(fetch).not.toHaveBeenCalled();
      await provider.chat(
        { chatPrompt, functions: [tool] },
        { thinkingTokenBudget: 'none' }
      );
      expect(payload().reasoning_effort).toBe('none');
      expect(payload().tools).toHaveLength(1);
      const configured = setup(model, 'none');
      await configured.provider.chat({ chatPrompt, functions: [tool] });
      expect(configured.payload().reasoning_effort).toBe('none');
    }
  );

  it.each(models)(
    'applies model rules to streamed requests for %s',
    async (model) => {
      const { provider, payload } = setup(model);
      const stream = await provider.chat(
        { chatPrompt },
        { stream: true, thinkingTokenBudget: 'low' }
      );
      const reader = stream.getReader();
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value.results[0]?.content ?? '';
      }
      expect(text).toBe('ok');
      expect(payload().reasoning_effort).toBe('low');
      expect(payload()).not.toHaveProperty('temperature');
    }
  );

  it.each([
    'us.openai.gpt-6-sol',
    'openai.gpt-6-luna',
    'us.openai.gpt-5.6-sol',
  ])(
    'supports native AxGen output together with tools on %s when reasoning is disabled',
    async (model) => {
      const { provider, payload } = setup(model);
      const program = ax('question:string -> answer:object', {
        functions: [{ ...tool, func: async () => 'record' }],
      });
      const answer = await program.forward(
        provider,
        { question: 'hi' },
        { thinkingTokenBudget: 'none' }
      );
      expect(answer.answer).toEqual({ message: 'ok', code: 7 });
      expect(payload().reasoning_effort).toBe('none');
      expect(payload().response_format.type).toBe('json_schema');
      expect(payload().tools).toHaveLength(1);
    }
  );

  it('leaves GPT-OSS and unknown model capabilities unchanged', async () => {
    const { provider, payload } = setup('openai.gpt-oss-120b-1:0');
    await provider.chat(
      { chatPrompt, functions: [tool] },
      { serviceTier: 'flex' }
    );
    expect(payload().temperature).toBe(0);
    expect(payload().service_tier).toBe('flex');
    expect(payload()).not.toHaveProperty('reasoning_effort');
    expect(provider.getFeatures('unknown-model')).toMatchObject({
      thinking: false,
      structuredOutputs: false,
    });
  });
});
