// Web Streams API types are now available globally via DOM types in tsconfig
import type { Span } from '@opentelemetry/api';
import { randomUUID } from './crypto.js';

import { SSEParser } from './sse.js';
import { TextDecoderStreamPolyfill } from './stream.js';

// Configuration Types
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  retryableStatusCodes: number[];
}

export interface RequestMetrics {
  startTime: number;
  retryCount: number;
  lastRetryTime?: number;
  streamChunks?: number;
  lastChunkTime?: number;
  streamDuration?: number;
  errorTime?: number;
}

// Validation Interfaces
interface RequestValidation {
  validateRequest?: (request: unknown) => boolean | Promise<boolean>;
}

interface ResponseValidation {
  validateResponse?: (response: unknown) => boolean | Promise<boolean>;
}

// API Base Types
export interface AxAPI {
  name?: string;
  headers?: Record<string, string>;
  put?: boolean;
  localCall?: <TRequest, TResponse>(
    data: TRequest,
    stream?: boolean
  ) => Promise<TResponse | ReadableStream<TResponse>>;
}

// Enhanced API Configuration
export interface AxAPIConfig
  extends AxAPI,
    RequestValidation,
    ResponseValidation {
  url?: string | URL; // Make URL optional when localCall is provided
  stream?: boolean;
  debug?: boolean;
  fetch?: typeof fetch;
  span?: Span;
  timeout?: number;
  retry?: Partial<RetryConfig>;
  abortSignal?: AbortSignal;
  corsProxy?: string;
}

// Default Configurations
export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffFactor: 2,
  retryableStatusCodes: [500, 408, 429, 502, 503, 504],
};

const textDecoderStream =
  (globalThis as any).TextDecoderStream ?? TextDecoderStreamPolyfill;

// Error Classes
export class AxAIServiceError extends Error {
  public readonly timestamp: string;
  public readonly errorId: string;
  public readonly context: Record<string, unknown>;

  constructor(
    message: string,
    public readonly url: string,
    public readonly requestBody: unknown,
    public readonly responseBody: unknown,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AxAIServiceError';
    this.timestamp = new Date().toISOString();
    this.errorId = randomUUID();
    this.context = context;

    this.stack = this.toString();
  }

  override toString(): string {
    return [
      `${this.name}: ${this.message}`,
      `URL: ${this.url}`,
      `Request Body: ${JSON.stringify(this.requestBody, null, 2)}`,
      `Response Body: ${JSON.stringify(this.responseBody, null, 2)}`,
      `Context: ${JSON.stringify(this.context, null, 2)}`,
      `Timestamp: ${this.timestamp}`,
      `Error ID: ${this.errorId}`,
    ].join('\n');
  }

  // For Node.js, override the custom inspect method so console.log shows our custom string.
  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}

export class AxAIServiceStatusError extends AxAIServiceError {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    url: string,
    requestBody: unknown,
    responseBody: unknown,
    context?: Record<string, unknown>,
    retryCount?: number
  ) {
    const retryInfo = retryCount ? ` (after ${retryCount} retries)` : '';
    super(`HTTP ${status} - ${statusText}${retryInfo}`, url, requestBody, {
      httpStatus: status,
      httpStatusText: statusText,
      responseBody,
      ...context,
    });
    this.name = 'AxAIServiceStatusError';
  }
}

export class AxAIServiceNetworkError extends AxAIServiceError {
  constructor(
    public readonly originalError: Error,
    url: string,
    requestBody: unknown,
    responseBody: unknown,
    context?: Record<string, unknown>
  ) {
    super(
      `Network Error: ${originalError.message}`,
      url,
      requestBody,
      responseBody,
      {
        originalErrorName: originalError.name,
        originalErrorStack: originalError.stack,
        ...context,
      }
    );
    this.name = 'AxAIServiceNetworkError';
    this.stack = originalError.stack;
  }
}

export class AxAIServiceResponseError extends AxAIServiceError {
  constructor(
    message: string,
    url: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, url, requestBody, undefined, context);
    this.name = 'AxAIServiceResponseError';
  }
}

