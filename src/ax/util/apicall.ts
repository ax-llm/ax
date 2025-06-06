import crypto from 'crypto'
import {
  ReadableStream,
  TextDecoderStream as TextDecoderStreamNative,
  TransformStream,
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
  streamDuration?: number
  errorTime?: number
}

// Validation Interfaces
interface RequestValidation {
  validateRequest?: (request: unknown) => boolean | Promise<boolean>
}

interface ResponseValidation {
  validateResponse?: (response: unknown) => boolean | Promise<boolean>
}

// API Base Types
export interface AxAPI {
  name?: string
  headers?: Record<string, string>
  put?: boolean
}

// Enhanced API Configuration
export interface AxAPIConfig
  extends AxAPI,
    RequestValidation,
    ResponseValidation {
  url: string | URL
  stream?: boolean
  debug?: boolean
  fetch?: typeof fetch
  span?: Span
  timeout?: number
  retry?: Partial<RetryConfig>
  abortSignal?: AbortSignal
}

// Default Configurations
export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffFactor: 2,
  retryableStatusCodes: [500, 408, 429, 502, 503, 504],
}

const defaultTimeoutMs = 30000
const textDecoderStream = TextDecoderStreamNative ?? TextDecoderStreamPolyfill

// Error Classes
export class AxAIServiceError extends Error {
  public readonly timestamp: string
  public readonly errorId: string
  public readonly context: Record<string, unknown>

  constructor(
    message: string,
    public readonly url: string,
    public readonly requestBody: unknown,
    public readonly responseBody: unknown,
    context: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = this.constructor.name
    this.timestamp = new Date().toISOString()
    this.errorId = crypto.randomUUID()
    this.context = context

    this.stack = this.toString()
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
    ].join('\n')
  }

  // For Node.js, override the custom inspect method so console.log shows our custom string.
  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString()
  }
}

export class AxAIServiceStatusError extends AxAIServiceError {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    url: string,
    requestBody: unknown,
    responseBody: unknown,
    context?: Record<string, unknown>
  ) {
    super(`HTTP ${status} - ${statusText}`, url, requestBody, {
      httpStatus: status,
      httpStatusText: statusText,
      responseBody,
      ...context,
    })
    this.name = this.constructor.name
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
    )
    this.name = this.constructor.name
    this.stack = originalError.stack
  }
}

export class AxAIServiceResponseError extends AxAIServiceError {
  constructor(
    message: string,
    url: string,
    requestBody?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, url, requestBody, undefined, context)
    this.name = this.constructor.name
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
    )
    this.name = this.constructor.name
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
    )
    this.name = this.constructor.name
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
    )
    this.name = this.constructor.name
  }
}

export class AxAIServiceAuthenticationError extends AxAIServiceError {
  constructor(
    url: string,
    requestBody: unknown,
    responseBody: unknown,
    context?: Record<string, unknown>
  ) {
    super('Authentication failed', url, requestBody, responseBody, context)
    this.name = this.constructor.name
  }
}

// Utility Functions
function calculateRetryDelay(
  attempt: number,
  config: Readonly<RetryConfig>
): number {
  const delay = Math.min(
    config.maxDelayMs,
    config.initialDelayMs * Math.pow(config.backoffFactor, attempt)
  )
  return delay * (0.75 + Math.random() * 0.5)
}

function createRequestMetrics(): RequestMetrics {
  return {
    startTime: Date.now(),
    retryCount: 0,
  }
}

// eslint-disable-next-line functional/prefer-immutable-types
function updateRetryMetrics(metrics: RequestMetrics): void {
  metrics.retryCount++
  metrics.lastRetryTime = Date.now()
}

function shouldRetry(
  error: Error,
  status: number | undefined,
  attempt: number,
  config: Readonly<RetryConfig>
): boolean {
  if (attempt >= config.maxRetries) return false
  if (status && config.retryableStatusCodes.includes(status)) return true

  return (
    error instanceof AxAIServiceNetworkError &&
    !(error instanceof AxAIServiceAuthenticationError)
  )
}

