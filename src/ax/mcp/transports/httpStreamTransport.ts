import { OAuthHelper } from '../oauth/oauthHelper.js';
import type { AxMCPTransport } from '../transport.js';
import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from '../types.js';
import { fetchWithSSRFProtection } from '../util/ssrf.js';
import type { AxMCPStreamableHTTPTransportOptions } from './options.js';

type PendingRequest = {
  resolve: (value: AxMCPJSONRPCResponse<unknown>) => void;
  reject: (reason: unknown) => void;
};

type SSEEvent = {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
};

export class AxMCPStreamableHTTPTransport implements AxMCPTransport {
  private mcpEndpoint: string;
  private sessionId?: string;
  private protocolVersion?: string;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private messageHandler?: (
    message: Readonly<AxMCPJSONRPCMessage>
  ) => void | Promise<void>;
  private customHeaders: Record<string, string>;
  private oauthHelper: OAuthHelper;
  private listeningAbort?: AbortController;

  constructor(
    mcpEndpoint: string,
    private readonly options: Readonly<AxMCPStreamableHTTPTransportOptions> = {}
  ) {
    this.mcpEndpoint = mcpEndpoint;
    this.customHeaders = { ...(options.headers ?? {}) };
    if (options.authorization) {
      this.customHeaders.Authorization = options.authorization;
    }
    this.oauthHelper = new OAuthHelper(options.oauth);
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

  setProtocolVersion(protocolVersion: string): void {
    this.protocolVersion = protocolVersion;
  }

  private buildHeaders(
    baseHeaders: Record<string, string>,
    includeProtocolVersion = true
  ): Record<string, string> {
    const headers = { ...this.customHeaders, ...baseHeaders };
    if (this.sessionId) headers['MCP-Session-Id'] = this.sessionId;
    if (includeProtocolVersion && this.protocolVersion) {
      headers['MCP-Protocol-Version'] = this.protocolVersion;
    }
    return headers;
  }

  private async fetchEndpoint(init: RequestInit): Promise<Response> {
    return fetchWithSSRFProtection(this.mcpEndpoint, {
      ...init,
      ssrfProtection: this.options.ssrfProtection,
      ssrfContext: 'mcp-endpoint',
    });
  }

  setMessageHandler(
    handler: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>
  ): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    return Promise.resolve();
  }

