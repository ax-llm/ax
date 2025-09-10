import type { AxMCPTransport } from '../transport.js';
import type {
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from '../types.js';
import type { AxMCPStreamableHTTPTransportOptions } from './options.js';
import { OAuthHelper } from '../oauth/oauthHelper.js';

export class AxMCPHTTPSSETransport implements AxMCPTransport {
  private endpoint: string | null = null;
  private sseUrl: string;
  private eventSource?: EventSource;
  private customHeaders: Record<string, string> = {};
  private oauthHelper: OAuthHelper;
  private currentToken?: AxMCPJSONRPCResponse<unknown> | null;
  private currentIssuer?: string;
  private sseAbort?: AbortController;
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
  private endpointReady?: { resolve: () => void; promise: Promise<void> };

  constructor(sseUrl: string, options?: AxMCPStreamableHTTPTransportOptions) {
    this.sseUrl = sseUrl;
    this.customHeaders = { ...(options?.headers ?? {}) };
    if (options?.authorization)
      this.customHeaders.Authorization = options.authorization;
    this.oauthHelper = new OAuthHelper(options?.oauth);
  }

  private buildHeaders(base: Record<string, string>): Record<string, string> {
    return { ...this.customHeaders, ...base };
  }

  private async openSSEWithFetch(
    headers: Record<string, string>
  ): Promise<void> {
    const ac = new AbortController();
    this.sseAbort = ac;
    const res = await fetch(this.sseUrl, {
      method: 'GET',
      headers,
      signal: ac.signal,
    });

    if (res.status === 401) {
      const www = res.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.sseUrl,
        wwwAuthenticate: www,
        currentToken: null,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      return this.openSSEWithFetch(
        this.buildHeaders({ Accept: 'text/event-stream' })
      );
    }

    if (!res.ok) throw new Error('Failed to establish SSE connection');

    const ready = this.createEndpointReady();
    void this.consumeSSEStream(res);
    await ready;
  }

  private createEndpointReady(): Promise<void> {
    if (!this.endpointReady) {
      let resolver!: () => void;
      const promise = new Promise<void>((resolve) => {
        resolver = resolve;
      });
      this.endpointReady = { resolve: resolver, promise };
    }
    return this.endpointReady.promise;
  }

  private async consumeSSEStream(response: Response): Promise<void> {
    if (!response.body)
      throw new Error('No response body available for SSE stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (eventType === 'endpoint') {
            const raw = data.trim();
            let uri: string | undefined;
            try {
              const parsed = JSON.parse(raw);
              if (typeof parsed === 'string') uri = parsed;
              else if (parsed && typeof parsed === 'object' && 'uri' in parsed)
                uri = (parsed as { uri?: string }).uri;
            } catch {
              uri = raw;
            }
            if (!uri) throw new Error('Endpoint URI missing in SSE event data');
            if (!/^https?:\/\//i.test(uri)) {
              const base = new URL(this.sseUrl);
              uri = base.origin + (uri.startsWith('/') ? uri : `/${uri}`);
            }
            this.endpoint = uri;
            if (this.endpointReady) {
              this.endpointReady.resolve();
              this.endpointReady = undefined;
            }
          } else {
            const raw = data.trim();
            try {
              const msg = JSON.parse(raw);
              if (msg && typeof msg === 'object' && 'id' in msg) {
                const id = (msg as { id: string | number }).id;
                const entry = this.pendingRequests.get(id);
                if (entry) {
                  entry.resolve(msg as AxMCPJSONRPCResponse<unknown>);
                  this.pendingRequests.delete(id);
                } else if (this.messageHandler) {
                  this.messageHandler(msg);
                }
              } else if (this.messageHandler) {
                this.messageHandler(msg);
              }
            } catch {
              // ignore non-JSON lines
            }
          }
        } else if (line.trim() === '') {
          eventType = null;
        }
      }
    }
  }

  async connect(): Promise<void> {
    const headers = this.buildHeaders({ Accept: 'text/event-stream' });
    await this.openSSEWithFetch(headers);
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    if (!this.endpoint)
      throw new Error(
        'HTTPTransport endpoint is not initialized. Call connect() first.'
      );

    const baseHeaders = this.buildHeaders({
      'Content-Type': 'application/json',
    });
    const body = JSON.stringify(message);

    const pending = new Promise<AxMCPJSONRPCResponse<unknown>>(
      (resolve, reject) => {
        this.pendingRequests.set(message.id, { resolve, reject });
      }
    );

    let res = await fetch(this.endpoint, {
      method: 'POST',
      headers: baseHeaders,
      body,
    });

    if (res.status === 401) {
      const www = res.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.sseUrl,
        wwwAuthenticate: www,
        currentToken: null,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
        body,
      });
    }

    if (!res.ok) {
      this.pendingRequests.delete(message.id);
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const contentType = res.headers.get('Content-Type');
    if (contentType?.includes('application/json')) {
      const json = (await res.json()) as AxMCPJSONRPCResponse<unknown>;
      this.pendingRequests.delete(message.id);
      return json;
    }

    return pending;
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    if (!this.endpoint)
      throw new Error(
        'HTTPTransport endpoint is not initialized. Call connect() first.'
      );

    const baseHeaders = this.buildHeaders({
      'Content-Type': 'application/json',
    });
    const body = JSON.stringify(message);

    let res = await fetch(this.endpoint, {
      method: 'POST',
      headers: baseHeaders,
      body,
    });

    if (res.status === 401) {
      const www = res.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.sseUrl,
        wwwAuthenticate: www,
        currentToken: null,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
        body,
      });
    }

    if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    if (res.status !== 202)
      console.warn(`Unexpected status for notification: ${res.status}`);
  }

  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    if (this.sseAbort) {
      this.sseAbort.abort();
      this.sseAbort = undefined;
    }
  }
}
