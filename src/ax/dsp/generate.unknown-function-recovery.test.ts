import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxFunction } from '../ai/types.js';
import { f } from './sig.js';
import { ax } from './template.js';

type ChatPrompt = AxChatRequest['chatPrompt'];

/** Ids of assistant function calls that no function result answers. */
const unanswered = (prompt: ChatPrompt | undefined) => {
  const answered = new Set(
    (prompt ?? []).flatMap((m) => (m.role === 'function' ? [m.functionId] : []))
  );
  return (prompt ?? []).flatMap((m) =>
    m.role === 'assistant'
      ? (m.functionCalls ?? [])
          .map((call) => call.id)
          .filter((id) => !answered.has(id))
      : []
  );
};

const functionResult = (prompt: ChatPrompt | undefined, id: string) => {
  const message = (prompt ?? []).find(
    (m) => m.role === 'function' && m.functionId === id
  );
  return message?.role === 'function' ? message : undefined;
};

/**
 * End-to-end coverage for the unknown-tool hardening: a hallucinated tool name
 * is answered with an error result listing the available tools, like any other
 * failed tool call, so the model can self-correct instead of the run
 * hard-aborting.
 */
describe('Unknown function-call recovery', () => {
  const knownTool: AxFunction = {
    name: 'knownTool',
    description: 'A known tool',
    parameters: {
      type: 'object',
      properties: { q: { type: 'string', description: 'query' } },
      required: ['q'],
    },
    func: async () => 'tool-result',
  };

  it('recovers from a hallucinated tool name by retrying instead of aborting', async () => {
    const sig = f()
      .input('question', f.string())
      .output('answer', f.string())
      .build();
    const gen = ax(sig);

    let calls = 0;
    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: false },
    });
    mockAI.chat = async () => {
      calls++;
      if (calls === 1) {
        // The model hallucinates a tool that was never registered.
        return {
          results: [
            {
              index: 0,
              functionCalls: [
                {
                  id: '1',
                  type: 'function' as const,
                  function: { name: 'list_dir', params: '{}' },
                },
              ],
              finishReason: 'stop' as const,
            },
          ],
        };
      }
      // After the corrective retry, it produces a valid answer.
      return {
        results: [
          { index: 0, content: 'Answer: 42', finishReason: 'stop' as const },
        ],
      };
    };

    const result = await gen.forward(
      mockAI,
      { question: 'x' },
      { functions: [knownTool] }
    );

    expect(result.answer).toBe('42');
    // Recovered via at least one corrective retry rather than aborting.
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  /** A mock that sends `first` as its opening turn, then answers, recording each prompt. */
  const scripted = (
    first: {
      id: string;
      type: 'function';
      function: { name: string; params: string };
    }[]
  ) => {
    const prompts: ChatPrompt[] = [];
    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: false },
    });
    mockAI.chat = async (req) => {
      prompts.push(structuredClone(req.chatPrompt));
      return prompts.length === 1
        ? {
            results: [
              { index: 0, functionCalls: first, finishReason: 'stop' as const },
            ],
          }
        : {
            results: [
              {
                index: 0,
                content: 'Answer: 42',
                finishReason: 'stop' as const,
              },
            ],
          };
    };
    return { mockAI, prompts };
  };

  const answerGen = () =>
    ax(f().input('question', f.string()).output('answer', f.string()).build());

  it('runs the known calls in a batch that also names an unknown tool', async () => {
    let knownRuns = 0;
    const { mockAI, prompts } = scripted([
      {
        id: 'known-1',
        type: 'function',
        function: { name: 'knownTool', params: '{"q":"a"}' },
      },
      {
        id: 'ghost-1',
        type: 'function',
        function: { name: 'list_dir', params: '{}' },
      },
    ]);

    const result = await answerGen().forward(
      mockAI,
      { question: 'x' },
      {
        functions: [
          { ...knownTool, func: async () => (knownRuns++, 'tool-result') },
        ],
      }
    );

    expect(result.answer).toBe('42');
    expect(knownRuns).toBe(1);
    expect(prompts).toHaveLength(2);
    expect(unanswered(prompts[1])).toEqual([]);
    expect(functionResult(prompts[1], 'known-1')?.result).toBe('tool-result');
    const ghost = functionResult(prompts[1], 'ghost-1');
    expect(ghost?.isError).toBe(true);
    expect(ghost?.result).toContain('Available functions: knownTool');
  });

  it('answers a turn of only unknown calls before the model tries again', async () => {
    const { mockAI, prompts } = scripted([
      {
        id: 'ghost-1',
        type: 'function',
        function: { name: 'list_dir', params: '{}' },
      },
    ]);

    const result = await answerGen().forward(
      mockAI,
      { question: 'x' },
      { functions: [knownTool] }
    );

    expect(result.answer).toBe('42');
    // Providers such as Anthropic reject a request whose tool call has no result.
    expect(unanswered(prompts[1])).toEqual([]);
    expect(functionResult(prompts[1], 'ghost-1')?.isError).toBe(true);
  });
});
