import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDroppedSamplingWarnings } from '../base.js';
import type { AxAIServiceOptions, AxModelConfig } from '../types.js';
import { ai } from '../wrap.js';
import { AxAIOpenAIModel } from './chat_types.js';

// Sampling support follows OpenAI's live behavior (probed 2026-09-27):
// gpt-5, gpt-5-mini, gpt-5-nano and the o-series reject temperature, top_p
// and the presence/frequency penalties at every reasoning effort; GPT-5.1,
// 5.2 and 5.4 accept them at effort `none`, their default; GPT-5.5 and 5.6
// accept them only when a request sets effort `none`. Every model accepts n
// and a token limit.

type Captured = Record<string, unknown>;

const chatCompletion = (model: string) =>
  Response.json({
    id: 'c1',
    object: 'chat.completion',
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

const responsesCompletion = (model: string) =>
  Response.json({
    id: 'resp_1',
    model,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    output: [
      {
        id: 'msg_1',
        type: 'message',
        content: [{ type: 'output_text', text: 'ok', annotations: [] }],
      },
    ],
  });

async function send({
  name = 'openai',
  model,
  config = {},
  modelConfig = {},
  options,
}: {
  name?: 'openai' | 'openai-responses';
  model: string;
  config?: Record<string, unknown>;
  modelConfig?: AxModelConfig;
  options?: AxAIServiceOptions;
}): Promise<Captured> {
  let body: Captured | undefined;
  const llm = ai({
    name,
    apiKey: 'test-key',
    config: { model, ...config },
    options: {
      fetch: async (_url: unknown, init?: RequestInit) => {
        body ??= JSON.parse(String(init?.body));
        return name === 'openai'
          ? chatCompletion(model)
          : responsesCompletion(model);
      },
    },
  } as never);
  await llm.chat(
    {
      chatPrompt: [{ role: 'user', content: 'Hi' }],
      modelConfig: { stream: false, ...modelConfig },
    },
    options
  );
  return body!;
}

describe('OpenAI sampling support', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDroppedSamplingWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('never sends the default temperature to a model with sampling limits', async () => {
    for (const model of ['gpt-5.4-mini', 'gpt-5.6-luna', 'gpt-5-mini', 'o3']) {
      const body = await send({ model });
      expect(body).not.toHaveProperty('temperature');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends an explicit temperature to GPT-5.4 mini, which does not reason by default', async () => {
    const aiLevel = await send({
      model: 'gpt-5.4-mini',
      config: { temperature: 0.7, topP: 0.9 },
    });
    expect(aiLevel).toMatchObject({ temperature: 0.7, top_p: 0.9 });

    const perCall = await send({
      model: 'gpt-5.4-mini',
      modelConfig: {
        temperature: 0.5,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
      },
    });
    expect(perCall).toMatchObject({
      temperature: 0.5,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops an explicit temperature while GPT-5.4 mini reasons, with one warning', async () => {
    for (let i = 0; i < 2; i++) {
      const body = await send({
        model: 'gpt-5.4-mini',
        modelConfig: { temperature: 0.5 },
        options: { thinkingTokenBudget: 'low' },
      });
      expect(body).not.toHaveProperty('temperature');
      expect(body).toHaveProperty('reasoning_effort');
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for gpt-5.4-mini: the model accepts it only as 1 or with reasoning effort none.'
    );
  });

  it('sends GPT-5.6 Luna an explicit temperature only with reasoning effort none', async () => {
    const reasoning = await send({
      model: 'gpt-5.6-luna',
      modelConfig: { temperature: 0.5 },
    });
    expect(reasoning).not.toHaveProperty('temperature');
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for gpt-5.6-luna: the model accepts it only as 1 or with reasoning effort none.'
    );

    const off = await send({
      model: 'gpt-5.6-luna',
      modelConfig: { temperature: 0.5 },
      options: { thinkingTokenBudget: 'none' },
    });
    expect(off).toMatchObject({ temperature: 0.5, reasoning_effort: 'none' });

    const configured = await send({
      model: 'gpt-5.6-luna',
      config: { temperature: 0.3, reasoningEffort: 'none' },
    });
    expect(configured).toMatchObject({
      temperature: 0.3,
      reasoning_effort: 'none',
    });
  });

  it('drops explicit penalties GPT-5 mini never accepts', async () => {
    const body = await send({
      model: 'gpt-5-mini',
      modelConfig: { presencePenalty: 0.1, frequencyPenalty: 0.2, n: 2 },
    });
    expect(body).not.toHaveProperty('presence_penalty');
    expect(body).not.toHaveProperty('frequency_penalty');
    expect(body).toMatchObject({ n: 2 });
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped presencePenalty for gpt-5-mini: the model does not accept it.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped frequencyPenalty for gpt-5-mini: the model does not accept it.'
    );
  });

  it('sends the o-series a token limit and n, and drops sampling it rejects', async () => {
    const body = await send({
      model: 'o3',
      modelConfig: { maxTokens: 300, n: 2, temperature: 0.5 },
    });
    expect(body).toMatchObject({ max_completion_tokens: 300, n: 2 });
    expect(body).not.toHaveProperty('temperature');
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for o3: the model accepts it only as 1.'
    );
  });

  it('treats a model key config as explicit', async () => {
    let body: Captured | undefined;
    const llm = ai({
      name: 'openai',
      apiKey: 'test-key',
      config: { model: AxAIOpenAIModel.GPT54Mini },
      models: [
        {
          key: 'precise',
          model: AxAIOpenAIModel.GPT54Mini,
          description: 'Precise',
          modelConfig: { temperature: 0.2 },
        },
      ],
      options: {
        fetch: async (_url: unknown, init?: RequestInit) => {
          body ??= JSON.parse(String(init?.body));
          return chatCompletion('gpt-5.4-mini');
        },
      },
    });
    await llm.chat({
      model: 'precise',
      chatPrompt: [{ role: 'user', content: 'Hi' }],
      modelConfig: { stream: false },
    });
    expect(body).toMatchObject({ temperature: 0.2 });
  });

  it('keeps sampling off o-series deployments on a profile without model info', async () => {
    const bodies: Captured[] = [];
    const llm = ai({
      name: 'azure-openai',
      apiKey: 'test-key',
      resourceName: 'https://example.openai.azure.com/',
      deploymentName: 'o3-mini',
      version: '2024-10-21',
      config: { model: 'o3-mini' },
      options: {
        fetch: async (_url: unknown, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return chatCompletion('o3-mini');
        },
      },
    } as never);
    await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Hi' }],
      modelConfig: { stream: false },
    });
    // The profile's default temperature never reaches the model.
    expect(bodies[0]).not.toHaveProperty('temperature');
    expect(warn).not.toHaveBeenCalled();

    await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Hi' }],
      modelConfig: { stream: false, temperature: 0.5, maxTokens: 300, n: 2 },
    });
    expect(bodies[1]).not.toHaveProperty('temperature');
    expect(bodies[1]).toMatchObject({ max_completion_tokens: 300, n: 2 });
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for o3-mini: the model accepts it only as 1.'
    );
  });

  it('applies the same support on the Responses API', async () => {
    const off = await send({
      name: 'openai-responses',
      model: 'gpt-5.6-luna',
      modelConfig: { temperature: 0.5 },
      options: { thinkingTokenBudget: 'none' },
    });
    expect(off).toMatchObject({
      temperature: 0.5,
      reasoning: { effort: 'none' },
    });

    const o3 = await send({
      name: 'openai-responses',
      model: 'o3',
      modelConfig: { maxTokens: 300, temperature: 0.5 },
    });
    expect(o3).toMatchObject({ max_output_tokens: 300 });
    expect(o3).not.toHaveProperty('temperature');

    // The Responses class defaults (temperature 0.7, topP 1) are defaults:
    // never sent where the model limits sampling, and never warned about.
    warn.mockClear();
    const defaults = await send({
      name: 'openai-responses',
      model: 'gpt-5.4-mini',
    });
    expect(defaults).not.toHaveProperty('temperature');
    expect(defaults).not.toHaveProperty('top_p');
    expect(warn).not.toHaveBeenCalled();
  });
});
