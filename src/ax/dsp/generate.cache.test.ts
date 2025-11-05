import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { axGlobals } from './globals.js';
import { ax } from './template.js';

describe('AxGen caching via axGlobals', () => {
  const ai = new AxMockAIService();
  let originalCaching: typeof axGlobals.cachingFunction;

  beforeEach(() => {
    originalCaching = axGlobals.cachingFunction;
  });

  afterEach(() => {
    axGlobals.cachingFunction = originalCaching;
  });

  it('short-circuits forward using axGlobals.cachingFunction', async () => {
    const gen = ax('userQuestion:string "q" -> responseText:string "a"');
    axGlobals.cachingFunction = vi
      .fn()
      .mockResolvedValue({ responseText: 'cached' });
    const res = await gen.forward(ai as any, { userQuestion: 'hello' } as any);
    expect((res as any).responseText).toBe('cached');
    expect(axGlobals.cachingFunction).toHaveBeenCalledTimes(1);
  });

  it('produces the same cache key regardless of input object key order', async () => {
    const gen = ax('firstName:string, lastName:string -> responseText:string');
    const keys: string[] = [];
    axGlobals.cachingFunction = vi
      .fn()
      .mockImplementation(async (key: string) => {
        keys.push(key);
        return { responseText: 'cached' } as any;
      });
    await gen.forward(ai as any, { lastName: '2', firstName: '1' } as any);
    await gen.forward(ai as any, { firstName: '1', lastName: '2' } as any);
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('short-circuits streamingForward using axGlobals.cachingFunction', async () => {
    const gen = ax('userQuestion:string -> responseText:string');
    axGlobals.cachingFunction = vi
      .fn()
      .mockResolvedValue({ responseText: 'cached-stream' });
    const it = gen.streamingForward(ai as any, { userQuestion: 'x' } as any);
    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value.delta.responseText).toBe('cached-stream');
  });
});
