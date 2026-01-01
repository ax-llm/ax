import { describe, expect, it, vi } from 'vitest';

import {
  apiCall,
  AxAIServiceNetworkError,
  type AxAPIConfig,
} from './apicall.js';

describe('apiCall', () => {
  describe('retry logic for network errors', () => {
    it('should retry on raw TypeError from fetch (e.g., TLS connection errors)', async () => {
      // Simulate TLS connection error like "peer closed connection without sending TLS close_notify"
      const tlsError = new TypeError(
        'peer closed connection without sending TLS close_notify'
      );

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(tlsError)
        .mockRejectedValueOnce(tlsError)
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
          initialDelayMs: 1, // Use tiny delays for tests
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      const result = await apiCall(config, { test: 'data' });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ result: 'success' });
    });

    it('should wrap raw TypeError in AxAIServiceNetworkError when all retries exhausted', async () => {
      const tlsError = new TypeError(
        'peer closed connection without sending TLS close_notify'
      );

      const mockFetch = vi.fn().mockRejectedValue(tlsError);

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: {
          maxRetries: 2,
          initialDelayMs: 1,
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      await expect(apiCall(config, { test: 'data' })).rejects.toThrow(
        AxAIServiceNetworkError
      );
      await expect(apiCall(config, { test: 'data' })).rejects.toThrow(
        /peer closed connection without sending TLS close_notify/
      );
    });

    it('should retry on DNS resolution errors', async () => {
      const dnsError = new TypeError('getaddrinfo ENOTFOUND api.example.com');

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(dnsError)
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
          initialDelayMs: 1,
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      const result = await apiCall(config, { test: 'data' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ result: 'success' });
    });

    it('should retry on connection reset errors', async () => {
      const connectionError = new Error('socket hang up');

      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(connectionError)
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
          initialDelayMs: 1,
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      const result = await apiCall(config, { test: 'data' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ result: 'success' });
    });

    it('should not retry beyond maxRetries', async () => {
      const networkError = new TypeError('network error');

      const mockFetch = vi.fn().mockRejectedValue(networkError);

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: {
          maxRetries: 1,
          initialDelayMs: 1,
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      await expect(apiCall(config, { test: 'data' })).rejects.toThrow(
        AxAIServiceNetworkError
      );

      // Initial call + 1 retry = 2 total calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should preserve original error information in wrapped AxAIServiceNetworkError', async () => {
      const originalError = new TypeError(
        'peer closed connection without sending TLS close_notify'
      );

      const mockFetch = vi.fn().mockRejectedValue(originalError);

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: {
          maxRetries: 0,
          initialDelayMs: 1,
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      try {
        await apiCall(config, { test: 'data' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceNetworkError);
        const networkError = error as AxAIServiceNetworkError;
        expect(networkError.message).toContain(
          'peer closed connection without sending TLS close_notify'
        );
        expect(networkError.url).toBe('https://api.example.com/test');
        expect(networkError.context.originalErrorName).toBe('TypeError');
      }
    });

    it('should include retry count in metrics', async () => {
      const networkError = new TypeError('network error');

      const mockFetch = vi.fn().mockRejectedValue(networkError);

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: {
          maxRetries: 2,
          initialDelayMs: 1,
          backoffFactor: 1,
          maxDelayMs: 10,
        },
      };

      try {
        await apiCall(config, { test: 'data' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceNetworkError);
        const networkError = error as AxAIServiceNetworkError;
        expect(networkError.context.metrics).toBeDefined();
        const metrics = networkError.context.metrics as {
          retryCount: number;
        };
        expect(metrics.retryCount).toBe(2);
      }
    });
  });
  describe('error handling', () => {
    it('should not include request body in error if includeRequestBodyInError is false', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      );

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: { maxRetries: 0 },
        includeRequestBodyInError: false,
      };

      const requestBody = { sensitive: 'data' };

      try {
        await apiCall(config, requestBody);
        expect.fail('Should have thrown');
      } catch (error) {
        const errorMessage = (error as Error).toString();
        expect(errorMessage).not.toContain('Request Body');
        expect(errorMessage).not.toContain('sensitive');
        expect(errorMessage).not.toContain('data');
      }
    });
    it.each([
      { body: null, expected: 'null' },
      { body: 0, expected: '0' },
      { body: false, expected: 'false' },
      { body: '', expected: '""' },
    ])(
      'should include falsy request body %s in error by default',
      async ({ body, expected }) => {
        const mockFetch = vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'invalid request' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        );

        const config: AxAPIConfig = {
          url: 'https://api.example.com/test',
          fetch: mockFetch,
          retry: { maxRetries: 0 },
        };

        try {
          await apiCall(config, body);
          expect.fail('Should have thrown');
        } catch (error) {
          const errorMessage = (error as Error).toString();
          expect(errorMessage).toContain('Request Body');
          expect(errorMessage).toContain(expected);
        }
      }
    );
  });
});
