import { describe, expect, it, vi } from 'vitest';

import { AxAIOpenAIModel } from '../openai/chat_types.js';
import type { AxModelConfig } from '../types.js';
import { ai } from '../wrap.js';
import { AxAIDeepSeekModel } from './types.js';

type Body = Record<string, unknown>;

const jsonResponse = (model: string) =>
  new Response(
    JSON.stringify({
      id: 'chat-1',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'OK' },
          finish_reason: 'stop',
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );

const streamResponse = (model: string) => {
  const encoder = new TextEncoder();
  const chunk = {
    id: 'chat-stream',
    model,
    choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }],
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  );
};

// Sends one chat request through the public `ai()` factory and returns the
// JSON body that reached the wire.
const send = async (args: {
  name: 'deepseek' | 'openai';
  model: string;
  stream: boolean;
  config?: { maxTokens?: number };
  modelConfig?: AxModelConfig;
}): Promise<Body> => {
  let body: Body | undefined;
  const llm = ai({
    name: args.name,
    apiKey: 'key',
    config: { model: args.model as never, ...args.config },
  });
  llm.setOptions({
    fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Body;
      return args.stream
        ? streamResponse(args.model)
        : jsonResponse(args.model);
    }),
  });

  const res = await llm.chat(
    {
      chatPrompt: [{ role: 'user', content: 'Reply only with OK.' }],
      ...(args.modelConfig ? { modelConfig: args.modelConfig } : {}),
    },
    { stream: args.stream }
  );
  if (res instanceof ReadableStream) {
    const reader = res.getReader();
    while (!(await reader.read()).done) {
      // Drain so the request completes.
    }
  }
  if (!body) throw new Error('No request was sent');
  return body;
};

// DeepSeek's chat-completions API documents and enforces only `max_tokens`.
// It accepts `max_completion_tokens` without an error and ignores it, so a
// request that carries the OpenAI field has no output cap at all.
describe('DeepSeek output token limit', () => {
  const models = [
    AxAIDeepSeekModel.DeepSeekV4Flash,
    AxAIDeepSeekModel.DeepSeekV4Pro,
  ];

  for (const model of models) {
    for (const stream of [false, true]) {
      const mode = stream ? 'streaming' : 'non-streaming';

      it(`sends modelConfig.maxTokens as max_tokens for ${model} (${mode})`, async () => {
        const body = await send({
          name: 'deepseek',
          model,
          stream,
          modelConfig: { maxTokens: 1 },
        });

        expect(body.max_tokens).toBe(1);
        expect(body).not.toHaveProperty('max_completion_tokens');
        expect(Boolean(body.stream)).toBe(stream);
      });
    }
  }

  it('sends the configured maxTokens as max_tokens', async () => {
    const body = await send({
      name: 'deepseek',
      model: AxAIDeepSeekModel.DeepSeekV4Flash,
      stream: false,
      config: { maxTokens: 321 },
    });

    expect(body.max_tokens).toBe(321);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('sends no token limit when none is set', async () => {
    const body = await send({
      name: 'deepseek',
      model: AxAIDeepSeekModel.DeepSeekV4Flash,
      stream: false,
    });

    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  for (const stream of [false, true]) {
    const mode = stream ? 'streaming' : 'non-streaming';

    it(`leaves OpenAI on max_completion_tokens (${mode})`, async () => {
      const body = await send({
        name: 'openai',
        model: AxAIOpenAIModel.GPT54Mini,
        stream,
        modelConfig: { maxTokens: 1 },
      });

      expect(body.max_completion_tokens).toBe(1);
      expect(body).not.toHaveProperty('max_tokens');
    });
  }
});
