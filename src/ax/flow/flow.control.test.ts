import { describe, expect, it } from 'vitest';
import type { AxAIService } from '../ai/types.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';
import { flow } from './flow.js';

const ai = { name: 'mock' } as unknown as AxAIService;

describe('AxFlow control flow with default autoParallel', () => {
  it('runs while loops with autoParallel enabled', async () => {
    const wf = flow<{ count: number }, { count: number }>()
      .while((state) => state.count < 3)
      .map((state) => ({ ...state, count: state.count + 1 }))
      .endWhile()
      .returns((state) => ({ count: state.count }));

    await expect(wf.forward(ai, { count: 0 })).resolves.toEqual({ count: 3 });
  });

  it('runs feedback loops with autoParallel enabled', async () => {
    const wf = flow<{ value: string }, { attempts: number }>()
      .map((state) => ({ ...state, attempts: 0 }))
      .label('retry')
      .map((state) => ({ ...state, attempts: state.attempts + 1 }))
      .feedback((state) => state.attempts < 3, 'retry', 5)
      .returns((state) => ({ attempts: state.attempts }));

    await expect(wf.forward(ai, { value: 'x' })).resolves.toEqual({
      attempts: 3,
    });
  });

  it('runs branches inside while loops with autoParallel enabled', async () => {
    const wf = flow<{ items: number[] }, { labels: string[] }>()
      .map((state) => ({ ...state, index: 0, labels: [] as string[] }))
      .while((state) => state.index < state.items.length)
      .map((state) => ({ ...state, item: state.items[state.index] }))
      .branch((state) => state.item % 2 === 0)
      .when(true)
      .map((state) => ({ ...state, label: 'even' }))
      .when(false)
      .map((state) => ({ ...state, label: 'odd' }))
      .merge()
      .map((state) => ({
        ...state,
        labels: [...state.labels, state.label],
        index: state.index + 1,
      }))
      .endWhile()
      .returns((state) => ({ labels: state.labels }));

    await expect(wf.forward(ai, { items: [1, 2, 3] })).resolves.toEqual({
      labels: ['odd', 'even', 'odd'],
    });
  });

  it('checks aborts inside nested loop bodies', async () => {
    const controller = new AbortController();
    const wf = flow<{ count: number }>()
      .while((state) => state.count < 5)
      .map((state) => {
        controller.abort('stop');
        return { ...state, count: state.count + 1 };
      })
      .map((state) => ({ ...state, count: state.count + 1 }))
      .endWhile();

    await expect(
      wf.forward(ai, { count: 0 }, { abortController: controller } as any)
    ).rejects.toBeInstanceOf(AxAIServiceAbortedError);
  });
});
