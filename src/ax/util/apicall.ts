import path from 'path'
import {
  ReadableStream,
  TextDecoderStream as TextDecoderStreamNative,
} from 'stream/web'

import { type Span } from '@opentelemetry/api'

import { SSEParser } from './sse.js'
import { TextDecoderStreamPolyfill } from './stream.js'

// Configuration Types
export interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffFactor: number
  retryableStatusCodes: number[]
}

export interface RequestMetrics {
  startTime: number
  retryCount: number
  lastRetryTime?: number
  streamChunks?: number
  lastChunkTime?: number
}

// Default Configurations
export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000, // Increased to 60 seconds
  backoffFactor: 2,
  retryableStatusCodes: [500, 408, 429, 502, 503, 504],
}

const defaultTimeoutMs = 30000
const textDecoderStream = TextDecoderStreamNative ?? TextDecoderStreamPolyfill

/**
 * Base Error class with enhanced error tracking
 */
export class AxAIServiceError extends Error {
  public readonly timestamp: string
  public readonly errorId: string

  constructor(
    message: string,
    public readonly url: string,
    public readonly requestBody?: unknown,
    public readonly context: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'AxAIServiceError'
    this.timestamp = new Date().toISOString()
    this.errorId = crypto.randomUUID()
  }

  override toString(): string {
    return `${this.name} [${this.errorId}]: ${this.message}
Timestamp: ${this.timestamp}
URL: ${this.url}${
      this.requestBody
        ? `\nRequest Body: ${JSON.stringify(this.requestBody, null, 2)}`
        : ''
    }${
      this.context ? `\nContext: ${JSON.stringify(this.context, null, 2)}` : ''
    }`
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      errorId: this.errorId,
      message: this.message,
      timestamp: this.timestamp,
      url: this.url,
      requestBody: this.requestBody,
      context: this.context,
      stack: this.stack,
    }
  }
}

/**
 * HTTP Status Error with enhanced context
 */
export class AxAIServiceStatusError extends AxAIServiceError {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    url: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(`HTTP ${status} - ${statusText}`, url, requestBody, {
      httpStatus: status,
      httpStatusText: statusText,
      ...context,
    })
    this.name = 'AxAIServiceStatusError'
  }
}

/**
 * Network/IO Error with enhanced context
 */
export class AxAIServiceNetworkError extends AxAIServiceError {
  constructor(
    public readonly originalError: Error,
    url: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(`Network Error: ${originalError.message}`, url, requestBody, {
      originalErrorName: originalError.name,
      originalErrorStack: originalError.stack,
      ...context,
    })
    this.name = 'AxAIServiceNetworkError'
    this.stack = originalError.stack
  }
}

/**
 * Response Processing Error with validation context
 */
export class AxAIServiceResponseError extends AxAIServiceError {
  constructor(
    message: string,
    url: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, url, requestBody, context)
    this.name = 'AxAIServiceResponseError'
  }
}

/**
 * Stream Terminated Error with enhanced context
 */
export class AxAIServiceStreamTerminatedError extends AxAIServiceError {
  constructor(
    url: string,
    requestBody?: unknown,
    public readonly lastChunk?: unknown,
    context?: Record<string, unknown>
  ) {
    super('Stream terminated unexpectedly by remote host', url, requestBody, {
      lastChunk,
      ...context,
    })
    this.name = 'AxAIServiceStreamTerminatedError'
  }
}

/**
 * Request timeout error
 */
export class AxAIServiceTimeoutError extends AxAIServiceError {
  constructor(
    url: string,
    timeoutMs: number,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(`Request timeout after ${timeoutMs}ms`, url, requestBody, {
      timeoutMs,
      ...context,
    })
    this.name = 'AxAIServiceTimeoutError'
  }
}

/**
 * Authentication error
 */
export class AxAIServiceAuthenticationError extends AxAIServiceError {
  constructor(
    url: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super('Authentication failed', url, requestBody, context)
    this.name = 'AxAIServiceAuthenticationError'
  }
}

/**
 * API Configuration interface
 */
export interface AxAPI {
  name?: string
  headers?: Record<string, string>
  put?: boolean
}

/**
 * Extended API Configuration
 */
export interface AxAPIConfig extends AxAPI {
  url: string | URL
  stream?: boolean
  debug?: boolean
  fetch?: typeof fetch
  span?: Span
  timeout?: number
  retry?: Partial<RetryConfig>
}

/**
 * Calculate retry delay using exponential backoff with jitter
 */
function calculateRetryDelay(
  attempt: number,
  config: Readonly<RetryConfig>
): number {
  const delay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * Math.pow(config.backoffFactor, attempt)
  )
  // Add random jitter of ±25%
  return delay * (0.75 + Math.random() * 0.5)
}

/**
 * Create request metrics object
 */
function createRequestMetrics(): RequestMetrics {
  return {
    startTime: Date.now(),
    retryCount: 0,
  }
}

/**
 * Update metrics for retries
 */
// eslint-disable-next-line functional/prefer-immutable-types
function updateRetryMetrics(metrics: RequestMetrics): void {
  metrics.retryCount++
  metrics.lastRetryTime = Date.now()
}

/**
 * Enhanced API call function with comprehensive error handling, retries, and monitoring
 */
