import { describe, expect, it, vi } from 'vitest';

import { ai } from '../wrap.js';

import { type AxAIWebLLMEngine, AxAIWebLLMModel } from './types.js';

const createEngine = (
  create: AxAIWebLLMEngine['chat']['completions']['create']
): AxAIWebLLMEngine => ({
  chat: {
    completions: { create },
  },
});

describe('AxAIWebLLM', () => {
  it('uses the supplied WebLLM engine for chat completions', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'webllm-response',
      object: 'chat.completion',
      created: 0,
      model: AxAIWebLLMModel.Llama32_3B_Instruct,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello from WebLLM' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
      },
    });

    const llm = ai({
      name: 'webllm',
      engine: createEngine(create),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: false,
      },
    });

    const response = await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Hello' }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      })
    );
    expect(response.results[0]?.content).toBe('Hello from WebLLM');
    expect(llm.getLastUsedChatModel()).toBe(
      AxAIWebLLMModel.Llama32_3B_Instruct
    );
  });

  it('requires a WebLLM engine instance', () => {
    expect(() =>
      ai({
        name: 'webllm',
        engine: undefined,
      })
    ).toThrow('WebLLM engine instance is required');
  });

  it('accepts custom WebLLM model ids owned by the host engine', async () => {
    const customModel = 'custom-model-q4f16_1-MLC';
    const create = vi.fn().mockResolvedValue({
      id: 'webllm-custom-response',
      object: 'chat.completion',
      created: 0,
      model: customModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'custom ok' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    });

    const llm = ai({
      name: 'webllm',
      engine: createEngine(create),
      config: { model: customModel, stream: false },
    });

    await llm.chat({ chatPrompt: [{ role: 'user', content: 'Hello' }] });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: customModel })
    );
  });

  it('defaults to prompt-mode tools unless native functions are enabled', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'webllm-prompt-tools-response',
      object: 'chat.completion',
      created: 0,
      model: AxAIWebLLMModel.Llama32_3B_Instruct,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'no native tools' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    });

    const llm = ai({
      name: 'webllm',
      engine: createEngine(create),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: false,
      },
    });

    await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Use a tool' }],
      functions: [
        {
          name: 'lookup',
          description: 'Lookup a value',
          parameters: { type: 'object', properties: {} },
        },
      ],
      functionCall: { type: 'function', function: { name: 'lookup' } },
    });

    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        tools: expect.anything(),
        tool_choice: expect.anything(),
      })
    );
  });

  it('sends native tools only when supportsFunctions is true', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'webllm-native-tools-response',
      object: 'chat.completion',
      created: 0,
      model: AxAIWebLLMModel.Llama32_3B_Instruct,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"id":1}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    });

    const llm = ai({
      name: 'webllm',
      engine: createEngine(create),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: false,
        supportsFunctions: true,
      },
    });

    const response = await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Use a tool' }],
      functions: [
        {
          name: 'lookup',
          description: 'Lookup a value',
          parameters: { type: 'object', properties: {} },
        },
      ],
      functionCall: { type: 'function', function: { name: 'lookup' } },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              description: 'Lookup a value',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'lookup' } },
      })
    );
    expect(response.results[0]?.functionCalls?.[0]?.function.name).toBe(
      'lookup'
    );
  });

  it('maps native tool-call history to OpenAI-compatible tool messages', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'webllm-tool-history-response',
      object: 'chat.completion',
      created: 0,
      model: AxAIWebLLMModel.Llama32_3B_Instruct,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'done' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    });

    const llm = ai({
      name: 'webllm',
      engine: createEngine(create),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: false,
        supportsFunctions: true,
      },
    });

    await llm.chat({
      chatPrompt: [
        { role: 'user', content: 'Use a tool' },
        {
          role: 'assistant',
          functionCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup', params: { id: 1 } },
            },
          ],
        },
        { role: 'function', functionId: 'call-1', result: '{"ok":true}' },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Use a tool' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"id":1}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
        ],
      })
    );
  });

  it('maps structured response, logprob, and streaming usage fields', async () => {
    async function* streamingChunks() {
      yield {
        id: 'webllm-mapped-stream',
        object: 'chat.completion.chunk' as const,
        created: 0,
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        choices: [
          {
            index: 0,
            delta: { content: 'ok' },
            finish_reason: 'stop' as const,
          },
        ],
      };
    }
    const response = {
      id: 'webllm-mapped-response',
      object: 'chat.completion' as const,
      created: 0,
      model: AxAIWebLLMModel.Llama32_3B_Instruct,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '{"ok":true}' },
          finish_reason: 'stop',
          logprobs: {
            content: [
              {
                token: 'ok',
                logprob: -0.1,
                bytes: [111, 107],
                top_logprobs: [
                  { token: 'ok', logprob: -0.1, bytes: [111, 107] },
                ],
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    };
    const create = vi
      .fn()
      .mockImplementation(async (request) =>
        request.stream ? streamingChunks() : response
      );

    const llm = ai({
      name: 'webllm',
      engine: createEngine(create),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: true,
        logitBias: { 42: -1 },
        logProbs: true,
        topLogprobs: 2,
      },
    });

    await llm.chat({
      chatPrompt: [{ role: 'user', content: 'JSON please' }],
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'Result', schema: { type: 'object' } },
      } as any,
      modelConfig: { stream: false },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'Result', schema: { type: 'object' } },
        },
        logit_bias: { 42: -1 },
        logprobs: true,
        top_logprobs: 2,
      })
    );

    await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Stream please' }],
      modelConfig: { stream: true },
    });

    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
      })
    );
  });

  it('accumulates streaming content and partial tool-call deltas', async () => {
    async function* chunks() {
      yield {
        id: 'webllm-stream-response',
        object: 'chat.completion.chunk' as const,
        created: 0,
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant' as const,
              content: 'Hel',
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function' as const,
                  function: { name: 'lookup', arguments: '{"id"' },
                },
              ],
            },
          },
        ],
      };
      yield {
        id: 'webllm-stream-response',
        object: 'chat.completion.chunk' as const,
        created: 0,
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        choices: [
          {
            index: 0,
            delta: {
              content: 'lo',
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':1}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          total_tokens: 3,
        },
      };
    }

    const llm = ai({
      name: 'webllm',
      engine: createEngine(vi.fn().mockResolvedValue(chunks())),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: true,
        supportsFunctions: true,
      },
    });

    const stream = (await llm.chat({
      chatPrompt: [{ role: 'user', content: 'Stream' }],
      modelConfig: { stream: true },
    })) as ReadableStream;
    const reader = stream.getReader();
    let lastChunk: Awaited<ReturnType<typeof reader.read>>['value'];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      lastChunk = next.value;
    }

    expect(lastChunk?.results[0]?.content).toBe('Hello');
    expect(lastChunk?.results[0]?.functionCalls?.[0]).toMatchObject({
      id: 'call-1',
      function: { name: 'lookup', params: '{"id":1}' },
      type: 'function',
    });
    expect(lastChunk?.results[0]?.finishReason).toBe('function_call');
  });

  it('preserves thrown engine errors as cause', async () => {
    const cause = new Error('engine failed');
    const llm = ai({
      name: 'webllm',
      engine: createEngine(vi.fn().mockRejectedValue(cause)),
      config: {
        model: AxAIWebLLMModel.Llama32_3B_Instruct,
        stream: false,
      },
    });

    await expect(
      llm.chat({ chatPrompt: [{ role: 'user', content: 'Hello' }] })
    ).rejects.toMatchObject({
      message: 'WebLLM API error: engine failed',
      cause,
    });
  });
});