export class AxAIServiceStreamTerminatedError extends AxAIServiceError {
  constructor(
    url: string,
    requestBody?: unknown,
    public readonly lastChunk?: unknown,
    context?: Record<string, unknown>
  ) {
    super(
      'Stream terminated unexpectedly by remote host',
      url,
      requestBody,
      undefined,
      {
        lastChunk,
        ...context,
      }
    );
    this.name = 'AxAIServiceStreamTerminatedError';
  }
}

export class AxAIServiceTimeoutError extends AxAIServiceError {
  constructor(
    url: string,
    timeoutMs: number,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(
      `Request timed out after ${timeoutMs}ms`,
      url,
      requestBody,
      undefined,
      { timeoutMs, ...context }
    );
    this.name = 'AxAIServiceTimeoutError';
  }
}

export class AxAIServiceAbortedError extends AxAIServiceError {
  constructor(
    url: string,
    reason?: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(
      `Request aborted${reason ? `: ${reason}` : ''}`,
      url,
      requestBody,
      undefined,
      { abortReason: reason, ...context }
    );
    this.name = 'AxAIServiceAbortedError';
  }
}

export class AxAIServiceAuthenticationError extends AxAIServiceError {
  constructor(
    url: string,
    requestBody: unknown,
    responseBody: unknown,
    context?: Record<string, unknown>
  ) {
    super('Authentication failed', url, requestBody, responseBody, context);
    this.name = 'AxAIServiceAuthenticationError';
  }
}

export class AxAIRefusalError extends Error {
  public readonly timestamp: string;
  public readonly errorId: string;

  constructor(
    public readonly refusalMessage: string,
    public readonly model?: string,
    public readonly requestId?: string
  ) {
    super(`Model refused to fulfill request: ${refusalMessage}`);
    this.name = 'AxAIRefusalError';
    this.timestamp = new Date().toISOString();
    this.errorId = randomUUID();
  }