  async openListeningStream(): Promise<void> {
    this.listeningAbort?.abort();
    const ac = new AbortController();
    this.listeningAbort = ac;
    await this.consumeListeningStream(ac.signal);
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    const response = await this.postMessage(message, {
      accept: 'application/json, text/event-stream',
      includeProtocolVersion: message.method !== 'initialize',
    });

    const sessionIdHeader = response.headers.get('MCP-Session-Id');
    if (sessionIdHeader) this.sessionId = sessionIdHeader;

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return this.handleSSEResponse(response, message.id);
    }
    if (contentType.includes('application/json')) {
      return (await response.json()) as AxMCPJSONRPCResponse<unknown>;
    }
    if (response.status === 202) {
      throw new Error('MCP request was accepted but no response was returned');
    }
    throw new Error(`Unexpected content type: ${contentType || '<none>'}`);
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    const response = await this.postMessage(message, {
      accept: 'application/json, text/event-stream',
      includeProtocolVersion: true,
    });
    if (response.status !== 202 && response.status !== 204) {
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('application/json')) return;
      console.warn(`Unexpected status for notification: ${response.status}`);
    }
  }

  async sendResponse(message: Readonly<AxMCPJSONRPCResponse>): Promise<void> {
    const response = await this.postMessage(message, {
      accept: 'application/json, text/event-stream',
      includeProtocolVersion: true,
    });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
  }

  async terminateSession(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const response = await this.fetchEndpoint({
        method: 'DELETE',
        headers: this.buildHeaders({}, true),
      });
      if (response.status === 405) {
        console.info('Server does not support explicit session termination');
      }
    } catch (error) {
      console.error('Failed to terminate session:', error);
    } finally {
      this.sessionId = undefined;
    }
  }

  close(): void {
    this.listeningAbort?.abort();
    this.listeningAbort = undefined;
  }

  private async postMessage(
    message: Readonly<
      | AxMCPJSONRPCRequest<unknown>
      | AxMCPJSONRPCNotification
      | AxMCPJSONRPCResponse
    >,
    options: {
      accept: string;
      includeProtocolVersion: boolean;
    }
  ): Promise<Response> {
    const body = JSON.stringify(message);
    let response = await this.fetchEndpoint({
      method: 'POST',
      headers: this.buildHeaders(
        {
          'Content-Type': 'application/json',
          Accept: options.accept,
        },
        options.includeProtocolVersion
      ),
      body,
    });

    if (this.shouldTryLegacySSEFallback(response, message)) {
      await this.openLegacySSEEndpoint();
      response = await this.fetchEndpoint({
        method: 'POST',
        headers: this.buildHeaders(
          {
            'Content-Type': 'application/json',
            Accept: options.accept,
          },
          options.includeProtocolVersion
        ),
        body,
      });
    }

    if (await this.applyOAuthIfNeeded(response)) {
      response = await this.fetchEndpoint({
        method: 'POST',
        headers: this.buildHeaders(
          {
            'Content-Type': 'application/json',
            Accept: options.accept,
          },
          options.includeProtocolVersion
        ),
        body,
      });
    }

    if (!response.ok) {
      if (response.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new Error('MCP session expired. Please reinitialize.');
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  private shouldTryLegacySSEFallback(
    response: Response,
    message: Readonly<
      | AxMCPJSONRPCRequest<unknown>
      | AxMCPJSONRPCNotification
      | AxMCPJSONRPCResponse
    >
  ): boolean {
    return Boolean(
      this.options.legacySSEFallback &&
        'method' in message &&
        message.method === 'initialize' &&
        [400, 404, 405].includes(response.status)
    );
  }

  private async openLegacySSEEndpoint(): Promise<void> {
    const response = await this.fetchEndpoint({
      method: 'GET',
      headers: this.buildHeaders({ Accept: 'text/event-stream' }, false),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to open legacy SSE endpoint: ${response.status} ${response.statusText}`
      );
    }
    try {
      await this.consumeSSE(response, async (event) => {
        if (event.event !== 'endpoint') return;
        const endpoint = this.parseLegacyEndpoint(event.data);
        if (!endpoint) return;
        throw new LegacyEndpointDiscovered(endpoint);
      });
    } catch (error) {
      if (error instanceof LegacyEndpointDiscovered) {
        this.mcpEndpoint = error.endpoint;
        return;
      }
      throw error;
    }
    throw new Error('Legacy MCP SSE endpoint event was not received');
  }

  private parseLegacyEndpoint(data: string): string | undefined {
    let uri: string | undefined;
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'string') uri = parsed;
      else if (parsed && typeof parsed === 'object' && 'uri' in parsed) {
        uri = (parsed as { uri?: string }).uri;
      }
    } catch {
      uri = data.trim();
    }
    if (!uri) return;
    if (/^https?:\/\//i.test(uri)) return uri;
    const base = new URL(this.mcpEndpoint);
    return base.origin + (uri.startsWith('/') ? uri : `/${uri}`);
  }

  private async applyOAuthIfNeeded(response: Response): Promise<boolean> {
    if (response.status !== 401 && response.status !== 403) return false;
    const www = response.headers.get('WWW-Authenticate');
    const ensured = await this.oauthHelper.ensureAccessToken({
      requestedUrl: this.mcpEndpoint,
      wwwAuthenticate: www,
      currentToken: null,
    });
    if (!ensured) return false;
    this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
    return true;
  }

  private async handleSSEResponse(
    response: Response,
    requestId: string | number
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    let lastEventId: string | undefined;
    let retryMs = 1000;
    let currentResponse = response;

    for (;;) {
      const result = await this.consumeSSE(currentResponse, async (event) => {
        if (event.id) lastEventId = event.id;
        if (event.retry !== undefined) retryMs = event.retry;
        const message = this.parseJSONRPCEvent(event.data);
        if (!message) return;
        if (
          'id' in message &&
          message.id === requestId &&
          !('method' in message)
        ) {
          return message as AxMCPJSONRPCResponse<unknown>;
        }
        await this.messageHandler?.(message);
      });
      if (result) return result;
      if (!lastEventId) {
        throw new Error('SSE stream ended before MCP response was received');
      }
      await this.delay(retryMs);
      currentResponse = await this.openGETStream(lastEventId);
    }
  }

  private async consumeListeningStream(signal: AbortSignal): Promise<void> {
    let lastEventId: string | undefined;
    let retryMs = 1000;
    for (;;) {
      const response = await this.openGETStream(lastEventId, signal);
      await this.consumeSSE(response, async (event) => {
        if (event.id) lastEventId = event.id;
        if (event.retry !== undefined) retryMs = event.retry;
        const message = this.parseJSONRPCEvent(event.data);
        if (message) await this.messageHandler?.(message);
      });
      if (signal.aborted) return;
      await this.delay(retryMs);
    }
  }

  private async openGETStream(
    lastEventId?: string,
    signal?: AbortSignal
  ): Promise<Response> {
    const headers = this.buildHeaders({ Accept: 'text/event-stream' }, true);
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;
    let response = await this.fetchEndpoint({
      method: 'GET',
      headers,
      signal,
    });
    if (await this.applyOAuthIfNeeded(response)) {
      response = await this.fetchEndpoint({
        method: 'GET',
        headers: this.buildHeaders(
          {
            Accept: 'text/event-stream',
            ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
          },
          true
        ),
        signal,
      });
    }
    if (!response.ok) {
      if (response.status === 404 && this.sessionId) {
        this.sessionId = undefined;
        throw new Error('MCP session expired. Please reinitialize.');
      }
      throw new Error(
        `Failed to open MCP SSE stream: ${response.status} ${response.statusText}`
      );
    }
    return response;
  }

  private async consumeSSE<T>(
    response: Response,
    onEvent: (event: SSEEvent) => T | Promise<T | undefined> | undefined
  ): Promise<T | undefined> {
    if (!response.body) throw new Error('No response body available for SSE');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName: string | undefined;
    let data = '';
    let sawData = false;
    let id: string | undefined;
    let retry: number | undefined;

    const dispatch = async (): Promise<T | undefined> => {
      if (!sawData && !eventName && id === undefined && retry === undefined) {
        return;
      }
      const event: SSEEvent = { data, event: eventName, id, retry };
      eventName = undefined;
      data = '';
      sawData = false;
      id = undefined;
      retry = undefined;
      return onEvent(event) as Promise<T | undefined>;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          const result = await dispatch();
          if (result !== undefined) return result;
          return undefined;
        }
        buffer += decoder
          .decode(value, { stream: true })
          .replace(/\r\n|\r/g, '\n');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line === '') {
            const result = await dispatch();
            if (result !== undefined) {
              await reader.cancel();
              return result;
            }
            continue;
          }
          if (line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const rawValue = colon === -1 ? '' : line.slice(colon + 1);
          const valueText = rawValue.startsWith(' ')
            ? rawValue.slice(1)
            : rawValue;
          if (field === 'event') eventName = valueText;
          else if (field === 'data') {
            sawData = true;
            data += data ? `\n${valueText}` : valueText;
          } else if (field === 'id') id = valueText;
          else if (field === 'retry') {
            const parsed = Number.parseInt(valueText, 10);
            if (!Number.isNaN(parsed)) retry = parsed;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseJSONRPCEvent(data: string): AxMCPJSONRPCMessage | undefined {
    if (data.trim() === '' || data.trim() === '[DONE]') return;
    try {
      return JSON.parse(data) as AxMCPJSONRPCMessage;
    } catch (error) {
      console.error('Failed to parse MCP SSE data:', error);
      return;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class LegacyEndpointDiscovered extends Error {
  constructor(readonly endpoint: string) {
    super(`Legacy MCP SSE endpoint discovered: ${endpoint}`);
  }
}

/**
 * @deprecated Use AxMCPStreamableHTTPTransport. This misspelled export remains
 * for backward compatibility.
 */
export class AxMCPStreambleHTTPTransport extends AxMCPStreamableHTTPTransport {}
