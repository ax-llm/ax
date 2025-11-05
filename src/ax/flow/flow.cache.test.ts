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
    const f = flow<{ firstName: string; lastName: string }>()
      .node('echo', 'firstName:string, lastName:string -> fullName:string')
      .execute('echo', (state) => ({
        firstName: state.firstName,
        lastName: state.lastName,
      }))
      .mapOutput((state) => ({
        final: (state as any).echoResult?.fullName ?? '',
      }));

    axGlobals.cachingFunction = vi
      .fn()
      .mockResolvedValue({ final: 'cached-flow' } as any);
    const res = await f.forward(ai as any, { firstName: '1', lastName: '2' });
    expect((res as any).final).toBe('cached-flow');
    expect(axGlobals.cachingFunction).toHaveBeenCalledTimes(1);
  });

  it('produces same cache key for different object key orders', async () => {
    const f = flow<{ firstName: string; lastName: string }>()
      .node('echo', 'firstName:string, lastName:string -> fullName:string')
      .execute('echo', (state) => ({
        firstName: state.firstName,
        lastName: state.lastName,
      }))
      .mapOutput((state) => ({
        final: (state as any).echoResult?.fullName ?? '',
      }));

    const keys: string[] = [];
    axGlobals.cachingFunction = vi
      .fn()
      .mockImplementation(async (key: string) => {
        keys.push(key);
        return { final: 'cached' } as any;
      });

    await f.forward(ai as any, { lastName: '2', firstName: '1' });
    await f.forward(ai as any, { firstName: '1', lastName: '2' });
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('short-circuits streamingForward using axGlobals.cachingFunction', async () => {
    const f = flow<{ userQuery: string }>()
      .node('echo', 'userQuery:string -> resultText:string')
      .execute('echo', (state) => ({ userQuery: (state as any).userQuery }))
      .mapOutput((state) => ({
        final: (state as any).echoResult?.resultText ?? '',
      }));

    axGlobals.cachingFunction = vi
      .fn()
      .mockResolvedValue({ final: 'cached-stream' } as any);
    const it = f.streamingForward(ai as any, { userQuery: 'zzz' });
    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value.delta.final).toBe('cached-stream');
  });
});
