import { afterEach, describe, expect, it, vi } from 'vitest';

import { AxRateLimiterTokenUsage } from './rate-limit.js';

describe('AxRateLimiterTokenUsage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when enough tokens are available', async () => {
    const limiter = new AxRateLimiterTokenUsage(100, 10);
    await expect(limiter.acquire(50)).resolves.toBeUndefined();
    // A second request within the remaining budget also proceeds.
    await expect(limiter.acquire(50)).resolves.toBeUndefined();
  });

  it('resolves a request larger than the bucket capacity instead of hanging forever', async () => {
    // Regression: a single request larger than maxTokens could never be
    // satisfied because currentTokens is capped at maxTokens, so acquire()
    // would await indefinitely.
    const limiter = new AxRateLimiterTokenUsage(100, 10);
    await expect(limiter.acquire(150)).resolves.toBeUndefined();
  });

  it('repays borrowed capacity so the average rate is still honored', async () => {
    vi.useFakeTimers();
    // 100 token bucket, refilling 100 tokens/sec.
    const limiter = new AxRateLimiterTokenUsage(100, 100);

    // First oversized request drains the bucket to -50.
    await limiter.acquire(150);

    // The next oversized request must wait for the debt (-50) to be repaid and
    // the bucket to refill to full (100) before it can proceed: 150 tokens at
    // 100 tokens/sec = 1500ms.
    let secondResolved = false;
    const second = limiter.acquire(150).then(() => {
      secondResolved = true;
    });

    await vi.advanceTimersByTimeAsync(1400);
    expect(secondResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await second;
    expect(secondResolved).toBe(true);
  });
});
