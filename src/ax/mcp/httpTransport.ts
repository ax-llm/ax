import type { AxMCPTransport } from './transport.js'
import type {
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types.js'

export class AxMCPHTTPTransport implements AxMCPTransport {
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
