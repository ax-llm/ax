import { mergeAbortSignals } from '../../util/abort.js';
import { axApplyMCPAuthentication } from '../authentication.js';
import { OAuthHelper } from '../oauth/oauthHelper.js';
import type { TokenSet } from '../oauth/types.js';
import type {
  AxMCPListeningHandle,
  AxMCPListeningOptions,
  AxMCPRequestOptions,
  AxMCPTransport,
} from '../transport.js';
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

type OutboundMessage =
  | AxMCPJSONRPCRequest<unknown>
  | AxMCPJSONRPCNotification
  | AxMCPJSONRPCResponse;

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
  private oauthToken?: TokenSet;
  private readonly requestMetadata = new Map<
    string | number,
    { retryCount: number }
  >();
  private readonly responseRetryCounts = new WeakMap<Response, number>();

  private readonly defaultRetryStatuses = [429, 502, 503, 504] as const;

  constructor(
    mcpEndpoint: string,
    private readonly options: Readonly<AxMCPStreamableHTTPTransportOptions> = {}
  ) {
    this.mcpEndpoint = mcpEndpoint;
    this.customHeaders = { ...(options.headers ?? {}) };
    if (options.authorization) {
      this.customHeaders.Authorization = options.authorization;
    }
    this.oauthHelper = new OAuthHelper(
      options.oauth
        ? {
            ...options.oauth,
            mtls: options.oauth.mtls ?? options.mtls,
            fetch: options.oauth.fetch ?? options.mtls?.fetch ?? options.fetch,
          }
        : undefined
    );
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

  takeRequestMetadata(
    id: string | number
  ): Readonly<{ retryCount?: number }> | undefined {
    const value = this.requestMetadata.get(id);
    this.requestMetadata.delete(id);
    return value;
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
    const authenticated = await axApplyMCPAuthentication(
      this.mcpEndpoint,
      init,
      this.options.authentication
    );
    const headers: Record<string, string> =
      authenticated.init.headers instanceof Headers
        ? Object.fromEntries(authenticated.init.headers.entries())
        : Array.isArray(authenticated.init.headers)
          ? Object.fromEntries(authenticated.init.headers)
          : { ...(authenticated.init.headers ?? {}) };
    if (this.oauthToken && this.oauthHelper.hasDPoP()) {
      const proof = await this.oauthHelper.createDPoPProof({
        url: authenticated.url,
        method: authenticated.init.method ?? 'GET',
        accessToken: this.oauthToken.accessToken,
      });
      if (proof) headers.DPoP = proof;
    }
    const response = await fetchWithSSRFProtection(authenticated.url, {
      ...authenticated.init,
      headers,
      ssrfProtection: this.options.ssrfProtection,
      ssrfContext: 'mcp-endpoint',
      maxRedirects: this.options.maxRedirects,
      fetch: this.options.mtls?.fetch ?? this.options.fetch,
    });
    const nonce = response.headers.get('DPoP-Nonce');
    if (nonce) this.oauthHelper.setDPoPNonce(authenticated.url, nonce);
    return response;
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

  startListening(
    options: Readonly<AxMCPListeningOptions> = {}
  ): AxMCPListeningHandle {
    this.listeningAbort?.abort();
    const controller = new AbortController();
    this.listeningAbort = controller;
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const done = this.consumeListeningStream(signal).catch((error) => {
      if (signal.aborted) return;
      throw error;
    });
    return {
      done,
      close: () => controller.abort('MCP listening stream closed'),
    };
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    const signal = mergeAbortSignals(options?.signal, timeoutSignal);
    const response = await this.postMessage(message, {
      accept: 'application/json, text/event-stream',
      includeProtocolVersion: message.method !== 'initialize',
      signal,
      retryable: this.isSafeToRetry(message),
    });

    const sessionIdHeader = response.headers.get('MCP-Session-Id');
    if (sessionIdHeader) this.sessionId = sessionIdHeader;
    this.requestMetadata.set(message.id, {
      retryCount: this.responseRetryCounts.get(response) ?? 0,
    });

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return this.handleSSEResponse(response, message.id);
    }
    if (contentType.includes('application/json')) {
      return this.readJSONResponse(response);
    }
    if (response.status === 202) {
      throw new Error('MCP request was accepted but no response was returned');
    }
    throw new Error(`Unexpected content type: ${contentType || '<none>'}`);
  }

  async sendBatch(
    messages: readonly Readonly<AxMCPJSONRPCRequest<unknown>>[],
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<readonly AxMCPJSONRPCResponse<unknown>[]> {
    if (this.protocolVersion !== '2025-03-26') {
      throw new Error(
        `JSON-RPC batching is not allowed for MCP ${this.protocolVersion ?? 'before negotiation'}`
      );
    }
    if (messages.length === 0) throw new Error('MCP batch cannot be empty');
    const ids = new Set(messages.map((message) => message.id));
    if (ids.size !== messages.length) {
      throw new Error('MCP batch request IDs must be unique');
    }
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    const signal = mergeAbortSignals(options?.signal, timeoutSignal);
    const response = await this.postMessage(messages, {
      accept: 'application/json',
      includeProtocolVersion: true,
      signal,
      retryable: messages.every((message) => this.isSafeToRetry(message)),
    });
    const sessionIdHeader = response.headers.get('MCP-Session-Id');
    if (sessionIdHeader) this.sessionId = sessionIdHeader;
    const retryCount = this.responseRetryCounts.get(response) ?? 0;
    for (const message of messages) {
      this.requestMetadata.set(message.id, { retryCount });
    }
    const contentType = response.headers.get('Content-Type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `MCP batch requires application/json response, received ${contentType || '<none>'}`
      );
    }
    const value = await this.readJSONValue(response);
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('MCP batch response must be a non-empty array');
    }
    const byId = new Map<string | number, AxMCPJSONRPCResponse<unknown>>();
    for (const item of value as AxMCPJSONRPCResponse<unknown>[]) {
      if (
        !item ||
        item.jsonrpc !== '2.0' ||
        item.id === null ||
        !ids.has(item.id)
      ) {
        throw new Error(
          `MCP batch returned unexpected response ID ${String(item?.id)}`
        );
      }
      if (byId.has(item.id)) {
        throw new Error(
          `MCP batch returned duplicate response ID ${String(item.id)}`
        );
      }
      byId.set(item.id, item);
    }
    return messages.map((message) => {
      const item = byId.get(message.id);
      if (!item) {
        throw new Error(
          `MCP batch is missing response ID ${String(message.id)}`
        );
      }
      return item;
    });
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    const response = await this.postMessage(message, {
      accept: 'application/json, text/event-stream',
      includeProtocolVersion: true,
      retryable: false,
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
      retryable: false,
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
    message: Readonly<OutboundMessage> | readonly Readonly<OutboundMessage>[],
    options: {
      accept: string;
      includeProtocolVersion: boolean;
      signal?: AbortSignal;
      retryable: boolean;
    }
  ): Promise<Response> {
    const body = JSON.stringify(message);
    let response = await this.fetchWithRetry(
      {
        method: 'POST',
        headers: this.buildHeaders(
          {
            'Content-Type': 'application/json',
            Accept: options.accept,
          },
          options.includeProtocolVersion
        ),
        body,
        signal: options.signal,
      },
      options.retryable
    );

    if (this.shouldTryLegacySSEFallback(response, message)) {
      await this.openLegacySSEEndpoint();
      response = await this.fetchWithRetry(
        {
          method: 'POST',
          headers: this.buildHeaders(
            {
              'Content-Type': 'application/json',
              Accept: options.accept,
            },
            options.includeProtocolVersion
          ),
          body,
          signal: options.signal,
        },
        options.retryable
      );
    }

    if (await this.applyOAuthIfNeeded(response)) {
      response = await this.fetchWithRetry(
        {
          method: 'POST',
          headers: this.buildHeaders(
            {
              'Content-Type': 'application/json',
              Accept: options.accept,
            },
            options.includeProtocolVersion
          ),
          body,
          signal: options.signal,
        },
        options.retryable
      );
    }

    if (!response.ok) {
      if (
        response.status === 404 &&
        !Array.isArray(message) &&
        'method' in message &&
        message.method !== 'initialize' &&
        (this.sessionId || this.protocolVersion)
      ) {
        this.sessionId = undefined;
        throw new Error('MCP session expired');
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  private shouldTryLegacySSEFallback(
    response: Response,
    message: Readonly<OutboundMessage> | readonly Readonly<OutboundMessage>[]
  ): boolean {
    return Boolean(
      this.options.legacySSEFallback &&
        !Array.isArray(message) &&
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
    const dpopNonce = response.headers.get('DPoP-Nonce');
    if (dpopNonce && this.oauthToken && this.oauthHelper.hasDPoP()) {
      this.oauthHelper.setDPoPNonce(this.mcpEndpoint, dpopNonce);
      return true;
    }
    const ensured = await this.oauthHelper.ensureAccessToken({
      requestedUrl: this.mcpEndpoint,
      wwwAuthenticate: www,
      currentToken: this.oauthToken,
      forceRefresh: true,
    });
    if (!ensured) return false;
    this.oauthToken = ensured.token;
    this.customHeaders.Authorization = `${ensured.token.tokenType ?? 'Bearer'} ${ensured.token.accessToken}`;
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
      await this.delay(retryMs, signal);
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
    let receivedBytes = 0;

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
        receivedBytes += value.byteLength;
        if (
          receivedBytes > (this.options.maxResponseBytes ?? 16 * 1024 * 1024)
        ) {
          throw new Error(
            `MCP response exceeded ${this.options.maxResponseBytes ?? 16 * 1024 * 1024} bytes`
          );
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

  private async readJSONResponse(
    response: Response
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    return (await this.readJSONValue(
      response
    )) as AxMCPJSONRPCResponse<unknown>;
  }

  private async readJSONValue(response: Response): Promise<unknown> {
    const maximum = this.options.maxResponseBytes ?? 16 * 1024 * 1024;
    const declared = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(declared) && declared > maximum) {
      throw new Error(`MCP response exceeded ${maximum} bytes`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximum) {
      throw new Error(`MCP response exceeded ${maximum} bytes`);
    }
    return JSON.parse(text) as unknown;
  }

  private isSafeToRetry(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): boolean {
    return (
      message.method === 'initialize' ||
      message.method === 'ping' ||
      message.method.endsWith('/list') ||
      message.method.endsWith('/get') ||
      message.method.endsWith('/read') ||
      message.method === 'completion/complete' ||
      message.method === 'tasks/result'
    );
  }

  private async fetchWithRetry(
    init: RequestInit,
    retryable: boolean
  ): Promise<Response> {
    const retry = this.options.retry;
    const maxAttempts = retry === false ? 1 : (retry?.maxAttempts ?? 3);
    const statuses = new Set(
      retry === false ? [] : (retry?.statuses ?? this.defaultRetryStatuses)
    );
    for (let attempt = 1; ; attempt++) {
      const response = await this.fetchEndpoint(init);
      if (
        !retryable ||
        attempt >= maxAttempts ||
        !statuses.has(response.status)
      ) {
        this.responseRetryCounts.set(response, attempt - 1);
        return response;
      }
      const delayMs = this.retryDelayMs(response, attempt);
      await this.delay(delayMs, init.signal ?? undefined);
    }
  }

  private retryDelayMs(response: Response, attempt: number): number {
    const configured = this.options.retry;
    const maxDelay =
      configured === false ? 0 : (configured?.maxDelayMs ?? 30_000);
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.min(maxDelay, seconds * 1000);
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date))
        return Math.min(maxDelay, Math.max(0, date - Date.now()));
    }
    const base = configured === false ? 0 : (configured?.baseDelayMs ?? 250);
    return Math.min(maxDelay, base * 2 ** (attempt - 1));
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal?.reason ?? new Error('MCP request aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason ?? new Error('MCP request aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
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
