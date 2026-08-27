import { describe, expect, it, vi } from 'vitest';

import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import { AxAIOpenAIProfile, axGetAIProfile } from '../provider_profiles.js';
import { AxAIDeepSeekModel } from './types.js';

type CapturedBody = {
  model?: string;
  reasoning_effort?: string;
  temperature?: number;
  thinking?: { type?: string };
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

describe('deepseek profile model defaults', () => {
  it('uses the current V4 model from the deployment profile', () => {
    expect(axGetAIProfile('deepseek').defaultModel).toBe(
      AxAIDeepSeekModel.DeepSeekV4Flash
    );
  });

  it('sends V4 Flash with maximum thinking by default', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: { stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Return ok.' }],
      },
      { stream: false }
    );

    expect(capture.lastBody?.model).toBe(AxAIDeepSeekModel.DeepSeekV4Flash);
    expect(capture.lastBody?.thinking).toEqual({ type: 'enabled' });
    expect(capture.lastBody?.reasoning_effort).toBe('max');
  });

  it('enables DeepSeek thinking from thinkingTokenBudget', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: {
        model: AxAIDeepSeekModel.DeepSeekV4Pro,
        stream: false,
        temperature: 0.4,
      },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Think carefully.' }],
      },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(capture.lastBody?.thinking).toEqual({ type: 'enabled' });
    expect(capture.lastBody?.reasoning_effort).toBe('high');
    expect(capture.lastBody?.temperature).toBeUndefined();
  });

  it('maps highest thinking budget to DeepSeek max effort', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Pro, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'Think as much as needed.' }],
      },
      { stream: false, thinkingTokenBudget: 'highest' }
    );

    expect(capture.lastBody?.thinking).toEqual({ type: 'enabled' });
    expect(capture.lastBody?.reasoning_effort).toBe('max');
  });

  it.each(['minimal', 'low'] as const)(
    'maps %s thinking budget to DeepSeek low effort',
    async (thinkingTokenBudget) => {
      const ai = new AxAIOpenAIProfile({
        name: 'deepseek',
        apiKey: 'key',
        config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: false },
      });
      const capture: { lastBody?: CapturedBody } = {};
      ai.setOptions({ fetch: createMockFetch(capture) });

      await ai.chat(
        { chatPrompt: [{ role: 'user', content: 'Think efficiently.' }] },
        { stream: false, thinkingTokenBudget }
      );

      expect(capture.lastBody?.thinking).toEqual({ type: 'enabled' });
      expect(capture.lastBody?.reasoning_effort).toBe('low');
    }
  );

  it('maps medium thinking budget to DeepSeek medium effort', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'Think efficiently.' }] },
      { stream: false, thinkingTokenBudget: 'medium' }
    );

    expect(capture.lastBody?.thinking).toEqual({ type: 'enabled' });
    expect(capture.lastBody?.reasoning_effort).toBe('medium');
  });

  it('disables thinking for an explicit none budget', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Flash, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'Answer directly.' }] },
      { stream: false, thinkingTokenBudget: 'none' }
    );

    expect(capture.lastBody?.thinking).toEqual({ type: 'disabled' });
    expect(capture.lastBody?.reasoning_effort).toBeUndefined();
  });

  it('maps configured xhigh effort to DeepSeek max', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: {
        model: AxAIDeepSeekModel.DeepSeekV4Flash,
        stream: false,
        reasoningEffort: 'xhigh',
      },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'Think maximally.' }] },
      { stream: false }
    );

    expect(capture.lastBody?.thinking).toEqual({ type: 'enabled' });
    expect(capture.lastBody?.reasoning_effort).toBe('max');
  });

  it('advertises thinking support for current V4 models', () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
    });

    expect(ai.getFeatures(AxAIDeepSeekModel.DeepSeekV4Flash)).toMatchObject({
      hasThinkingBudget: true,
      hasShowThoughts: true,
      structuredOutputs: false,
      thinking: true,
    });
    expect(ai.getFeatures(AxAIDeepSeekModel.DeepSeekChat)).toMatchObject({
      hasThinkingBudget: false,
      hasShowThoughts: false,
      thinking: false,
    });
  });
});

describe('deepseek profile tool choice compatibility', () => {
  it('lets AxGen structured fallback send __axOutput to V4 without tool_choice', async () => {
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
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
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
                    name: '__axOutput',
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
    expect(toolNames).toContain('__axOutput');
    expect(capture.lastBody?.tool_choice).toBeUndefined();
  });

  it('rejects caller-forced tool_choice for DeepSeek V4 Pro', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
      apiKey: 'key',
      config: { model: AxAIDeepSeekModel.DeepSeekV4Pro, stream: false },
    });
    const capture: { lastBody?: CapturedBody } = {};
    ai.setOptions({ fetch: createMockFetch(capture) });

    await expect(
      ai.chat(
        {
          chatPrompt: [{ role: 'user', content: 'Return ok using the tool.' }],
          functions: [finalAnswerTool],
          functionCall: forcedFinalAnswer,
        },
        { stream: false, functionCallSource: 'caller' }
      )
    ).rejects.toThrow('does not support explicitly forced tool choices');
  });

  it('omits auto tool_choice for DeepSeek V4 Flash while keeping tools', async () => {
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
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
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
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
    const ai = new AxAIOpenAIProfile({
      name: 'deepseek',
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
