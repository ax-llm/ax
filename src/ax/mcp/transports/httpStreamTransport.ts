import type { AxMCPTransport } from '../transport.js';
import type {
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from '../types.js';
import type { AxMCPStreamableHTTPTransportOptions } from './options.js';
import { OAuthHelper } from '../oauth/oauthHelper.js';

export class AxMCPStreambleHTTPTransport implements AxMCPTransport {
  private mcpEndpoint: string;
  private sessionId?: string;
  private eventSource?: EventSource;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (value: AxMCPJSONRPCResponse<unknown>) => void;
      reject: (reason: unknown) => void;
    }
  >();
  private messageHandler?: (
    message: AxMCPJSONRPCRequest<unknown> | AxMCPJSONRPCNotification
  ) => void;
  private customHeaders: Record<string, string>;
  private oauthHelper: OAuthHelper;
  private currentToken?: AxMCPJSONRPCResponse<unknown> | null;
  private currentIssuer?: string;

  constructor(
    mcpEndpoint: string,
    options?: AxMCPStreamableHTTPTransportOptions
  ) {
    this.mcpEndpoint = mcpEndpoint;
    this.customHeaders = { ...(options?.headers ?? {}) };
    if (options?.authorization)
      this.customHeaders.Authorization = options.authorization;
    this.oauthHelper = new OAuthHelper(options?.oauth);
  }

  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = { ...headers };
  }

  setAuthorization(authorization: string): void {
    this.customHeaders.Authorization = authorization;
  }

  getHeaders(): Record<string, string> {
    return { ...this.customHeaders };
  }

  private buildHeaders(
    baseHeaders: Record<string, string>
  ): Record<string, string> {
    const headers = { ...this.customHeaders, ...baseHeaders };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  setMessageHandler(
    handler: (
      message: AxMCPJSONRPCRequest<unknown> | AxMCPJSONRPCNotification
    ) => void
  ): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    return Promise.resolve();
  }

  async openListeningStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers = this.buildHeaders({ Accept: 'text/event-stream' });
      const url = new URL(this.mcpEndpoint);
      if (Object.keys(this.customHeaders).length > 0) {
        this.openListeningStreamWithFetch(headers).then(resolve).catch(reject);
        return;
      }
      this.eventSource = new EventSource(url.toString());
      this.eventSource.onopen = () => resolve();
      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (this.messageHandler) this.messageHandler(message);
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };
      this.eventSource.onerror = () =>
        reject(new Error('Failed to establish SSE connection'));
    });
  }

  private async openListeningStreamWithFetch(
    headers: Record<string, string>
  ): Promise<void> {
    const response = await fetch(this.mcpEndpoint, { method: 'GET', headers });
    if (response.status === 401) {
      const www = response.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.mcpEndpoint,
        wwwAuthenticate: www,
        currentToken: null,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      return this.openListeningStreamWithFetch(
        this.buildHeaders({ Accept: 'text/event-stream' })
      );
    }
    if (!response.ok)
      throw new Error(
        `Failed to open SSE stream: ${response.status} ${response.statusText}`
      );
    if (!response.body)
      throw new Error('No response body available for SSE stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processStream = async (): Promise<void> => {
      try {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              const message = JSON.parse(data);
              if (this.messageHandler) this.messageHandler(message);
            } catch (error) {
              console.error('Failed to parse SSE data:', error);
            }
          }
        }
        await processStream();
      } catch (error) {
        reader.releaseLock();
        throw error;
      }
    };

    await processStream();
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    });
    const body = JSON.stringify(message);

    let response = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers,
      body,
    });
    if (response.status === 401) {
      const www = response.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.mcpEndpoint,
        wwwAuthenticate: www,
        currentToken: null,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      response = await fetch(this.mcpEndpoint, {
        method: 'POST',
        headers: this.buildHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        }),
        body,
      });
    }

    if (!response.ok) {
      if (response.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new Error('Session expired. Please reinitialize.');
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const sessionIdHeader = response.headers.get('Mcp-Session-Id');
    if (sessionIdHeader) this.sessionId = sessionIdHeader;

    const contentType = response.headers.get('Content-Type');
    if (contentType?.includes('text/event-stream'))
      return this.handleSSEResponse(response, message.id);
    if (contentType?.includes('application/json'))
      return response.json() as Promise<AxMCPJSONRPCResponse<unknown>>;
    throw new Error(`Unexpected content type: ${contentType}`);
  }

  private async handleSSEResponse(
    response: Response,
    requestId: string | number
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    return new Promise((resolve, reject) => {
      const reader = response.body?.getReader();
      if (!reader) {
        reject(new Error('No response body reader available'));
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      const processChunk = async (): Promise<void> => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') return;
              try {
                const message = JSON.parse(data);
                if ('id' in message && message.id === requestId) {
                  resolve(message as AxMCPJSONRPCResponse<unknown>);
                  return;
                }
                if (this.messageHandler) this.messageHandler(message);
              } catch (error) {
                console.error('Failed to parse SSE data:', error);
              }
            }
          }
          await processChunk();
        } catch (error) {
          reader.releaseLock();
          reject(error);
        }
      };
      processChunk().catch(reject);
    });
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    });
    const body = JSON.stringify(message);

    let response = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers,
      body,
    });
    if (response.status === 401) {
      const www = response.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.mcpEndpoint,
        wwwAuthenticate: www,
        currentToken: null,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      response = await fetch(this.mcpEndpoint, {
        method: 'POST',
        headers: this.buildHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        }),
        body,
      });
    }

    if (!response.ok) {
      if (response.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new Error('Session expired. Please reinitialize.');
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    if (response.status !== 202)
      console.warn(`Unexpected status for notification: ${response.status}`);
  }

  async terminateSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const headers = this.buildHeaders({});
      const response = await fetch(this.mcpEndpoint, {
        method: 'DELETE',
        headers,
      });
      if (response.status === 405)
        console.info('Server does not support explicit session termination');
    } catch (error) {
      console.error('Failed to terminate session:', error);
    } finally {
      this.sessionId = undefined;
    }
  }

  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
  }
}