// Enhanced API Call Function
export const apiCall = async <TRequest = unknown, TResponse = unknown>(
  api: Readonly<AxAPIConfig>,
  json: TRequest
): Promise<TResponse | ReadableStream<TResponse>> => {
  const retryConfig: RetryConfig = { ...defaultRetryConfig, ...api.retry }
  const timeoutMs = api.timeout ?? defaultTimeoutMs
  const metrics = createRequestMetrics()
  let timeoutId: NodeJS.Timeout

  const baseUrl = new URL(process.env['PROXY'] ?? api.url)
  const apiPath = `${[baseUrl.pathname, api.name]
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')}${baseUrl.search}`
  const apiUrl = new URL(apiPath, baseUrl)

  const requestId = crypto.randomUUID()

  // Validate request if validator is provided
  if (api.validateRequest) {
    const isValid = await api.validateRequest(json)
    if (!isValid) {
      throw new AxAIServiceResponseError(
        'Invalid request data',
        apiUrl.href,
        json,
        { validation: 'request' }
      )
    }
  }

  // Set up telemetry
  api.span?.setAttributes({
    'http.request.method': api.put ? 'PUT' : 'POST',
    'url.full': apiUrl.href,
    'request.id': requestId,
    'request.startTime': metrics.startTime,
  })

  let attempt = 0

  while (true) {
    // Combine user abort signal with timeout signal
    const combinedAbortController = new AbortController()

    // Handle user abort signal
    if (api.abortSignal) {
      if (api.abortSignal.aborted) {
        throw new AxAIServiceAbortedError(
          apiUrl.href,
          api.abortSignal.reason,
          json,
          { metrics }
        )
      }

      const userAbortHandler = () => {
        combinedAbortController.abort(
          api.abortSignal!.reason || 'User aborted request'
        )
      }
      api.abortSignal.addEventListener('abort', userAbortHandler, {
        once: true,
      })

      // Clean up listener if we complete before abort
      const originalAbort = combinedAbortController.abort.bind(
        combinedAbortController
      )
      combinedAbortController.abort = (reason?: string) => {
        api.abortSignal!.removeEventListener('abort', userAbortHandler)
        originalAbort(reason)
      }
    }

    timeoutId = setTimeout(() => {
      combinedAbortController.abort('Request timeout')
    }, timeoutMs)

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
      })

      clearTimeout(timeoutId)

      // Handle authentication errors
      if (res.status === 401 || res.status === 403) {
        throw new AxAIServiceAuthenticationError(apiUrl.href, json, res.body, {
          metrics,
        })
      }

      // Handle retryable status codes
      if (
        res.status >= 400 &&
        shouldRetry(new Error(), res.status, attempt, retryConfig)
      ) {
        const delay = calculateRetryDelay(attempt, retryConfig)
        attempt++
        updateRetryMetrics(metrics)

        api.span?.addEvent('retry', {
          attempt,
          delay,
          status: res.status,
          'metrics.startTime': metrics.startTime,
          'metrics.retryCount': metrics.retryCount,
          'metrics.lastRetryTime': metrics.lastRetryTime,
        })

        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      if (res.status >= 400) {
        throw new AxAIServiceStatusError(
          res.status,
          res.statusText,
          apiUrl.href,
          json,
          res.body,
          { metrics }
        )
      }

      // Handle non-streaming response
      if (!api.stream) {
        const resJson = await res.json()

        // Validate response if validator is provided
        if (api.validateResponse) {
          const isValid = await api.validateResponse(resJson)
          if (!isValid) {
            throw new AxAIServiceResponseError(
              'Invalid response data',
              apiUrl.href,
              json,
              { validation: 'response' }
            )
          }
        }

        api.span?.setAttributes({
          'response.time': Date.now() - metrics.startTime,
          'response.retries': metrics.retryCount,
        })

        return resJson as TResponse
      }

      // Handle streaming response
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

      // Enhanced tracking stream
      const trackingStream = new TransformStream<TResponse, TResponse>({
        transform(chunk, controller) {
          lastChunk = chunk
          chunkCount++
          metrics.streamChunks = chunkCount
          metrics.lastChunkTime = Date.now()
          controller.enqueue(chunk)

          api.span?.addEvent('stream.chunk', {
            'stream.chunks': chunkCount,
            'stream.duration': Date.now() - metrics.startTime,
            'response.retries': metrics.retryCount,
          })
        },
      })

      // Flag to track if the controller is closed.
      let closed = false

      // Enhanced wrapped stream
      return new ReadableStream<TResponse>({
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
                  if (!closed) {
                    closed = true
                    controller.close()
                  }
                  break
                }

                // Check if the controller is already closed before enqueuing.
                if (closed) break
                controller.enqueue(value)
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
                )
              } else {
                controller.error(
                  new AxAIServiceNetworkError(
                    error,
                    apiUrl.href,
                    json,
                    res.body,
                    {
                      streamMetrics,
                    }
                  )
                )
              }
              throw error
            } finally {
              clearTimeout(timeoutId)
              reader.releaseLock()
            }
          }

          read()
        },
        // When the consumer cancels the stream, set our flag to stop processing further.
        cancel() {
          closed = true
        },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Check if this was a user abort or timeout
        if (api.abortSignal?.aborted) {
          throw new AxAIServiceAbortedError(
            apiUrl.href,
            api.abortSignal.reason,
            json,
            { metrics }
          )
        } else {
          throw new AxAIServiceTimeoutError(apiUrl.href, timeoutMs, json, {
            metrics,
          })
        }
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
        shouldRetry(error, undefined, attempt, retryConfig)
      ) {
        const delay = calculateRetryDelay(attempt, retryConfig)
        attempt++
        updateRetryMetrics(metrics)

        api.span?.addEvent('retry', {
          attempt,
          delay,
          error: error.message,
          'metrics.startTime': metrics.startTime,
          'metrics.retryCount': metrics.retryCount,
          'metrics.lastRetryTime': metrics.lastRetryTime,
        })

        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      if (error instanceof AxAIServiceError) {
        error.context['metrics'] = metrics
      }

      throw error
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }
}

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