export const apiCall = async <TRequest = unknown, TResponse = unknown>(
  api: Readonly<AxAPIConfig>,
  json: TRequest
): Promise<TResponse | ReadableStream<TResponse>> => {
  const retryConfig: RetryConfig = { ...defaultRetryConfig, ...api.retry }
  const timeoutMs = api.timeout ?? defaultTimeoutMs
  const metrics = createRequestMetrics()

  const baseUrl = new URL(process.env['PROXY'] ?? api.url)
  const apiPath = path.join(baseUrl.pathname, api.name ?? '/', baseUrl.search)
  const apiUrl = new URL(apiPath, baseUrl)

  // Request ID for tracking
  const requestId = crypto.randomUUID()

  if (api.span?.isRecording()) {
    api.span.setAttributes({
      'http.request.method': api.put ? 'PUT' : 'POST',
      'url.full': apiUrl.href,
      'request.id': requestId,
      'request.startTime': metrics.startTime,
    })
  }

  let attempt = 0

  while (true) {
    const controller = new AbortController()
    let timeoutId = setTimeout(() => {
      controller.abort('Request timeout')
    }, timeoutMs)

    try {
      const res = await (api.fetch ?? fetch)(apiUrl, {
        method: api.put ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          'X-Retry-Count': attempt.toString(),
          ...api.headers,
        },
        body: JSON.stringify(json),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Handle authentication errors specifically
      if (res.status === 401 || res.status === 403) {
        throw new AxAIServiceAuthenticationError(apiUrl.href, json, { metrics })
      }

      // Handle retryable status codes
      if (
        res.status >= 400 &&
        attempt < retryConfig.maxRetries &&
        retryConfig.retryableStatusCodes.includes(res.status)
      ) {
        const delay = calculateRetryDelay(attempt, retryConfig)
        attempt++
        updateRetryMetrics(metrics)

        if (api.span?.isRecording()) {
          api.span.addEvent('retry', {
            attempt,
            delay,
            status: res.status,
            'metrics.startTime': metrics.startTime,
            'metrics.retryCount': metrics.retryCount,
            'metrics.lastRetryTime': metrics.lastRetryTime,
          })
        }

        clearTimeout(timeoutId)
        continue
      }

      if (res.status >= 400) {
        throw new AxAIServiceStatusError(
          res.status,
          res.statusText,
          apiUrl.href,
          json,
          { metrics }
        )
      }

      if (!api.stream) {
        const resJson = await res.json()

        if (api.span?.isRecording()) {
          api.span.setAttributes({
            'response.time': Date.now() - metrics.startTime,
            'response.retries': metrics.retryCount,
          })
        }

        return resJson as TResponse
      }

      if (!res.body) {
        throw new AxAIServiceResponseError(
          'Response body is null',
          apiUrl.href,
          json,
          { metrics }
        )
      }

      let lastChunk: TResponse | undefined
      let chunkCount = 0

      //   Enhanced transform stream with chunk counting and validation
      const trackingStream = new TransformStream<TResponse, TResponse>({
        transform(chunk, controller) {
          lastChunk = chunk
          chunkCount++
          metrics.streamChunks = chunkCount
          metrics.lastChunkTime = Date.now()
          controller.enqueue(chunk)
        },
        flush(controller) {
          if (api.span?.isRecording()) {
            api.span.setAttributes({
              'stream.chunks': chunkCount,
              'stream.duration': Date.now() - metrics.startTime,
              'response.retries': metrics.retryCount,
            })
          }
          controller.terminate()
        },
      })

      // 🚀 **Wrap the original stream inside a proxy ReadableStream**
      const wrappedStream = new ReadableStream<TResponse>({
        start(controller) {
          const reader = res
            .body!.pipeThrough(new textDecoderStream())
            .pipeThrough(new SSEParser<TResponse>())
            .pipeThrough(trackingStream)
            .getReader()

          async function read() {
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  controller.close()
                  break
                } else {
                  controller.enqueue(value)
                }
              }
            } catch (e) {
              const error = e as Error

              const streamMetrics = {
                ...metrics,
                streamDuration: Date.now() - metrics.startTime,
              }

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
                )
              } else {
                controller.error(
                  new AxAIServiceResponseError(
                    `Stream processing error: ${(error as Error).message}`,
                    apiUrl.href,
                    json,
                    { streamMetrics }
                  )
                )
              }
            } finally {
              reader.releaseLock() // release the reader lock in case of error
            }
          }

          read()
        },
      })

      return wrappedStream
    } catch (error) {
      // Clear timeout on error
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new AxAIServiceTimeoutError(apiUrl.href, timeoutMs, json, {
          metrics,
        })
      }

      if (api.span?.isRecording()) {
        api.span.recordException(error as Error)
        api.span.setAttributes({
          'error.time': Date.now() - metrics.startTime,
          'error.retries': metrics.retryCount,
        })
      }

      // Handle retryable network errors
      if (
        error instanceof AxAIServiceNetworkError &&
        attempt < retryConfig.maxRetries
      ) {
        const delay = calculateRetryDelay(attempt, retryConfig)
        attempt++
        updateRetryMetrics(metrics)

        if (api.span?.isRecording()) {
          api.span.addEvent('retry', {
            attempt,
            delay,
            error: error.message,
            'metrics.startTime': metrics.startTime,
            'metrics.retryCount': metrics.retryCount,
            'metrics.lastRetryTime': metrics.lastRetryTime,
          })
        }
        continue
      }

      if (error instanceof AxAIServiceError) {
        error.context['metrics'] = metrics
      }

      throw error
    }
  }
}

/**
 * Utility function to create API config with defaults
 */
export function createApiConfig(
  config: Readonly<Partial<AxAPIConfig>>
): AxAPIConfig {
  return {
    timeout: defaultTimeoutMs,
    retry: defaultRetryConfig,
    ...config,
    url: config.url!, // URL is required
  }
}
