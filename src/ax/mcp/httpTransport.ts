import type { AxMCPTransport } from './transport.js'
import type {
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types.js'

export class AxMCPHTTPSSETransport implements AxMCPTransport {
  private endpoint: string | null = null
  private sseUrl: string
  private eventSource?: EventSource

  constructor(sseUrl: string) {
    this.sseUrl = sseUrl
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.eventSource = new EventSource(this.sseUrl)

      this.eventSource.addEventListener('endpoint', (event: Event) => {
        try {
          const messageEvent = event as MessageEvent
          const data = JSON.parse(messageEvent.data)
          if (!data.uri) {
            throw new Error('Endpoint URI missing in SSE event data')
          }
          this.endpoint = data.uri
          resolve()
        } catch (error) {
          reject(error)
        }
      })

      this.eventSource.onerror = () => {
        reject(new Error('Failed to establish SSE connection'))
      }
    })
  }

  async send(
    message: JSONRPCRequest<unknown> | JSONRPCNotification
  ): Promise<JSONRPCResponse<unknown>> {
    if (!this.endpoint) {
      throw new Error(
        'HTTPTransport endpoint is not initialized. Call connect() first.'
      )
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`)
    }

    return res.json() as Promise<JSONRPCResponse<unknown>>
  }

  async sendNotification(
    message: Readonly<JSONRPCNotification>
  ): Promise<void> {
    if (!this.endpoint) {
      throw new Error(
        'HTTPTransport endpoint is not initialized. Call connect() first.'
      )
    }
    await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })
  }
}

export interface AxMCPStreamableHTTPTransportOptions {
  /**
   * Custom headers to include with all HTTP requests
   * Note: Content-Type, Accept, and Mcp-Session-Id are managed automatically
   */
  headers?: Record<string, string>

  /**
   * Authorization header value (convenience for common use case)
   * If provided, will be added to the headers as 'Authorization'
   */
  authorization?: string
}

/**
 * AxMCPStreambleHTTPTransport implements the 2025-03-26 Streamable HTTP transport specification
 * This transport uses a single HTTP endpoint that supports both POST and GET methods
 */
export class AxMCPStreambleHTTPTransport implements AxMCPTransport {
  private mcpEndpoint: string
  private sessionId?: string
  private eventSource?: EventSource
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: JSONRPCResponse<unknown>) => void
      reject: (reason: unknown) => void
    }
  >()
  private messageHandler?: (
    message: JSONRPCRequest<unknown> | JSONRPCNotification
  ) => void
  private customHeaders: Record<string, string>

  constructor(
    mcpEndpoint: string,
    options?: AxMCPStreamableHTTPTransportOptions
  ) {
    this.mcpEndpoint = mcpEndpoint
    this.customHeaders = { ...options?.headers }

    // Add authorization header if provided
    if (options?.authorization) {
      this.customHeaders['Authorization'] = options.authorization
    }
  }

  /**
   * Update custom headers (useful for refreshing tokens)
   */
  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = { ...headers }
  }

  /**
   * Update authorization header (convenience method)
   */
  setAuthorization(authorization: string): void {
    this.customHeaders['Authorization'] = authorization
  }

  /**
   * Get a copy of the current custom headers
   */
  getHeaders(): Record<string, string> {
    return { ...this.customHeaders }
  }

  /**
   * Build headers for HTTP requests, merging custom headers with required ones
   */
  private buildHeaders(
    baseHeaders: Record<string, string>
  ): Record<string, string> {
    const headers = { ...this.customHeaders, ...baseHeaders }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }

    return headers
  }

  /**
   * Set a handler for incoming server messages (requests/notifications)
   */
  setMessageHandler(
    handler: (message: JSONRPCRequest<unknown> | JSONRPCNotification) => void
  ): void {
    this.messageHandler = handler
  }

  async connect(): Promise<void> {
    // For Streamable HTTP, connection is implicit when making requests
    // But we can optionally open a GET SSE stream for server-initiated messages
    return Promise.resolve()
  }

  /**
   * Opens an SSE stream to listen for server-initiated messages
   */
  async openListeningStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers = this.buildHeaders({
        Accept: 'text/event-stream',
      })

      // Note: EventSource doesn't support custom headers in standard browsers
      // For custom headers with SSE, you may need to use fetch with ReadableStream
      // or use a library that supports custom headers
      const url = new URL(this.mcpEndpoint)

      // If we have custom headers, we need to use fetch instead of EventSource
      if (Object.keys(this.customHeaders).length > 0) {
        this.openListeningStreamWithFetch(headers).then(resolve).catch(reject)
        return
      }

      this.eventSource = new EventSource(url.toString())

      this.eventSource.onopen = () => {
        resolve()
      }

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (this.messageHandler) {
            this.messageHandler(message)
          }
        } catch (error) {
          console.error('Failed to parse SSE message:', error)
        }
      }

      this.eventSource.onerror = () => {
        reject(new Error('Failed to establish SSE connection'))
      }
    })
  }

  /**
   * Opens an SSE stream using fetch API to support custom headers
   */
  private async openListeningStreamWithFetch(
    headers: Record<string, string>
  ): Promise<void> {
    const response = await fetch(this.mcpEndpoint, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      throw new Error(
        `Failed to open SSE stream: ${response.status} ${response.statusText}`
      )
    }

    if (!response.body) {
      throw new Error('No response body available for SSE stream')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const processStream = async (): Promise<void> => {
      try {
        const { done, value } = await reader.read()

        if (done) {
          reader.releaseLock()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6) // Remove 'data: ' prefix
            if (data === '[DONE]') {
              return
            }

            try {
              const message = JSON.parse(data)
              if (this.messageHandler) {
                this.messageHandler(message)
              }
            } catch (error) {
              console.error('Failed to parse SSE data:', error)
            }
          }
        }

        // Continue reading
        await processStream()
      } catch (error) {
        reader.releaseLock()
        throw error
      }
    }

    await processStream()
  }

  async send(
    message: Readonly<JSONRPCRequest<unknown>>
  ): Promise<JSONRPCResponse<unknown>> {
    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })

    const response = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      if (response.status === 404 && this.sessionId) {
        // Session expired, clear it
        this.sessionId = undefined
        throw new Error('Session expired. Please reinitialize.')
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
    }

    // Check if this is the initialization response with session ID
    const sessionIdHeader = response.headers.get('Mcp-Session-Id')
    if (sessionIdHeader) {
      this.sessionId = sessionIdHeader
    }

    const contentType = response.headers.get('Content-Type')

    if (contentType?.includes('text/event-stream')) {
      // Handle SSE response
      return this.handleSSEResponse(response, message.id)
    } else if (contentType?.includes('application/json')) {
      // Handle JSON response
      return response.json() as Promise<JSONRPCResponse<unknown>>
    } else {
      throw new Error(`Unexpected content type: ${contentType}`)
    }
  }

  private async handleSSEResponse(
    response: Response,
    requestId: string | number
  ): Promise<JSONRPCResponse<unknown>> {
    return new Promise((resolve, reject) => {
      const reader = response.body?.getReader()
      if (!reader) {
        reject(new Error('No response body reader available'))
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      const processChunk = async (): Promise<void> => {
        try {
          const { done, value } = await reader.read()

          if (done) {
            reader.releaseLock()
            return
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6) // Remove 'data: ' prefix
              if (data === '[DONE]') {
                return
              }

              try {
                const message = JSON.parse(data)

                // Check if this is the response to our request
                if ('id' in message && message.id === requestId) {
                  resolve(message as JSONRPCResponse<unknown>)
                  return
                }

                // Handle other messages (server requests/notifications)
                if (this.messageHandler) {
                  this.messageHandler(message)
                }
              } catch (error) {
                console.error('Failed to parse SSE data:', error)
              }
            }
          }

          // Continue reading
          await processChunk()
        } catch (error) {
          reader.releaseLock()
          reject(error)
        }
      }

      processChunk().catch(reject)
    })
  }

  async sendNotification(
    message: Readonly<JSONRPCNotification>
  ): Promise<void> {
    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })

    const response = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      if (response.status === 404 && this.sessionId) {
        // Session expired, clear it
        this.sessionId = undefined
        throw new Error('Session expired. Please reinitialize.')
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
    }

    // For notifications, we expect 202 Accepted with no body
    if (response.status !== 202) {
      console.warn(`Unexpected status for notification: ${response.status}`)
    }
  }

  /**
   * Explicitly terminate the session (if supported by server)
   */
  async terminateSession(): Promise<void> {
    if (!this.sessionId) {
      return
    }

    try {
      const headers = this.buildHeaders({})

      const response = await fetch(this.mcpEndpoint, {
        method: 'DELETE',
        headers,
      })

      if (response.status === 405) {
        // Server doesn't support explicit session termination
        console.info('Server does not support explicit session termination')
      }
    } catch (error) {
      console.error('Failed to terminate session:', error)
    } finally {
      this.sessionId = undefined
    }
  }

  /**
   * Close any open connections
   */
  close(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = undefined
    }
  }
}
