import { describe, expect, it, vi } from 'vitest';

import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import { AxMemory } from '../../mem/memory.js';
import { AxMockAIService } from '../mock/api.js';
import { ai } from '../wrap.js';

const text = 'Answer: Done';
const message = {
  type: 'message',
  id: 'msg1',
  role: 'assistant',
  phase: 'final_answer',
  status: 'completed',
  content: [{ type: 'output_text', text }],
};
const delta = {
  type: 'response.output_text.delta',
  item_id: 'msg1',
  delta: text,
};
const completed = {
  type: 'response.completed',
  response: { id: 'r1', output: [message] },
};
const sse = (events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );

describe('Meta Ax program regression coverage', () => {
  it.each([
    {
      type: 'response.failed',
      response: {
        id: 'r1',
        error: { message: 'Provider failed while generating' },
      },
    },
    { type: 'error', message: 'Provider failed while generating' },
  ])(
    'raises $type after content instead of accepting an answer',
    async (event) => {
      const client = ai({
        name: 'meta',
        apiKey: 'test',
        options: { fetch: async () => sse([delta, event]) },
      });
      await expect(
        (async () => {
          for await (const _ of await client.chat(
            { chatPrompt: [{ role: 'user', content: 'test' }] },
            { stream: true }
          )) {
          }
        })()
      ).rejects.toThrow('Provider failed while generating');
      await expect(
        ax('query:string -> answer:string').forward(
          client,
          { query: 'test' },
          { stream: true, maxRetries: 0 }
        )
      ).rejects.toThrow('Provider failed while generating');
    }
  );

  it('rejects a content-free token limit event after a parseable answer', async () => {
    const client = ai({
      name: 'meta',
      apiKey: 'test',
      options: {
        fetch: async () =>
          sse([
            delta,
            {
              type: 'response.incomplete',
              response: {
                id: 'r1',
                incomplete_details: { reason: 'max_output_tokens' },
              },
            },
          ]),
      },
    });
    await expect(
      ax('query:string -> answer:string').forward(
        client,
        { query: 'test' },
        { stream: true, maxRetries: 0 }
      )
    ).rejects.toThrow('Max tokens reached before completion');
  });

  it.each(['length', 'error'] as const)(
    'rejects a normalized terminal %s result with no content',
    async (finishReason) => {
      const client = new AxMockAIService({
        features: { streaming: true, functions: false },
      });
      client.chat = vi.fn(
        async () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ results: [{ index: 0, content: text }] });
              controller.enqueue({ results: [{ index: 0, finishReason }] });
              controller.close();
            },
          })
      ) as typeof client.chat;
      await expect(
        ax('query:string -> answer:string').forward(
          client,
          { query: 'test' },
          { stream: true, maxRetries: 0 }
        )
      ).rejects.toThrow(
        finishReason === 'length'
          ? 'Max tokens reached'
          : 'Streaming response failed'
      );
    }
  );

  it.each([false, true])(
    'replays the final phase through program memory (late phase: %s)',
    async (latePhase) => {
      const requests: Record<string, any>[] = [];
      const client = ai({
        name: 'meta',
        apiKey: 'test',
        options: {
          fetch: async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            return sse([
              {
                type: 'response.output_item.added',
                item: {
                  ...message,
                  phase: latePhase ? undefined : 'final_answer',
                  content: [],
                },
              },
              delta,
              { type: 'response.output_item.done', item: message },
              completed,
            ]);
          },
        },
      });
      const mem = new AxMemory();
      const result = await ax('query:string -> answer:string').forward(
        client,
        { query: 'test' },
        { stream: true, mem, maxRetries: 0 }
      );
      expect(result).toEqual({ answer: 'Done' });
      expect(mem.history(0)).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          phase: 'final_answer',
          content: text,
        })
      );
      for await (const _ of await client.chat(
        {
          chatPrompt: [
            ...mem.history(0),
            { role: 'user', content: 'continue' },
          ],
        },
        { stream: true }
      )) {
      }
      expect(requests[1]?.input).toContainEqual(
        expect.objectContaining({ role: 'assistant', phase: 'final_answer' })
      );
    }
  );

  it.each(['meta', 'meta-chat', 'meta-messages'] as const)(
    'uses function-based structured output with %s',
    async (name) => {
      const output = { answer: { text: 'Done' } };
      const response =
        name === 'meta'
          ? {
              id: 'r1',
              output: [
                {
                  type: 'function_call',
                  id: 'fc1',
                  call_id: 'call1',
                  name: '__axOutput',
                  arguments: JSON.stringify(output),
                },
              ],
            }
          : name === 'meta-chat'
            ? {
                id: 'r1',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'call1',
                          type: 'function',
                          function: {
                            name: '__axOutput',
                            arguments: JSON.stringify(output),
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              }
            : {
                id: 'r1',
                content: [
                  {
                    type: 'tool_use',
                    id: 'call1',
                    name: '__axOutput',
                    input: output,
                  },
                ],
                stop_reason: 'tool_use',
                usage: { input_tokens: 1, output_tokens: 1 },
              };
      const bodies: Record<string, any>[] = [];
      const fetch = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      );
      const client = ai({ name, apiKey: 'test', options: { fetch } });
      const signature = f()
        .input('query', f.string())
        .output('answer', f.object({ text: f.string() }))
        .build();
      expect(
        await ax(signature).forward(
          client,
          { query: 'test' },
          { stream: false, structuredOutputMode: 'function', maxRetries: 0 }
        )
      ).toEqual(output);
      expect(bodies[0]?.tool_choice).toEqual(
        name === 'meta-messages' ? { type: 'any' } : 'required'
      );
      expect(bodies[0]?.tools).toHaveLength(1);
      // A caller naming even the reserved output tool is not an Ax-generated choice.
      await expect(
        client.chat(
          {
            chatPrompt: [{ role: 'user', content: 'test' }],
            functions: [
              {
                name: '__axOutput',
                description: 'Return output',
                parameters: { type: 'object', properties: {} },
              },
            ],
            functionCall: {
              type: 'function',
              function: { name: '__axOutput' },
            },
          },
          { stream: false }
        )
      ).rejects.toThrow('does not support explicitly named tool choices');
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
});
