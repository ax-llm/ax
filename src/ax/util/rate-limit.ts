import { ColorLog } from './log.js';

const colorLog = new ColorLog();

export interface AxRateLimiterTokenUsageOptions {
  debug?: boolean;
}

export class AxRateLimiterTokenUsage {
  private options?: Readonly<AxRateLimiterTokenUsageOptions>;
  private maxTokens: number;
  private refillRate: number;
  private currentTokens: number;
  private lastRefillTime: number;

  constructor(
    maxTokens: number,
    refillRate: number,
    options?: Readonly<AxRateLimiterTokenUsageOptions>
  ) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.currentTokens = maxTokens;
    this.lastRefillTime = Date.now();
    this.options = options;
  }

  private refillTokens() {
    const now = Date.now();
    const timeElapsed = (now - this.lastRefillTime) / 1000; // Convert ms to seconds
    const tokensToAdd = timeElapsed * this.refillRate;
    this.currentTokens = Math.min(
      this.maxTokens,
      this.currentTokens + tokensToAdd
    );
    this.lastRefillTime = now;
  }

  private async waitUntilTokensAvailable(tokens: number): Promise<void> {
    this.refillTokens();
    // A single request can legitimately ask for more tokens than the bucket can
    // ever hold (for example a large LLM call against a low per-minute budget).
    // Waiting for `tokens` in that case would never resolve, since currentTokens
    // is capped at maxTokens by refillTokens(). Wait for a full bucket instead,
    // then let currentTokens go negative so the borrowed capacity is repaid on
    // subsequent refills and the average rate is still honored.
    const required = Math.min(tokens, this.maxTokens);
    if (this.currentTokens >= required) {
      this.currentTokens -= tokens;
      return;
    }
    if (this.options?.debug) {
      console.log(
        colorLog.red(
          `Rate limiter: Waiting for ${required - this.currentTokens} tokens`
        )
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for 100ms before checking again
    return this.waitUntilTokensAvailable(tokens); // Recursive call
  }

  public async acquire(tokens: number): Promise<void> {
    await this.waitUntilTokensAvailable(tokens);
  }
}

/**
 * Example usage of the rate limiter. Limits to 5800 tokens per minute.
const rateLimiter = new AxRateLimiterTokenUsage(5800, 5800 / 60);

const axRateLimiterFunction = async (func, info) => {
  const totalTokens = info.modelUsage?.totalTokens || 0;
  await rateLimiter.acquire(totalTokens);
  return func();
};
**/
