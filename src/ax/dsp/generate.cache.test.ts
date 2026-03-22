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

  it('passes contextCache through to ai.chat', async () => {
    const gen = ax('userQuestion:string -> responseText:string');
    const contextCache = {
      ttlSeconds: 3600,
      cacheBreakpoint: 'after-examples' as const,
    };

    const mockChat = vi.fn(async (_req: unknown, options?: any) => {
      expect(options?.contextCache).toEqual(contextCache);
      return {
        results: [
          {
            index: 0,
            content: 'Response Text: cached path',
            finishReason: 'stop' as const,
          },
        ],
        modelUsage: {
          ai: 'mock-ai-service',
          model: 'mock-model',
          tokens: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
      };
    });

    ai.chat = mockChat as typeof ai.chat;

    const res = await gen.forward(ai as any, { userQuestion: 'hello' } as any, {
      contextCache,
    });

    expect(res.responseText).toBe('cached path');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('uses contextCache from ai instance options when forward options omit it', async () => {
    const gen = ax('userQuestion:string -> responseText:string');
    const contextCache = {
      ttlSeconds: 3600,
      cacheBreakpoint: 'after-functions' as const,
    };

    const aiWithOptions = new AxMockAIService({
      options: { contextCache },
    });

    const mockChat = vi.fn(async (_req: unknown, options?: any) => {
      expect(options?.contextCache).toEqual(contextCache);
      return {
        results: [
          {
            index: 0,
            content: 'Response Text: instance cache path',
            finishReason: 'stop' as const,
          },
        ],
        modelUsage: {
          ai: 'mock-ai-service',
          model: 'mock-model',
          tokens: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
      };
    });

    aiWithOptions.chat = mockChat as typeof aiWithOptions.chat;

    const res = await gen.forward(
      aiWithOptions as any,
      { userQuestion: 'hello' } as any
    );

    expect(res.responseText).toBe('instance cache path');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('prefers per-call contextCache over ai instance options', async () => {
    const gen = ax('userQuestion:string -> responseText:string');
    const instanceContextCache = {
      ttlSeconds: 3600,
      cacheBreakpoint: 'after-functions' as const,
    };
    const callContextCache = {
      ttlSeconds: 7200,
      cacheBreakpoint: 'system' as const,
    };

    const aiWithOptions = new AxMockAIService({
      options: { contextCache: instanceContextCache },
    });

    const mockChat = vi.fn(async (_req: unknown, options?: any) => {
      expect(options?.contextCache).toEqual(callContextCache);
      return {
        results: [
          {
            index: 0,
            content: 'Response Text: per-call cache path',
            finishReason: 'stop' as const,
          },
        ],
        modelUsage: {
          ai: 'mock-ai-service',
          model: 'mock-model',
          tokens: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
      };
    });

    aiWithOptions.chat = mockChat as typeof aiWithOptions.chat;

    const res = await gen.forward(
      aiWithOptions as any,
      { userQuestion: 'hello' } as any,
      { contextCache: callContextCache }
    );

    expect(res.responseText).toBe('per-call cache path');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
