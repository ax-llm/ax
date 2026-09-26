import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { flow } from '../flow/flow.js';
import { runControl } from './runControl.js';
import { ax } from './template.js';

describe('run control scopes and legacy services', () => {
  it('retains root updates for future descendants and restricts explicit targets', () => {
    const control = runControl();
    control.steer('Root change');
    control.setThinkingTokenBudget('high', { target: 'root/left' });
    expect(control.pending('root/right', 0)).toHaveLength(1);
    expect(control.pending('root/left/child', 0)).toHaveLength(2);
    expect(control.pending('root/leftover', 0)).toHaveLength(1);
    expect(control.pending('root/left', 2)).toHaveLength(0);
  });
  it('aborts idempotently and rejects updates after abort', () => {
    const control = runControl();
    const events = vi.fn();
    control.onEvent(events);
    control.abort();
    control.abort();
    expect(events).toHaveBeenCalledTimes(1);
    expect(control.signal.aborted).toBe(true);
    expect(() => control.steer('new')).toThrow(/aborted/);
  });
  it('applies queued controls to a chat-only custom service and bypasses result caching', async () => {
    const control = runControl();
    control.steer('Use the revised instructions');
    const requests: any[] = [];
    const llm = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (req) => {
        requests.push(req);
        return { results: [{ index: 0, content: 'Answer: revised' }] };
      },
    });
    const cache = vi.fn(() => ({ answer: 'cached' }));
    const result = await ax('question -> answer').forward(
      llm,
      { question: 'original' },
      { control, cachingFunction: cache }
    );
    expect(result.answer).toBe('revised');
    expect(cache).not.toHaveBeenCalled();
    expect(JSON.stringify(requests)).toContain('Use the revised instructions');
  });
  it('preserves per-node scopes without rerunning completed flow nodes', async () => {
    const control = runControl();
    const seen: string[] = [];
    const llm = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async (_req, options) => {
        seen.push(options?.executionPath ?? 'missing');
        return { results: [{ index: 0, content: 'Answer: done' }] };
      },
    });
    const wf = flow<{ question: string }>()
      .node('first', ax('question -> answer'))
      .node('second', ax('question -> answer'))
      .execute('first', (s) => ({ question: s.question }))
      .execute('second', (s) => {
        control.steer('New requirement', { target: 'root/second' });
        return { question: s.firstResult.answer };
      })
      .returns((s) => ({ answer: s.secondResult.answer }));
    await wf.forward(llm, { question: 'hi' }, { control });
    expect(seen).toEqual(['root/first', 'root/second']);
  });
  it('reports a run the consumer stops early as aborted, not failed', async () => {
    const streamedAI = () =>
      new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: async () => {
          const chunks = ['Answer: The ', 'quick ', 'brown ', 'fox.'];
          return new ReadableStream<AxChatResponse>({
            pull(controller) {
              const content = chunks.shift();
              if (content === undefined) {
                controller.enqueue({
                  results: [{ index: 0, content: '', finishReason: 'stop' }],
                });
                controller.close();
              } else {
                controller.enqueue({ results: [{ index: 0, content }] });
              }
            },
          });
        },
      });
    const lifecycle = async (stopAfter?: number) => {
      const control = runControl();
      const events: { type: string; path: string; error?: unknown }[] = [];
      control.onEvent(({ type, path, error }) => {
        events.push(
          error === undefined ? { type, path } : { type, path, error }
        );
      });
      let seen = 0;
      for await (const _delta of ax('question -> answer').streamingForward(
        streamedAI(),
        { question: 'hi' },
        { control }
      )) {
        seen++;
        if (seen === stopAfter) break;
      }
      return events;
    };

    expect(await lifecycle(1)).toEqual([
      { type: 'started', path: 'root' },
      { type: 'aborted', path: 'root' },
    ]);
    expect(await lifecycle()).toEqual([
      { type: 'started', path: 'root' },
      { type: 'completed', path: 'root' },
    ]);
  });
});
