import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AxAPIConfig, apiCall } from './apicall.js';

describe('apiCall Retry-After header', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    const date = new Date(2024, 0, 1, 12, 0, 0);
    vi.setSystemTime(date);
    vi.useRealTimers();
  });

  it('should respect Retry-After header with seconds', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '5' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'success' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const config: AxAPIConfig = {
      url: 'https://api.example.com/test',
      fetch: mockFetch,
      retry: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      },
    };

    const promise = apiCall(config, { test: 'data' });

    // Should not have resolved yet
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Fast forward 4999ms - should still be waiting
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Fast forward another 2ms - should trigger retry
    await vi.advanceTimersByTimeAsync(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toEqual({ result: 'success' });
  });

  it('should respect Retry-After header with HTTP Date', async () => {
    const now = new Date(2024, 0, 1, 12, 0, 0).getTime();
    vi.setSystemTime(now);

    const retryDate = new Date(now + 3000).toUTCString(); // 3 seconds later

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': retryDate },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'success' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const config: AxAPIConfig = {
      url: 'https://api.example.com/test',
      fetch: mockFetch,
      retry: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      },
    };

    const promise = apiCall(config, { test: 'data' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Fast forward 2999ms
    await vi.advanceTimersByTimeAsync(2999);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Fast forward to passed 3000ms
    await vi.advanceTimersByTimeAsync(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toEqual({ result: 'success' });
  });

  it('should fallback to backoff if Retry-After is too large', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '20' }, // 20s > maxDelayMs
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: 'success' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

    const config: AxAPIConfig = {
      url: 'https://api.example.com/test',
      fetch: mockFetch,
      retry: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 5000, // Max 5s
        backoffFactor: 2,
      },
    };

    const promise = apiCall(config, { test: 'data' });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The logic should use calculateRetryDelay which is random * backoff
    // Max delay is 5000ms, min delay for 1st retry is 1000 * 0.75 = 750ms
    // But since Retry-After is 20s > 5s, it ignores it.

    // Let's just verify it retries eventually within maxDelayMs (+jitter)
    await vi.advanceTimersByTimeAsync(7000); // Plenty of time for backoff

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const result = await promise;
    expect(result).toEqual({ result: 'success' });
  });
});
