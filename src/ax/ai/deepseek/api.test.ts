import { describe, expect, it, vi } from 'vitest';

import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import { AxAIDeepSeek } from './api.js';
import { AxAIDeepSeekModel } from './types.js';

type CapturedBody = {
  tools?: unknown[];
  tool_choice?: unknown;
};

const okResponse = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 0,
  model: 'deepseek-test',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
};

const finalAnswerTool = {
  name: 'final_answer',
  description: 'Return final answer',
  parameters: {
    type: 'object',
    properties: {
      answer: { type: 'string' },
    },
    required: ['answer'],
  },
};

const forcedFinalAnswer = {
  type: 'function' as const,
  function: { name: 'final_answer' },
};

function createMockFetch(
  capture: { lastBody?: CapturedBody },
  responseBody: unknown = okResponse
) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        capture.lastBody = JSON.parse(init.body) as CapturedBody;
      }

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

describe('AxAIDeepSeek tool choice compatibility', () => {
  it('lets AxGen structured fallback send __finalResult to V4 without tool_choice', async () => {
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
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Pro, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({
      fetch: createMockFetch(capture, {
        ...okResponse,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: '__finalResult',
                    arguments: '{"user":{"name":"Alice","age":30}}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    });

    const result = await gen.forward(
      ai,
      { question: 'Who is Alice?' },
      { stream: false, maxRetries: 0 }
    );
    const toolNames = capture.lastBody?.tools?.map(
      (tool) => (tool as { function?: { name?: string } }).function?.name
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(toolNames).toContain('__finalResult');
    expect(capture.lastBody?.tool_choice).toBeUndefined();
  });

  it('omits forced tool_choice for DeepSeek V4 Pro while keeping tools', async () => {
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Pro, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Return ok using the tool.' }],
        functions: [finalAnswerTool],
        functionCall: forcedFinalAnswer,
      },
      { stream: false }
    );

    expect(capture.lastBody?.tools).toHaveLength(1);
    expect(capture.lastBody?.tool_choice).toBeUndefined();
  });

  it('omits auto tool_choice for DeepSeek V4 Flash while keeping tools', async () => {
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Return ok using the tool.' }],
        functions: [finalAnswerTool],
      },
      { stream: false }
    );

    expect(capture.lastBody?.tools).toHaveLength(1);
    expect(capture.lastBody?.tool_choice).toBeUndefined();
  });

  it('preserves forced tool_choice for DeepSeek Chat', async () => {
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekChat, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Return ok using the tool.' }],
        functions: [finalAnswerTool],
        functionCall: forcedFinalAnswer,
      },
      { stream: false }
    );

    expect(capture.lastBody?.tool_choice).toEqual(forcedFinalAnswer);
  });

  it('removes tools for DeepSeek V4 when functionCall is none', async () => {
    const ai = new AxAIDeepSeek({
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Pro, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Do not use tools.' }],
        functions: [finalAnswerTool],
        functionCall: 'none',
      },
      { stream: false }
    );

    expect(capture.lastBody?.tools).toBeUndefined();
    expect(capture.lastBody?.tool_choice).toBeUndefined();
  });
});
