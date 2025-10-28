import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { axGlobals } from '../dsp/globals.js';
import { flow } from './flow.js';

describe('AxFlow caching via axGlobals', () => {
  const ai = new AxMockAIService();
  let originalCaching: typeof axGlobals.cachingFunction;

  beforeEach(() => {
    originalCaching = axGlobals.cachingFunction;
  });

  afterEach(() => {
    axGlobals.cachingFunction = originalCaching;
  });

  it('short-circuits forward using axGlobals.cachingFunction', async () => {
    const f = flow<{ a: string; b: string }>()
      .node('echo', 'a:string, b:string -> out:string')
      .execute('echo', (state) => ({ a: state.a, b: state.b }))
      .mapOutput((state) => ({ final: (state as any).echoResult?.out ?? '' }));

    axGlobals.cachingFunction = vi
      .fn()
      .mockResolvedValue({ final: 'cached-flow' } as any);
    const res = await f.forward(ai as any, { a: '1', b: '2' });
    expect((res as any).final).toBe('cached-flow');
    expect(axGlobals.cachingFunction).toHaveBeenCalledTimes(1);
  });

  it('produces same cache key for different object key orders', async () => {
    const f = flow<{ a: string; b: string }>()
      .node('echo', 'a:string, b:string -> out:string')
      .execute('echo', (state) => ({ a: state.a, b: state.b }))
      .mapOutput((state) => ({ final: (state as any).echoResult?.out ?? '' }));

    const keys: string[] = [];
    axGlobals.cachingFunction = vi
      .fn()
      .mockImplementation(async (key: string) => {
        keys.push(key);
        return { final: 'cached' } as any;
      });

    await f.forward(ai as any, { b: '2', a: '1' });
    await f.forward(ai as any, { a: '1', b: '2' });
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('short-circuits streamingForward using axGlobals.cachingFunction', async () => {
    const f = flow<{ q: string }>()
      .node('echo', 'q:string -> out:string')
      .execute('echo', (state) => ({ q: (state as any).q }))
      .mapOutput((state) => ({ final: (state as any).echoResult?.out ?? '' }));

    axGlobals.cachingFunction = vi
      .fn()
      .mockResolvedValue({ final: 'cached-stream' } as any);
    const it = f.streamingForward(ai as any, { q: 'zzz' });
    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value.delta.final).toBe('cached-stream');
  });
});
