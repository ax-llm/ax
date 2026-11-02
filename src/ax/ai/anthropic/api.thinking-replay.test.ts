import { describe, expect, it } from 'vitest';

import type { AxChatRequest, AxThoughtBlockItem } from '../types.js';
import { AxAIAnthropic } from './api.js';
import { type AxAIAnthropicChatRequest, AxAIAnthropicModel } from './types.js';

const thoughtBlocks: AxThoughtBlockItem[] = [
  { data: 'reasoning', encrypted: false, signature: 'fixture-signature' },
  { data: 'opaque-data', encrypted: true },
];
const thinkingContent = [
  { type: 'thinking', thinking: 'reasoning', signature: 'fixture-signature' },
  { type: 'redacted_thinking', data: 'opaque-data' },
];

async function captureAssistantContent(
  assistant: Extract<AxChatRequest['chatPrompt'][number], { role: 'assistant' }>
) {
  const model = AxAIAnthropicModel.Claude55Sonnet;
  const ai = new AxAIAnthropic({ apiKey: 'fixture-key', config: { model } });
  const requests: AxAIAnthropicChatRequest[] = [];
  ai.setOptions({
    fetch: async (_url, init) => {
      requests.push(
        JSON.parse(init?.body as string) as AxAIAnthropicChatRequest
      );
      return new Response(
        JSON.stringify({
          id: 'fixture-message',
          type: 'message',
          role: 'assistant',
          model,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  });

  await ai.chat(
    {
      chatPrompt: [
        { role: 'user', content: 'Start.' },
        assistant,
        { role: 'user', content: 'Continue.' },
      ],
    },
    { stream: false, showThoughts: false, thinkingTokenBudget: 'high' }
  );

  expect(requests).toHaveLength(1);
  return requests[0]?.messages.find((message) => message.role === 'assistant')
    ?.content;
}

describe('Anthropic thinking replay with empty visible text', () => {
  it.each([1, 2])(
    'preserves %i thinking blocks without empty text',
    async (count) => {
      const content = await captureAssistantContent({
        role: 'assistant',
        content: '',
        thoughtBlocks: thoughtBlocks.slice(0, count),
      });
      expect(content).toEqual(thinkingContent.slice(0, count));
    }
  );

  it.each(['Visible answer', ' '])(
    'preserves nonempty text %j and its cache marker',
    async (text) => {
      const content = await captureAssistantContent({
        role: 'assistant',
        content: text,
        thoughtBlocks,
        cache: true,
      });
      expect(content).toEqual([
        ...thinkingContent,
        { type: 'text', text, cache_control: { type: 'ephemeral' } },
      ]);
    }
  );

  it('preserves thinking before tool use with empty visible text', async () => {
    const content = await captureAssistantContent({
      role: 'assistant',
      content: '',
      thoughtBlocks,
      functionCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'my_tool', params: { value: 7 } },
        },
      ],
    });
    expect(content).toEqual([
      ...thinkingContent,
      { type: 'tool_use', id: 'call_1', name: 'my_tool', input: { value: 7 } },
    ]);
  });
});
