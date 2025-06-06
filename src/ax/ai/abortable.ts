import type { ReadableStream } from 'node:stream/web'

import type {
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
} from './types.js'

/**
 * Utility class for creating abortable AI requests.
 * Provides a convenient way to manage request cancellation.
 *
 * @example
 * ```typescript
 * const abortable = new AxAbortableAI(ai)
 *
 * // Start a request
 * const responsePromise = abortable.chat({
 *   chatPrompt: [{ role: 'user', content: 'Hello' }]
 * })
 *
 * // Later, abort it
 * abortable.abort('User cancelled')
 *
 * try {
 *   const response = await responsePromise
 * } catch (error) {
 *   if (error instanceof AxAIServiceAbortedError) {
 *     console.log('Request was aborted:', error.message)
 *   }
 * }
 * ```
 */
export class AxAbortableAI<TModel = unknown, TEmbedModel = unknown> {
  private abortController: AbortController
  private readonly ai: AxAIService<TModel, TEmbedModel>

  constructor(ai: AxAIService<TModel, TEmbedModel>) {
    this.ai = ai
    this.abortController = new AbortController()
  }

  /**
   * Get the current abort signal
   */
  get signal(): AbortSignal {
    return this.abortController.signal
  }

  /**
   * Check if the request has been aborted
   */
  get aborted(): boolean {
    return this.abortController.signal.aborted
  }

  /**
   * Abort the ongoing request
   * @param reason Optional reason for the abort
   */
  abort(reason?: string): void {
    this.abortController.abort(reason)
  }

  /**
   * Reset the abort controller to allow new requests
   * This creates a new AbortController, allowing fresh requests
   */
  reset(): void {
    this.abortController = new AbortController()
  }

  /**
   * Send a chat request with abort support
   */
  async chat(
    req: Readonly<AxChatRequest<TModel>>,
    options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<TModel, TEmbedModel>
    >
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    return this.ai.chat(req, {
      ...options,
      abortSignal: this.abortController.signal,
    })
  }

  /**
   * Send an embed request with abort support
   */
  async embed(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>
  ): Promise<AxEmbedResponse> {
    return this.ai.embed(req, {
      ...options,
      abortSignal: this.abortController.signal,
    })
  }

  /**
   * Create a timeout-based abort after specified milliseconds
   * @param timeoutMs Timeout in milliseconds
   * @param reason Optional reason for the timeout abort
   * @returns Timeout ID that can be cleared
   */
  abortAfter(timeoutMs: number, reason = 'Request timeout'): NodeJS.Timeout {
    return setTimeout(() => {
      this.abort(reason)
    }, timeoutMs)
  }

  /**
   * Add an event listener for abort events
   */
  onAbort(callback: (reason?: string) => void): void {
    this.abortController.signal.addEventListener('abort', () => {
      callback(this.abortController.signal.reason)
    })
  }
}

/**
 * Helper function to create an abortable AI instance
 * @param ai The AI service to wrap
 * @returns An AxAbortableAI instance
 */
export function createAbortableAI<TModel = unknown, TEmbedModel = unknown>(
  ai: AxAIService<TModel, TEmbedModel>
): AxAbortableAI<TModel, TEmbedModel> {
  return new AxAbortableAI(ai)
}

/**
 * Utility function to race a request against an abort signal
 * @param requestPromise The request promise to race
 * @param abortSignal The abort signal to race against
 * @returns Promise that resolves with the request result or rejects if aborted
 */
export async function raceWithAbort<T>(
  requestPromise: Promise<T>,
  abortSignal: AbortSignal
): Promise<T> {
  if (abortSignal.aborted) {
    throw new Error(
      `Request aborted: ${abortSignal.reason || 'Unknown reason'}`
    )
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = () => {
      reject(
        new Error(`Request aborted: ${abortSignal.reason || 'Unknown reason'}`)
      )
    }

    abortSignal.addEventListener('abort', abortHandler, { once: true })

    requestPromise
      .then((result) => {
        abortSignal.removeEventListener('abort', abortHandler)
        resolve(result)
      })
      .catch((error) => {
        abortSignal.removeEventListener('abort', abortHandler)
        reject(error)
      })
  })
}
