import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AxAIServiceAbortedError,
  type AxAIServiceError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceStreamTerminatedError,
  type AxAPIConfig,
  apiCall,
} from './apicall.js';

describe('apiCall', () => {
  describe('HTTP method selection', () => {
    it.each([
      [{}, 'POST'],
      [{ put: true }, 'PUT'],
      [{ method: 'PATCH', put: true }, 'PATCH'],
    ] as const)(
      'uses the configured method for fetch and tracing',
      async (methodOptions, expectedMethod) => {
        const mockFetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
        const span = {
          setAttributes: vi.fn(),
        };

        await apiCall(
          {
            url: 'https://api.example.com/test',
            fetch: mockFetch,
            span: span as any,
            ...methodOptions,
          },
          { test: 'data' }
        );

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(URL),
          expect.objectContaining({ method: expectedMethod })
        );
        expect(span.setAttributes).toHaveBeenCalledWith(
          expect.objectContaining({ 'http.request.method': expectedMethod })
        );
      }
    );
  });

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

  describe('includeRequestBodyInErrors', () => {
    it('preserves a non-token-limit JSON body on 400 errors', async () => {
      const responseBody = {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'Cached content has expired',
        },
      };
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        })
      );

      try {
        await apiCall(
          {
            url: 'https://api.example.com/test',
            fetch: mockFetch,
            retry: { maxRetries: 0 },
          },
          { cachedContent: 'cachedContents/stale' }
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceStatusError);
        expect((error as AxAIServiceStatusError).responseBody).toMatchObject({
          responseBody,
        });
      }
    });

    it('reads an empty 400 response body only once', async () => {
      const response = new Response('', {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      });
      const jsonSpy = vi.spyOn(response, 'json');
      const mockFetch = vi.fn().mockResolvedValue(response);

      await expect(
        apiCall(
          {
            url: 'https://api.example.com/test',
            fetch: mockFetch,
            retry: { maxRetries: 0 },
          },
          { test: 'data' }
        )
      ).rejects.toBeInstanceOf(AxAIServiceStatusError);

      expect(jsonSpy).toHaveBeenCalledTimes(1);
    });

    it('should include request body in error toString by default', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad request' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
        })
      );

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: { maxRetries: 0 },
      };

      try {
        await apiCall(config, { sensitiveData: 'secret123' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceStatusError);
        const errorString = (error as AxAIServiceError).toString();
        expect(errorString).toContain('Request Body:');
        expect(errorString).toContain('sensitiveData');
        expect(errorString).toContain('secret123');
      }
    });

    it('should exclude request body from error toString when includeRequestBodyInErrors is false', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad request' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
        })
      );

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: { maxRetries: 0 },
        includeRequestBodyInErrors: false,
      };

      try {
        await apiCall(config, { sensitiveData: 'secret123' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceStatusError);
        const errorString = (error as AxAIServiceError).toString();
        expect(errorString).not.toContain('Request Body:');
        expect(errorString).not.toContain('sensitiveData');
        expect(errorString).not.toContain('secret123');
      }
    });

    it('should still store requestBody on error object even when not included in toString', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad request' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
        })
      );

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: { maxRetries: 0 },
        includeRequestBodyInErrors: false,
      };

      try {
        await apiCall(config, { sensitiveData: 'secret123' });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceStatusError);
        const serviceError = error as AxAIServiceError;
        // The requestBody is still accessible programmatically
        expect(serviceError.requestBody).toEqual({
          sensitiveData: 'secret123',
        });
        // But not in the string representation
        expect(serviceError.toString()).not.toContain('secret123');
      }
    });

    it('should exclude request body from network errors when includeRequestBodyInErrors is false', async () => {
      const networkError = new TypeError('network failure');
      const mockFetch = vi.fn().mockRejectedValue(networkError);

      const config: AxAPIConfig = {
        url: 'https://api.example.com/test',
        fetch: mockFetch,
        retry: { maxRetries: 0 },
        includeRequestBodyInErrors: false,
      };

      try {
        await apiCall(config, {
          largeBase64: 'data:image/png;base64,AAAAA...',
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AxAIServiceNetworkError);
        const errorString = (error as AxAIServiceError).toString();
        expect(errorString).not.toContain('Request Body:');
        expect(errorString).not.toContain('largeBase64');
      }
    });
  });

  describe('SSE streaming failures', () => {
    const startStreamingCall = async (abortController?: AbortController) => {
      let bodyController:
        | ReadableStreamDefaultController<Uint8Array>
        | undefined;
      const mockFetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              bodyController = controller;
              controller.enqueue(
                new TextEncoder().encode('data: {"index":0}\n\n')
              );
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(init.signal?.reason),
                { once: true }
              );
            },
          });

          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
        }
      );

      const stream = (await apiCall<{ test: string }, { index: number }>(
        {
          url: 'https://api.example.com/test',
          fetch: mockFetch,
          stream: true,
          ...(abortController ? { abortSignal: abortController.signal } : {}),
        },
        { test: 'data' }
      )) as ReadableStream<{ index: number }>;

      if (!bodyController) {
        throw new Error('Response body controller was not initialized');
      }

      return { bodyController, reader: stream.getReader() };
    };

    describe.each([
      ['Node', false],
      ['browser', true],
    ] as const)('%s reader', (_runtime, browser) => {
      afterEach(() => {
        vi.unstubAllGlobals();
      });

      const configureRuntime = () => {
        if (browser) {
          vi.stubGlobal('window', {});
          vi.stubGlobal('EventSource', vi.fn());
        }
      };

      it('classifies a caller abort as AxAIServiceAbortedError', async () => {
        configureRuntime();
        const abortController = new AbortController();
        const { reader } = await startStreamingCall(abortController);

        await expect(reader.read()).resolves.toEqual({
          done: false,
          value: { index: 0 },
        });

        abortController.abort(
          new DOMException('Caller aborted request', 'AbortError')
        );

        await expect(reader.read()).rejects.toBeInstanceOf(
          AxAIServiceAbortedError
        );
      });

      it('keeps a remote abort classified as AxAIServiceStreamTerminatedError', async () => {
        configureRuntime();
        const { bodyController, reader } = await startStreamingCall();

        await expect(reader.read()).resolves.toEqual({
          done: false,
          value: { index: 0 },
        });

        bodyController.error(
          new DOMException('Remote stream aborted', 'AbortError')
        );

        try {
          await reader.read();
          expect.fail('Expected the remote stream to terminate');
        } catch (error) {
          expect(error).toBeInstanceOf(AxAIServiceStreamTerminatedError);
          expect((error as AxAIServiceStreamTerminatedError).lastChunk).toEqual(
            { index: 0 }
          );
        }
      });
    });

    it('does not orphan the Node reader rejection after a caller abort', async () => {
      const unhandledRejection = vi.fn();
      process.on('unhandledRejection', unhandledRejection);

      try {
        const abortController = new AbortController();
        const { reader } = await startStreamingCall(abortController);

        await reader.read();
        abortController.abort(
          new DOMException('Caller aborted request', 'AbortError')
        );
        await expect(reader.read()).rejects.toBeInstanceOf(
          AxAIServiceAbortedError
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(unhandledRejection).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandledRejection);
      }
    });
  });

  describe.each([
    ['Node', false],
    ['browser', true],
  ] as const)('%s SSE streaming', (_runtime, browser) => {
    const configureRuntime = () => {
      if (browser) {
        vi.stubGlobal('window', {});
        vi.stubGlobal('EventSource', vi.fn());
      }
    };

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const sseResponse = (
      events: string | Array<string | Uint8Array>
    ): Response => {
      const body = Array.isArray(events)
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              for (const event of events) {
                controller.enqueue(
                  typeof event === 'string' ? encoder.encode(event) : event
                );
              }
              controller.close();
            },
          })
        : events;

      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const collectStream = async (
      events: string | Array<string | Uint8Array>
    ) => {
      configureRuntime();
      const mockFetch = vi.fn().mockResolvedValue(sseResponse(events));

      const stream = (await apiCall<{ test: string }, { index: number }>(
        {
          url: 'https://api.example.com/test',
          fetch: mockFetch,
          stream: true,
        },
        { test: 'data' }
      )) as ReadableStream<{ index: number }>;

      const reader = stream.getReader();
      const chunks: { index: number }[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
      }
      return chunks;
    };

    it('ends the stream when the provider sends no [DONE] sentinel', async () => {
      await expect(
        collectStream('data: {"index":0}\n\ndata: {"index":1}\n\n')
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    it('ends the stream when the last event has no trailing blank line', async () => {
      await expect(
        collectStream('data: {"index":0}\n\ndata: {"index":1}')
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    it.each([
      ['terminated by a blank line', 'data: [DONE]\n\n'],
      ['sent as a trailing event', 'data: [DONE]'],
    ])('stops at the [DONE] sentinel %s', async (_label, sentinel) => {
      await expect(
        collectStream(`data: {"index":0}\n\ndata: {"index":1}\n\n${sentinel}`)
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    // The SSE spec allows \r\n line endings. Without normalization the event
    // boundary is never found and the buffer grows for the whole response.
    it('splits events on \\r\\n\\r\\n boundaries', async () => {
      await expect(
        collectStream('data: {"index":0}\r\n\r\ndata: {"index":1}\r\n\r\n')
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    it('keeps CRLF boundaries whole when split across chunks', async () => {
      await expect(
        collectStream([
          'data: {"index":0}\r',
          '\n\r',
          '\ndata: {"index":1}\r',
          '\n\r',
          '\n',
        ])
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    it('splits events on bare \\r boundaries', async () => {
      await expect(
        collectStream('data: {"index":0}\r\rdata: {"index":1}\r')
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    // The spec concatenates repeated data: fields with \n.
    it('concatenates multi-line data fields', async () => {
      await expect(
        collectStream('data: {"index":\ndata: 0}\n\n')
      ).resolves.toEqual([{ index: 0 }]);
    });

    // The space after the colon is optional in the SSE spec.
    it('accepts data fields with no space after the colon', async () => {
      await expect(
        collectStream('data:{"index":0}\n\ndata:{"index":1}\n\n')
      ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    it('stops at a [DONE] sentinel sent with \\r\\n line endings', async () => {
      await expect(
        collectStream('data: {"index":0}\r\n\r\ndata: [DONE]\r\n\r\n')
      ).resolves.toEqual([{ index: 0 }]);
    });

    it('decodes every UTF-8 byte boundary through the shared parser', async () => {
      const body =
        '\uFEFFdata: {"label":"snowman ☃",\r\ndata: "index":0}\r\n\r\ndata: [DONE]\r\n\r\n';
      const chunks = Array.from(new TextEncoder().encode(body), (byte) =>
        Uint8Array.of(byte)
      );

      await expect(collectStream(chunks)).resolves.toEqual([
        { label: 'snowman ☃', index: 0 },
      ]);
    });
  });
});
