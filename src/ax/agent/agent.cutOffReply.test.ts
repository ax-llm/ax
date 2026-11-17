import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import {
  CUT_OFF_REPLY_NOTE,
  forwardWithCutOffRetry,
  isCutOffReplyError,
  MAX_CUT_OFF_REPLY_RETRIES,
} from './agentInternal/cutOffReply.js';
import { agent } from './index.js';

type ExecutorReply = Pick<
  AxChatResponse['results'][number],
  'content' | 'finishReason' | 'functionCalls'
>;

/** Runs the three-stage agent against a scripted executor. */
async function runAgent(
  executorReply: (call: number, prompt: string) => ExecutorReply
) {
  let executorCalls = 0;
  const executorPrompts: string[] = [];
  const ai = new AxMockAIService<string>({
    features: { functions: false, streaming: false },
    chatResponse: async ({ chatPrompt }): Promise<AxChatResponse> => {
      const system = String(chatPrompt[0]?.content ?? '');
      const prompt = String(chatPrompt[1]?.content ?? '');
      if (system.includes('You (`distiller`)')) {
        return {
          results: [
            {
              index: 0,
              content:
                'Javascript Code: await final("Complete the task using current evidence", {})',
              finishReason: 'stop',
            },
          ],
        };
      }
      if (system.includes('You (`executor`)')) {
        executorCalls++;
        executorPrompts.push(prompt);
        return {
          results: [{ index: 0, ...executorReply(executorCalls, prompt) }],
        };
      }
      return {
        results: [{ index: 0, content: 'Answer: done', finishReason: 'stop' }],
      };
    },
  });
  const outcome = await agent('task:string -> answer:string', {
    functionDiscovery: false,
    directResponse: 'off',
    maxTurns: 5,
  })
    .forward(ai, { task: 'Complete the requested work.' })
    .then(
      (output) => ({ answer: output.answer, error: undefined }),
      (error: unknown) => ({ answer: undefined, error: error as Error })
    );
  return { ...outcome, executorCalls, executorPrompts };
}

const cutOff: ExecutorReply = { content: '', finishReason: 'length' };
const finish: ExecutorReply = {
  content: `Javascript Code: await final('Report the result', { value: 42 });`,
  finishReason: 'stop',
};

describe('actor turn recovery from a cut-off model reply', () => {
  it('asks again unchanged after one cut-off reply and completes', async () => {
    const run = await runAgent((call) => (call === 1 ? cutOff : finish));
    expect(run.answer).toBe('done');
    expect(run.executorCalls).toBe(2);
    expect(run.executorPrompts[1]).toBe(run.executorPrompts[0]);
    expect(run.executorPrompts[1]).not.toContain(CUT_OFF_REPLY_NOTE);
  });

  it('adds a note from the second retry on', async () => {
    const run = await runAgent((call) => (call <= 2 ? cutOff : finish));
    expect(run.answer).toBe('done');
    expect(run.executorCalls).toBe(3);
    expect(run.executorPrompts[1]).not.toContain(CUT_OFF_REPLY_NOTE);
    expect(run.executorPrompts[2]).toContain(CUT_OFF_REPLY_NOTE);
  });

  it('surfaces the original failure when every retry is cut off', async () => {
    const run = await runAgent(() => cutOff);
    expect(run.answer).toBeUndefined();
    expect(run.error?.message).toContain(
      'Max tokens reached before completion'
    );
    expect(run.executorCalls).toBe(1 + MAX_CUT_OFF_REPLY_RETRIES);
  });

  it('does not spend an extra call when the reply is usable', async () => {
    const run = await runAgent(() => finish);
    expect(run.answer).toBe('done');
    expect(run.executorCalls).toBe(1);
  });
});

describe('forwardWithCutOffRetry', () => {
  const truncated = () =>
    new Error('Generate failed: Max tokens reached before completion', {
      cause: new Error('Max tokens reached before completion\nContent: '),
    });

  it('recognizes truncated replies through the cause chain', () => {
    expect(isCutOffReplyError(truncated())).toBe(true);
    expect(
      isCutOffReplyError(
        new Error('Generate failed', {
          cause: new Error(
            'Invalid function arguments: {"javascriptCode": "co'
          ),
        })
      )
    ).toBe(true);
    expect(isCutOffReplyError(new Error('HTTP 429 - rate limited'))).toBe(
      false
    );
    expect(isCutOffReplyError(undefined)).toBe(false);
  });

  it('retries a truncated tool-call payload', async () => {
    const logs: string[] = [];
    const result = await forwardWithCutOffRetry(async (log) => {
      logs.push(log);
      if (logs.length === 1)
        throw new Error('Invalid function arguments: {"javascriptCode": "co');
      return 'ok';
    }, 'log');
    expect(result).toBe('ok');
    expect(logs).toEqual(['log', 'log']);
  });

  it('rethrows other failures without retrying', async () => {
    let calls = 0;
    await expect(
      forwardWithCutOffRetry(async () => {
        calls++;
        throw new Error('HTTP 500 - upstream unavailable');
      }, 'log')
    ).rejects.toThrow('HTTP 500');
    expect(calls).toBe(1);
  });

  it('stops after the retry limit', async () => {
    const logs: string[] = [];
    await expect(
      forwardWithCutOffRetry(async (log) => {
        logs.push(log);
        throw truncated();
      }, 'log')
    ).rejects.toThrow('Max tokens reached before completion');
    expect(logs).toEqual([
      'log',
      'log',
      `log\n\n${CUT_OFF_REPLY_NOTE}`,
      `log\n\n${CUT_OFF_REPLY_NOTE}`,
    ]);
  });
});