  override toString(): string {
    return [
      `${this.name}: ${this.message}`,
      `Refusal: ${this.refusalMessage}`,
      this.model ? `Model: ${this.model}` : '',
      this.requestId ? `Request ID: ${this.requestId}` : '',
      `Timestamp: ${this.timestamp}`,
      `Error ID: ${this.errorId}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  // For Node.js, override the custom inspect method so console.log shows our custom string.
  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}

/**
 * Error thrown when an AI provider doesn't support a required media type.
 *
 * This error is thrown during content processing when a provider cannot handle
 * a specific media type and no suitable fallback mechanism is available or configured.
 *
 * @example
 * ```typescript
 * try {
 *   await textOnlyProvider.chat(imageRequest);
 * } catch (error) {
 *   if (error instanceof AxMediaNotSupportedError) {
 *     console.log(`${error.mediaType} not supported by ${error.provider}`);
 *     if (error.fallbackAvailable) {
 *       console.log('Consider using content processing services');
 *     }
 *   }
 * }
 * ```
 */
export class AxMediaNotSupportedError extends Error {
  /** ISO timestamp when the error occurred */
  public readonly timestamp: string;
  /** Unique identifier for this error instance */
  public readonly errorId: string;

  /**
   * Creates a new media not supported error.
   *
   * @param mediaType - The type of media that is not supported (e.g., 'Images', 'Audio')
   * @param provider - The name of the AI provider that doesn't support the media type
   * @param fallbackAvailable - Whether fallback processing options are available
   */
  constructor(
    public readonly mediaType: string,
    public readonly provider: string,
    public readonly fallbackAvailable: boolean = false
  ) {
    super(
      `${mediaType} not supported by ${provider}${fallbackAvailable ? ' (fallback available)' : ''}`
    );
    this.name = 'AxMediaNotSupportedError';
    this.timestamp = new Date().toISOString();
    this.errorId = randomUUID();
  }

  override toString(): string {
    return [
      `${this.name}: ${this.message}`,
      `Media Type: ${this.mediaType}`,
      `Provider: ${this.provider}`,
      `Fallback Available: ${this.fallbackAvailable}`,
      `Timestamp: ${this.timestamp}`,
      `Error ID: ${this.errorId}`,
    ].join('\n');
  }

  // For Node.js, override the custom inspect method so console.log shows our custom string.
  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}

/**
 * Error thrown when content processing/transformation fails.
 *
 * This error wraps underlying failures from content processing services like
 * image-to-text, audio transcription, file text extraction, or URL content fetching.
 * It provides context about what type of content was being processed and at which step.
 *
 * @example
 * ```typescript
 * try {
 *   await axProcessContentForProvider(content, provider, {
 *     imageToText: imageService.analyze
 *   });
 * } catch (error) {
 *   if (error instanceof AxContentProcessingError) {
 *     console.log(`Failed processing ${error.contentType} during ${error.processingStep}`);
 *     console.log('Original error:', error.originalError.message);
 *   }
 * }
 * ```
 */
export class AxContentProcessingError extends Error {
  /** ISO timestamp when the error occurred */
  public readonly timestamp: string;
  /** Unique identifier for this error instance */
  public readonly errorId: string;

  /**
   * Creates a new content processing error.
   *
   * @param originalError - The underlying error that caused the processing failure
   * @param contentType - The type of content being processed (e.g., 'image', 'audio', 'file')
   * @param processingStep - The specific processing step that failed (e.g., 'vision analysis', 'transcription')
   */
  constructor(
    public readonly originalError: Error,
    public readonly contentType: string,
    public readonly processingStep: string
  ) {
    super(
      `Failed to process ${contentType} during ${processingStep}: ${originalError.message}`
    );
    this.name = 'AxContentProcessingError';
    this.timestamp = new Date().toISOString();
    this.errorId = randomUUID();
  }

  override toString(): string {
    return [
      `${this.name}: ${this.message}`,
      `Content Type: ${this.contentType}`,
      `Processing Step: ${this.processingStep}`,
      `Original Error: ${this.originalError.message}`,
      `Timestamp: ${this.timestamp}`,
      `Error ID: ${this.errorId}`,
    ].join('\n');
  }

  // For Node.js, override the custom inspect method so console.log shows our custom string.
  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}

// Utility Functions
async function safeReadResponseBody(response: Response): Promise<unknown> {
  try {
    if (response.headers.get('content-type')?.includes('application/json')) {
      return await response.json();
    }

    // Clone the response so we can read it without consuming the original
    const clonedResponse = response.clone();
    return await clonedResponse.text();
  } catch (e) {
    // If we can't read the body, return a descriptive message
    return `[ReadableStream - read failed: ${(e as Error).message}]`;
  }
}

function calculateRetryDelay(
  attempt: number,
  config: Readonly<RetryConfig>
): number {
  const delay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * config.backoffFactor ** attempt
  );
  return delay * (0.75 + Math.random() * 0.5);
}

function createRequestMetrics(): RequestMetrics {
  return {
    startTime: Date.now(),
    retryCount: 0,
  };
}

// eslint-disable-next-line functional/prefer-immutable-types
function updateRetryMetrics(metrics: RequestMetrics): void {
  metrics.retryCount++;
  metrics.lastRetryTime = Date.now();
}

function shouldRetry(
  error: Error,
  status: number | undefined,
  attempt: number,
  config: Readonly<RetryConfig>
): boolean {
  if (attempt >= config.maxRetries) return false;
  if (status && config.retryableStatusCodes.includes(status)) return true;

  return (
    error instanceof AxAIServiceNetworkError &&
    !(error instanceof AxAIServiceAuthenticationError)
  );
}

// Enhanced API Call Function
export const apiCall = async <TRequest = unknown, TResponse = unknown>(
  api: Readonly<AxAPIConfig>,
  json: TRequest
): Promise<TResponse | ReadableStream<TResponse>> => {
  // If localCall is provided, use it instead of HTTP
  if (api.localCall) {
    return await api.localCall<TRequest, TResponse>(json, api.stream);
  }

  // Ensure URL is provided for HTTP calls
  if (!api.url) {
    throw new Error('API URL is required when localCall is not provided');
  }

  const retryConfig: RetryConfig = { ...defaultRetryConfig, ...api.retry };
  const timeoutMs = api.timeout;
  const metrics = createRequestMetrics();
  let timeoutId: NodeJS.Timeout | undefined;

  const baseUrl = new URL(api.url);
  const apiPath = `${[baseUrl.pathname, api.name]
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')}${baseUrl.search}`;
  let apiUrl = new URL(apiPath, baseUrl);

  // Apply CORS proxy if provided (for browser environments)
  if (api.corsProxy) {
    const originalUrl = apiUrl.href;
    apiUrl = new URL(`${api.corsProxy}?url=${encodeURIComponent(originalUrl)}`);
  }

  const requestId = randomUUID();

  // Validate request if validator is provided
  if (api.validateRequest) {
    const isValid = await api.validateRequest(json);
    if (!isValid) {
      throw new AxAIServiceResponseError(
        'Invalid request data',
        apiUrl.href,
        json,
        { validation: 'request' }
      );
    }
  }

  // Set up telemetry
  api.span?.setAttributes({
    'http.request.method': api.put ? 'PUT' : 'POST',
    'url.full': apiUrl.href,
    'request.id': requestId,
    'request.startTime': metrics.startTime,
  });

  let attempt = 0;

  while (true) {
    // Combine user abort signal with timeout signal
    const combinedAbortController = new AbortController();

    // Handle user abort signal
    if (api.abortSignal) {
      if (api.abortSignal.aborted) {
        throw new AxAIServiceAbortedError(
          apiUrl.href,
          api.abortSignal.reason,
          json,
          { metrics }
        );
      }

      const userAbortHandler = () => {
        combinedAbortController.abort(
          api.abortSignal!.reason || 'User aborted request'
        );
      };
      api.abortSignal.addEventListener('abort', userAbortHandler, {
        once: true,
      });

      // Clean up listener if we complete before abort
      const originalAbort = combinedAbortController.abort.bind(
        combinedAbortController
      );
      combinedAbortController.abort = (reason?: string) => {
        api.abortSignal!.removeEventListener('abort', userAbortHandler);
        originalAbort(reason);
      };
    }

    if (timeoutMs) {
      timeoutId = setTimeout(() => {
        combinedAbortController.abort('Request timeout');
      }, timeoutMs);
    }

    try {
      // Set up timeout with proper cleanup

      const res = await (api.fetch ?? fetch)(apiUrl, {
        method: api.put ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          'X-Retry-Count': attempt.toString(),
          ...api.headers,
        },
        body: JSON.stringify(json),
        signal: combinedAbortController.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Handle authentication errors
      if (res.status === 401 || res.status === 403) {
        const responseBody = await safeReadResponseBody(res);
        throw new AxAIServiceAuthenticationError(
          apiUrl.href,
          json,
          responseBody,
          {
            metrics,
          }
        );
      }

      // Handle retryable status codes
      if (
        res.status >= 400 &&
        shouldRetry(new Error(), res.status, attempt, retryConfig)
      ) {
        const delay = calculateRetryDelay(attempt, retryConfig);
        attempt++;
        updateRetryMetrics(metrics);

        api.span?.addEvent('retry', {
          attempt,
          delay,
          status: res.status,
          'metrics.startTime': metrics.startTime,
          'metrics.retryCount': metrics.retryCount,
          'metrics.lastRetryTime': metrics.lastRetryTime,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (res.status >= 400) {
        const responseBody = await safeReadResponseBody(res);
        throw new AxAIServiceStatusError(
          res.status,
          res.statusText,
          apiUrl.href,
          json,
          responseBody,
          { metrics },
          attempt > 0 ? attempt : undefined
        );
      }

      // Handle non-streaming response
      if (!api.stream) {
        const resJson = await res.json();

        // Validate response if validator is provided
        if (api.validateResponse) {
          const isValid = await api.validateResponse(resJson);
          if (!isValid) {
            throw new AxAIServiceResponseError(
              'Invalid response data',
              apiUrl.href,
              json,
              { validation: 'response' }
            );
          }
        }

        api.span?.setAttributes({
          'response.time': Date.now() - metrics.startTime,
          'response.retries': metrics.retryCount,
        });

        return resJson as TResponse;
      }

      // Handle streaming response
      if (!res.body) {
        throw new AxAIServiceResponseError(
          'Response body is null',
          apiUrl.href,
          json,
          { metrics }
        );
      }

      let lastChunk: TResponse | undefined;
      let chunkCount = 0;

      // Detect if we're in a browser environment with EventSource support
      const isBrowser =
        typeof window !== 'undefined' && typeof EventSource !== 'undefined';

      if (isBrowser) {
        // Use browser-optimized SSE parsing that mimics EventSource behavior
        // We can't use EventSource directly because:
        // 1. It only supports GET requests (we need POST for LLM APIs)
        // 2. It doesn't support custom headers (needed for auth)
        // 3. It doesn't support request bodies (needed for prompts/config)
        return new ReadableStream<TResponse>({
          start(controller) {
            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            async function read() {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    closed = true;
                    controller.close();
                    break;
                  }

                  buffer += decoder.decode(value, { stream: true });

                  // Parse SSE format: split by double newlines for events
                  const events = buffer.split('\n\n');
                  buffer = events.pop() || ''; // Keep incomplete event in buffer

                  for (const event of events) {
                    if (!event.trim()) continue;

                    const lines = event.split('\n');
                    let data = '';
                    let eventType = 'message';

                    // Parse SSE event fields
                    for (const line of lines) {
                      if (line.startsWith('data: ')) {
                        data = line.slice(6);
                      } else if (line.startsWith('event: ')) {
                        eventType = line.slice(7);
                      }
                      // We could also handle 'id:', 'retry:', etc. if needed
                    }

                    if (data) {
                      // Handle termination signal
                      if (data === '[DONE]') {
                        controller.close();
                        return;
                      }

                      try {
                        const parsed = JSON.parse(data) as TResponse;
                        lastChunk = parsed;
                        chunkCount++;
                        metrics.streamChunks = chunkCount;
                        metrics.lastChunkTime = Date.now();

                        controller.enqueue(parsed);

                        api.span?.addEvent('stream.chunk', {
                          'stream.chunks': chunkCount,
                          'stream.duration': Date.now() - metrics.startTime,
                          'response.retries': metrics.retryCount,
                          'sse.event.type': eventType,
                        });
                      } catch (parseError) {
                        // Skip invalid JSON chunks - this is normal for SSE
                        if (api.debug) {
                          console.warn(
                            'Skipping non-JSON SSE data:',
                            data,
                            parseError
                          );
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                const error = e as Error;
                const streamMetrics = {
                  ...metrics,
                  streamDuration: Date.now() - metrics.startTime,
                };

                if (
                  error.name === 'AbortError' ||
                  error.message?.includes('aborted')
                ) {
                  controller.error(
                    new AxAIServiceStreamTerminatedError(
                      apiUrl.href,
                      json,
                      lastChunk,
                      { streamMetrics }
                    )
                  );
                } else {
                  controller.error(
                    new AxAIServiceNetworkError(
                      error,
                      apiUrl.href,
                      json,
                      '[ReadableStream - consumed during streaming]',
                      {
                        streamMetrics,
                      }
                    )
                  );
                }
              } finally {
                reader.releaseLock();
              }
            }

            read();
          },
        });
      }
      // Use the existing Node.js SSEParser for server-side environments
      const trackingStream = new TransformStream<TResponse, TResponse>({
        transform(chunk, controller) {
          lastChunk = chunk;
          chunkCount++;
          metrics.streamChunks = chunkCount;
          metrics.lastChunkTime = Date.now();

          controller.enqueue(chunk);

          api.span?.addEvent('stream.chunk', {
            'stream.chunks': chunkCount,
            'stream.duration': Date.now() - metrics.startTime,
            'response.retries': metrics.retryCount,
          });
        },
      });

      // Flag to track if the controller is closed.
      let closed = false;

      // Enhanced wrapped stream
      return new ReadableStream<TResponse>({
        start(controller) {
          const reader = res
            .body!.pipeThrough(new textDecoderStream())
            .pipeThrough(new SSEParser<TResponse>())
            .pipeThrough(trackingStream)
            .getReader();

          async function read() {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  if (!closed) {
                    closed = true;
                    controller.close();
                  }
                  break;
                }

                // Check if the controller is already closed before enqueuing.
                if (closed) break;
                controller.enqueue(value);
              }
            } catch (e) {
              const error = e as Error;
              const streamMetrics = {
                ...metrics,
                streamDuration: Date.now() - metrics.startTime,
              };

              if (
                error.name === 'AbortError' ||
                error.message?.includes('aborted')
              ) {
                controller.error(
                  new AxAIServiceStreamTerminatedError(
                    apiUrl.href,
                    json,
                    lastChunk,
                    { streamMetrics }
                  )
                );
              } else if (
                error instanceof TypeError &&
                error.message.includes('cancelled')
              ) {
                controller.error(
                  new AxAIServiceStreamTerminatedError(
                    apiUrl.href,
                    json,
                    lastChunk,
                    {
                      streamMetrics,
                      cancelReason: 'Stream cancelled by client',
                    }
                  )
                );
              } else {
                controller.error(
                  new AxAIServiceNetworkError(
                    error,
                    apiUrl.href,
                    json,
                    '[ReadableStream - consumed during streaming]',
                    {
                      streamMetrics,
                    }
                  )
                );
              }
              throw error;
            } finally {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              reader.releaseLock();
            }
          }

          read();
        },
        // When the consumer cancels the stream, set our flag to stop processing further.
        cancel() {
          closed = true;
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Check if this was a user abort or timeout
        if (api.abortSignal?.aborted) {
          throw new AxAIServiceAbortedError(
            apiUrl.href,
            api.abortSignal.reason,
            json,
            { metrics }
          );
        }
        throw new AxAIServiceTimeoutError(apiUrl.href, timeoutMs || 0, json, {
          metrics,
        });
      }

      // Wrap raw network errors from fetch() in AxAIServiceNetworkError
      // This ensures errors like TLS connection failures, DNS errors, etc. are retried
      let wrappedError: Error = error as Error;
      if (!(error instanceof AxAIServiceError) && error instanceof Error) {
        wrappedError = new AxAIServiceNetworkError(
          error,
          apiUrl.href,
          json,
          undefined,
          { metrics }
        );
      }

      if (api.span?.isRecording()) {
        api.span.recordException(wrappedError);
        api.span.setAttributes({
          'error.time': Date.now() - metrics.startTime,
          'error.retries': metrics.retryCount,
        });
      }

      // Handle retryable network errors
      if (
        wrappedError instanceof AxAIServiceNetworkError &&
        shouldRetry(wrappedError, undefined, attempt, retryConfig)
      ) {
        const delay = calculateRetryDelay(attempt, retryConfig);
        attempt++;
        updateRetryMetrics(metrics);

        api.span?.addEvent('retry', {
          attempt,
          delay,
          error: wrappedError.message,
          'metrics.startTime': metrics.startTime,
          'metrics.retryCount': metrics.retryCount,
          'metrics.lastRetryTime': metrics.lastRetryTime,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (wrappedError instanceof AxAIServiceError) {
        wrappedError.context.metrics = metrics;
      }

      throw wrappedError;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }
};

export function createApiConfig(
  config: Readonly<Partial<AxAPIConfig>>
): AxAPIConfig {
  return {
    retry: defaultRetryConfig,
    ...config,
    url: config.url!, // URL is required
  };
}
