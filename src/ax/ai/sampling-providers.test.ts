import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDroppedSamplingWarnings } from './base.js';
import type { AxAIServiceOptions, AxModelConfig } from './types.js';
import { ai } from './wrap.js';

// Sampling support on Anthropic and Gemini, and temperature 1 on OpenAI, as
// the providers answered on 2026-09-27:
// - OpenAI takes temperature 1, its default, wherever it rejects other values.
// - Anthropic Opus 4.7+, Opus 5, Fable 5 and Sonnet 5 deprecated sampling:
//   only temperature 1 is accepted. The other models take every value with
//   thinking off; while thinking, only temperature 1, top_p of 0.95 or above,
//   and no top_k.
// - The Gemini API ignores temperature, topP and topK on the server-managed
//   Flash models, rejects the penalties on every probed model, and returns one
//   candidate on Gemini 3. Vertex was not probed.

type Captured = Record<string, any>;

const responses: Record<string, (model: string) => Response> = {
  openai: (model) =>
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
    }),
  anthropic: (model) =>
    Response.json({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  'google-gemini': (model) =>
    Response.json({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'ok' }] },
          finishReason: 'STOP',
        },
      ],
      modelVersion: model,
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    }),
};

async function send({
  name,
  model,
  config = {},
  modelConfig = {},
  options,
  args = {},
}: {
  name: 'openai' | 'anthropic' | 'google-gemini';
  model: string;
  config?: Record<string, unknown>;
  modelConfig?: AxModelConfig & Record<string, unknown>;
  options?: AxAIServiceOptions;
  args?: Record<string, unknown>;
}): Promise<Captured> {
  let body: Captured | undefined;
  const llm = ai({
    name,
    apiKey: 'test-key',
    ...args,
    config: { model, ...config },
    options: {
      fetch: async (_url: unknown, init?: RequestInit) => {
        body ??= JSON.parse(String(init?.body));
        return responses[name]!(model);
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

describe('provider sampling support', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDroppedSamplingWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('sends an explicit temperature 1 to OpenAI models that reject other values', async () => {
    for (const model of ['gpt-5-mini', 'o3', 'gpt-5.6-luna']) {
      const body = await send({
        name: 'openai',
        model,
        modelConfig: { temperature: 1 },
      });
      expect(body).toMatchObject({ temperature: 1 });
    }
    expect(warn).not.toHaveBeenCalled();

    const luna = await send({
      name: 'openai',
      model: 'gpt-5.6-luna',
      modelConfig: { temperature: 0.5 },
    });
    expect(luna).not.toHaveProperty('temperature');
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for gpt-5.6-luna: the model accepts it only as 1 or with reasoning effort none.'
    );
  });

  it('sends Anthropic models that deprecated sampling only temperature 1', async () => {
    const defaults = await send({
      name: 'anthropic',
      model: 'claude-sonnet-5',
    });
    expect(defaults).not.toHaveProperty('temperature');
    expect(warn).not.toHaveBeenCalled();

    const one = await send({
      name: 'anthropic',
      model: 'claude-sonnet-5',
      modelConfig: { temperature: 1 },
    });
    expect(one).toMatchObject({ temperature: 1 });

    const other = await send({
      name: 'anthropic',
      model: 'claude-sonnet-5',
      modelConfig: { temperature: 0.5, topP: 0.95, topK: 40 },
    });
    expect(other).not.toHaveProperty('temperature');
    expect(other).not.toHaveProperty('top_p');
    expect(other).not.toHaveProperty('top_k');
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for claude-sonnet-5: the model accepts it only as 1.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped topP for claude-sonnet-5: the model does not accept it.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped topK for claude-sonnet-5: the model does not accept it.'
    );
  });

  it('sends Claude Opus 4.6 explicit sampling with thinking off, and the values it takes while thinking', async () => {
    // The default temperature keeps its historical rule on adaptive models.
    const defaults = await send({
      name: 'anthropic',
      model: 'claude-opus-4-6',
    });
    expect(defaults).not.toHaveProperty('temperature');

    const off = await send({
      name: 'anthropic',
      model: 'claude-opus-4-6',
      modelConfig: { temperature: 0.5, topP: 0.9, topK: 40 },
    });
    expect(off).toMatchObject({ temperature: 0.5, top_p: 0.9, top_k: 40 });
    expect(warn).not.toHaveBeenCalled();

    const thinking = await send({
      name: 'anthropic',
      model: 'claude-opus-4-6',
      modelConfig: { temperature: 0.5, topP: 0.9, topK: 40 },
      options: { thinkingTokenBudget: 'low' },
    });
    expect(thinking).toHaveProperty('thinking');
    expect(thinking).not.toHaveProperty('temperature');
    expect(thinking).not.toHaveProperty('top_p');
    expect(thinking).not.toHaveProperty('top_k');
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped temperature for claude-opus-4-6: the model accepts it only as 1 while thinking.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped topP for claude-opus-4-6: the model accepts it only at 0.95 or above while thinking.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped topK for claude-opus-4-6: the model accepts it only with thinking off.'
    );

    const accepted = await send({
      name: 'anthropic',
      model: 'claude-opus-4-6',
      modelConfig: { temperature: 1, topP: 0.95 },
      options: { thinkingTokenBudget: 'low' },
    });
    expect(accepted).toMatchObject({ temperature: 1, top_p: 0.95 });
  });

  it('keeps the Claude Haiku 4.5 default temperature without thinking and drops it silently while thinking', async () => {
    const off = await send({ name: 'anthropic', model: 'claude-haiku-4-5' });
    expect(off).toMatchObject({ temperature: 0 });

    const thinking = await send({
      name: 'anthropic',
      model: 'claude-haiku-4-5',
      options: { thinkingTokenBudget: 'low' },
    });
    expect(thinking).not.toHaveProperty('temperature');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about the sampling Gemini ignores, rejects or Ax changes', async () => {
    const managed = await send({
      name: 'google-gemini',
      model: 'gemini-3.6-flash',
      modelConfig: { topK: 40 },
    });
    expect(managed.generationConfig).not.toHaveProperty('topK');
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped topK for gemini-3.6-flash: the model does not accept it.'
    );

    const defaults = await send({
      name: 'google-gemini',
      model: 'gemini-3.5-flash',
    });
    expect(defaults.generationConfig).toMatchObject({ temperature: 1 });
    expect(warn).toHaveBeenCalledTimes(1);

    const flash = await send({
      name: 'google-gemini',
      model: 'gemini-3.5-flash',
      modelConfig: {
        temperature: 0.2,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        n: 2,
      },
    });
    expect(flash.generationConfig).toMatchObject({
      temperature: 1,
      candidateCount: 1,
    });
    expect(flash.generationConfig).not.toHaveProperty('frequencyPenalty');
    expect(warn).toHaveBeenCalledWith(
      'Ax raised temperature 0.2 to 1 for gemini-3.5-flash: Google recommends 1.0 for Gemini 3 models.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped presencePenalty for gemini-3.5-flash: the model does not accept it.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped frequencyPenalty for gemini-3.5-flash: the model does not accept it.'
    );
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped n for gemini-3.5-flash: the model returns one candidate.'
    );

    const older = await send({
      name: 'google-gemini',
      model: 'gemini-2.5-flash',
      modelConfig: { n: 2 },
    });
    expect(older.generationConfig).toMatchObject({ candidateCount: 2 });
  });

  it('keeps the Vertex Gemini wire and warns about the penalty it never sends', async () => {
    const body = await send({
      name: 'google-gemini',
      model: 'gemini-2.5-flash',
      args: {
        apiKey: async () => 'vertex-token',
        projectId: 'demo-project',
        region: 'us-central1',
      },
      modelConfig: { presencePenalty: 0.1, frequencyPenalty: 0.2 },
    });
    expect(body.generationConfig).toMatchObject({ frequencyPenalty: 0.2 });
    expect(warn).toHaveBeenCalledWith(
      'Ax dropped presencePenalty for gemini-2.5-flash: Ax does not send it to Gemini.'
    );
  });
});
