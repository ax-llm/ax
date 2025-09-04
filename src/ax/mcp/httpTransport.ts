import type { AxMCPTransport } from './transport.js';
import type {
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from './types.js';
import { getCrypto, randomUUID } from '../util/crypto.js';

/**
 * Utility: base64url encode bytes
 */
function base64url(bytes: Uint8Array): string {
  // Use Buffer when available (Node), otherwise fall back to btoa
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  // @ts-ignore - btoa may or may not exist depending on environment
  const b64: string = typeof btoa === 'function' ? btoa(binary) : '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await getCrypto().subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

function toQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, v);
  }
  return usp.toString();
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function parseWWWAuthenticateForResourceMetadata(
  www: string | null
): string | null {
  if (!www) return null;
  // Look for resource_metadata parameter per RFC 9728 §5.1
  // Matches resource_metadata="..." or resource_metadata=token
  const match =
    www.match(/resource_metadata\s*=\s*"([^"]+)"/i) ||
    www.match(/resource_metadata\s*=\s*([^,\s]+)/i);
  return match ? match[1] : null;
}

async function fetchJSON<T>(
  url: string,
  headers?: Record<string, string>
): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} fetching ${url}: ${res.statusText}`);
  return (await res.json()) as T;
}

type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  issuer?: string;
};

export interface AxMCPOAuthOptions {
  /** Pre-registered client id; if omitted and AS supports it, dynamic registration will be attempted */
  clientId?: string;
  /** Optional client secret (discouraged for public clients); if provided and AS requires */
  clientSecret?: string;
  /** Redirect URI to use for authorization code flow */
  redirectUri?: string; // default: http://localhost:8787/callback (not auto-handled)
  /** Scopes to request */
  scopes?: string[];
  /** Choose issuer when RS lists multiple authorization_servers */
  selectAuthorizationServer?: (
    issuers: string[],
    resourceMetadata: unknown
  ) => Promise<string> | string;
  /**
   * Callback to obtain an authorization code.
   * Library constructs the authorization URL with PKCE and passes it here.
   * Return the authorization code captured via your own UI/redirect-handler.
   */
  onAuthCode?: (
    authorizationUrl: string
  ) => Promise<{ code: string; redirectUri?: string }>;
  /** Token persistence hooks (optional). Keys by `${resource}::${issuer}` */
  tokenStore?: {
    getToken: (key: string) => Promise<TokenSet | null> | TokenSet | null;
    setToken: (key: string, token: TokenSet) => Promise<void> | void;
    clearToken?: (key: string) => Promise<void> | void;
  };
}

export interface AxMCPStreamableHTTPTransportOptions {
  /** Custom headers to include with all HTTP requests */
  headers?: Record<string, string>;
  /** Authorization header value; if provided, used as-is */
  authorization?: string;
  /** OAuth 2.1 options; when provided, transport will handle 401 + discovery + PKCE */
  oauth?: AxMCPOAuthOptions;
}

/**
 * OAuth helper used by both HTTP transports
 */
class OAuthHelper {
  private tokenCache = new Map<string, TokenSet>(); // key: resource::issuer
  private rsMetaCache = new Map<string, any>();
  private asMetaCache = new Map<string, any>();

  constructor(private readonly oauth?: AxMCPOAuthOptions) {}

  private key(resource: string, issuer: string) {
    return `${resource}::${issuer}`;
  }

  private async getStoredToken(
    resource: string,
    issuer: string
  ): Promise<TokenSet | null> {
    const k = this.key(resource, issuer);
    if (this.tokenCache.has(k)) return this.tokenCache.get(k)!;
    const t = await this.oauth?.tokenStore?.getToken?.(k);
    if (t) this.tokenCache.set(k, t);
    return t ?? null;
  }

  private async setStoredToken(
    resource: string,
    issuer: string,
    token: TokenSet
  ): Promise<void> {
    const k = this.key(resource, issuer);
    this.tokenCache.set(k, token);
    await this.oauth?.tokenStore?.setToken?.(k, token);
  }

  private async clearStoredToken(
    resource: string,
    issuer: string
  ): Promise<void> {
    const k = this.key(resource, issuer);
    this.tokenCache.delete(k);
    await this.oauth?.tokenStore?.clearToken?.(k);
  }

  private async discoverFromWWWAuthenticate(
    www: string,
    requestedUrl: string
  ): Promise<{ resource: string; issuer: string; asMeta: any } | null> {
    const headerUrl = parseWWWAuthenticateForResourceMetadata(www);
    let rsMeta: any | undefined;
    let expectedResource: string | undefined;
    let resourceMetaUrl: string | undefined;

    if (headerUrl) {
      // Use the RS metadata URL provided by the server
      resourceMetaUrl = headerUrl;
      rsMeta = await fetchJSON<any>(resourceMetaUrl);
      this.rsMetaCache.set(resourceMetaUrl, rsMeta);
      // Validation per RFC 9728 §3.3 (WWW-Authenticate case): resource must equal the URL used for resource request
      expectedResource = stripTrailingSlash(
        new URL(requestedUrl).toString().split('?')[0]!
      );
      const rsResource = stripTrailingSlash(rsMeta.resource ?? '');
      if (!rsResource || rsResource !== expectedResource) {
        throw new Error(
          `Protected resource metadata 'resource' mismatch. Expected ${expectedResource} but got ${rsResource}`
        );
      }
    } else {
      // No header param; attempt well-known derivations with and without path component
      const u = new URL(requestedUrl);
      const trimmedPath = u.pathname.replace(/\/+$/, '');
      const candidates: Array<{ url: string; expected: string }> = [];
      if (trimmedPath && trimmedPath !== '/') {
        candidates.push({
          url: `${u.origin}/.well-known/oauth-protected-resource${trimmedPath}`,
          expected: `${u.origin}${trimmedPath}`,
        });
      }
      candidates.push({
        url: `${u.origin}/.well-known/oauth-protected-resource`,
        expected: `${u.origin}`,
      });

      let lastErr: unknown;
      for (const c of candidates) {
        try {
          const meta = await fetchJSON<any>(c.url);
          const rsResource = stripTrailingSlash(meta.resource ?? '');
          const exp = stripTrailingSlash(c.expected);
          if (!rsResource || rsResource !== exp) {
            throw new Error(
              `Protected resource metadata 'resource' mismatch. Expected ${exp} but got ${rsResource}`
            );
          }
          rsMeta = meta;
          expectedResource = exp;
          resourceMetaUrl = c.url;
          this.rsMetaCache.set(resourceMetaUrl, rsMeta);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!rsMeta || !expectedResource) {
        throw new Error(
          `Failed to resolve protected resource metadata via well-known endpoints. Last error: ${String(lastErr)}`
        );
      }
    }

    const issuers: string[] = Array.isArray(rsMeta.authorization_servers)
      ? rsMeta.authorization_servers
      : [];
    if (issuers.length === 0) {
      throw new Error(
        'No authorization_servers advertised by protected resource'
      );
    }

    const selectedIssuer = this.oauth?.selectAuthorizationServer
      ? await this.oauth.selectAuthorizationServer(issuers, rsMeta)
      : issuers[0]!;

    const asMeta = await this.discoverASMetadata(selectedIssuer);
    return { resource: expectedResource!, issuer: selectedIssuer, asMeta };
  }

  private async discoverASMetadata(issuer: string): Promise<any> {
    if (this.asMetaCache.has(issuer)) return this.asMetaCache.get(issuer);
    const u = new URL(issuer);
    const path = u.pathname.replace(/^\/+/, ''); // no leading slash
    const endpoints: string[] = [];
    if (path) {
      endpoints.push(
        `${u.origin}/.well-known/oauth-authorization-server/${path}`
      );
      endpoints.push(`${u.origin}/.well-known/openid-configuration/${path}`);
      endpoints.push(
        `${u.origin}/${path.replace(/\/+$/, '')}/.well-known/openid-configuration`
      );
    } else {
      endpoints.push(`${u.origin}/.well-known/oauth-authorization-server`);
      endpoints.push(`${u.origin}/.well-known/openid-configuration`);
    }

    let lastErr: unknown;
    for (const e of endpoints) {
      try {
        const meta = await fetchJSON<any>(e);
        // Basic validation
        if (!meta.authorization_endpoint || !meta.token_endpoint) {
          throw new Error('AS metadata missing endpoints');
        }
        // PKCE requirement (per MCP draft): require code_challenge_methods_supported includes S256
        const methods: string[] | undefined =
          meta.code_challenge_methods_supported;
        if (!methods || !methods.includes('S256')) {
          throw new Error(
            'Authorization server does not advertise PKCE S256 support'
          );
        }
        this.asMetaCache.set(issuer, meta);
        return meta;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `Failed to discover AS metadata for ${issuer}: ${String(lastErr)}`
    );
  }

  private async dynamicClientRegistration(
    asMeta: any,
    redirectUri: string
  ): Promise<{ client_id: string; client_secret?: string }> {
    if (!asMeta.registration_endpoint) {
      throw new Error(
        'Authorization server does not support dynamic client registration and no clientId was provided.'
      );
    }
    const appType = redirectUri.startsWith('http://localhost')
      ? 'native'
      : 'web';
    const body = {
      application_type: appType,
      client_name: 'Ax MCP Client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    const res = await fetch(asMeta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(
        `Dynamic client registration failed: ${res.status} ${res.statusText}`
      );
    const json = (await res.json()) as {
      client_id: string;
      client_secret?: string;
    };
    if (!json.client_id)
      throw new Error('Dynamic client registration did not return client_id');
    return json;
  }

  private isExpired(ts?: number): boolean {
    if (!ts) return false;
    return Date.now() > ts - 60_000; // consider expired 60s early
  }

  async ensureAccessToken(options: {
    requestedUrl: string; // exact URL used for the failed request (resource identifier)
    wwwAuthenticate: string | null; // header from 401
    currentToken?: TokenSet | null;
  }): Promise<{
    token: TokenSet;
    issuer: string;
    asMeta: any;
    resource: string;
  } | null> {
    if (!this.oauth) return null;
    const discovery = await this.discoverFromWWWAuthenticate(
      options.wwwAuthenticate ?? '',
      options.requestedUrl
    );
    if (!discovery) return null;

    const { resource, issuer, asMeta } = discovery;

    // If we already have a valid token, return it
    const existing =
      options.currentToken ?? (await this.getStoredToken(resource, issuer));
    if (
      existing &&
      existing.accessToken &&
      !this.isExpired(existing.expiresAt)
    ) {
      return { token: existing, issuer, asMeta, resource };
    }

    // Try refresh if possible
    if (existing?.refreshToken) {
      try {
        const refreshed = await this.refreshToken(
          existing.refreshToken,
          resource,
          issuer,
          asMeta
        );
        await this.setStoredToken(resource, issuer, refreshed);
        return { token: refreshed, issuer, asMeta, resource };
      } catch {
        await this.clearStoredToken(resource, issuer);
      }
    }

    // Acquire new token via Authorization Code + PKCE
    const redirectUri =
      this.oauth.redirectUri ?? 'http://localhost:8787/callback';
    const client: { client_id: string; client_secret?: string } = this.oauth
      .clientId
      ? {
          client_id: this.oauth.clientId,
          client_secret: this.oauth.clientSecret,
        }
      : await this.dynamicClientRegistration(asMeta, redirectUri);

    const codeVerifier = base64url(
      await sha256Bytes(randomUUID() + Math.random().toString(36))
    );
    const codeChallenge = base64url(await sha256Bytes(codeVerifier));
    const state = base64url(await sha256Bytes(randomUUID()));

    const scopes = this.oauth.scopes?.join(' ');
    const authUrl = `${asMeta.authorization_endpoint}?${toQuery({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource,
    })}`;

    if (!this.oauth.onAuthCode) {
      throw new Error(
        `Authorization required. Provide oauth.onAuthCode to complete the flow. Navigate to: ${authUrl}`
      );
    }

    const { code, redirectUri: maybeRedirect } =
      await this.oauth.onAuthCode(authUrl);
    const usedRedirectUri = maybeRedirect ?? redirectUri;

    const token = await this.exchangeCodeForToken({
      asMeta,
      code,
      codeVerifier,
      client,
      redirectUri: usedRedirectUri,
      resource,
    });

    await this.setStoredToken(resource, issuer, token);
    return { token, issuer, asMeta, resource };
  }

  private async exchangeCodeForToken(args: {
    asMeta: any;
    code: string;
    codeVerifier: string;
    client: { client_id: string; client_secret?: string };
    redirectUri: string;
    resource: string;
  }): Promise<TokenSet> {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', args.code);
    body.set('redirect_uri', args.redirectUri);
    body.set('client_id', args.client.client_id);
    body.set('code_verifier', args.codeVerifier);
    body.set('resource', args.resource);
    if (args.client.client_secret)
      body.set('client_secret', args.client.client_secret);

    const res = await fetch(args.asMeta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok)
      throw new Error(`Token exchange failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!json.access_token)
      throw new Error('No access_token in token response');
    const expiresAt = json.expires_in
      ? Date.now() + json.expires_in * 1000
      : undefined;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt,
    };
  }

  private async refreshToken(
    refreshToken: string,
    resource: string,
    issuer: string,
    asMeta: any
  ): Promise<TokenSet> {
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    body.set('resource', resource);
    if (this.oauth?.clientId) body.set('client_id', this.oauth.clientId);
    if (this.oauth?.clientSecret)
      body.set('client_secret', this.oauth.clientSecret);

    const res = await fetch(asMeta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok)
      throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token)
      throw new Error('No access_token in refresh response');
    const expiresAt = json.expires_in
      ? Date.now() + json.expires_in * 1000
      : undefined;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt,
    };
  }
}

export class AxMCPHTTPSSETransport implements AxMCPTransport {
  private endpoint: string | null = null;
  private sseUrl: string;
  private eventSource?: EventSource;
  private customHeaders: Record<string, string> = {};
  private oauthHelper: OAuthHelper;
  private currentToken?: TokenSet | null;
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
    const res = await fetch(this.sseUrl, {
      method: 'GET',
      headers,
      signal: (this.sseAbort = new AbortController()).signal,
    });

    if (res.status === 401) {
      const www = res.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.sseUrl,
        wwwAuthenticate: www,
        currentToken: this.currentToken,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.currentToken = ensured.token;
      this.currentIssuer = ensured.issuer;
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      // retry with new token
      return this.openSSEWithFetch(
        this.buildHeaders({ Accept: 'text/event-stream' })
      );
    }

    if (!res.ok) throw new Error('Failed to establish SSE connection');

    // Start background SSE consumption and wait until endpoint is announced
    const ready = this.createEndpointReady();
    void this.consumeSSEStream(res);
    await ready;
  }

  private createEndpointReady(): Promise<void> {
    if (!this.endpointReady) {
      let resolver!: () => void;
      const promise = new Promise<void>((resolve) => (resolver = resolve));
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
              if (typeof parsed === 'string') {
                uri = parsed;
              } else if (
                parsed &&
                typeof parsed === 'object' &&
                'uri' in parsed
              ) {
                uri = (parsed as { uri?: string }).uri;
              }
            } catch {
              // Not JSON; treat as plain string
              uri = raw;
            }
            if (!uri) throw new Error('Endpoint URI missing in SSE event data');
            // Resolve relative paths against sseUrl origin
            if (!/^https?:\/\//i.test(uri)) {
              const base = new URL(this.sseUrl);
              uri = base.origin + (uri.startsWith('/') ? uri : '/' + uri);
            }
            this.endpoint = uri;
            if (this.endpointReady) {
              this.endpointReady.resolve();
              this.endpointReady = undefined;
            }
          } else {
            // General message: attempt to parse JSON-RPC responses/requests
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
          // event dispatch boundary
          eventType = null;
        }
      }
    }
  }

  async connect(): Promise<void> {
    // Prefer fetch-based SSE to allow headers (Authorization)
    const headers = this.buildHeaders({ Accept: 'text/event-stream' });
    await this.openSSEWithFetch(headers);
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    if (!this.endpoint) {
      throw new Error(
        'HTTPTransport endpoint is not initialized. Call connect() first.'
      );
    }

    const baseHeaders = this.buildHeaders({
      'Content-Type': 'application/json',
    });
    const body = JSON.stringify(message);

    const pending = new Promise<AxMCPJSONRPCResponse<unknown>>(
      (resolve, reject) => {
        this.pendingRequests.set(message.id, { resolve, reject });
      }
    );

    // First attempt
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
        currentToken: this.currentToken,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.currentToken = ensured.token;
      this.currentIssuer = ensured.issuer;
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      // retry
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
    if (contentType && contentType.includes('application/json')) {
      const json = (await res.json()) as AxMCPJSONRPCResponse<unknown>;
      this.pendingRequests.delete(message.id);
      return json;
    }

    // For SSE style, server responds 202 Accepted and response arrives on the stream
    return pending;
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    if (!this.endpoint) {
      throw new Error(
        'HTTPTransport endpoint is not initialized. Call connect() first.'
      );
    }
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
        currentToken: this.currentToken,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.currentToken = ensured.token;
      this.currentIssuer = ensured.issuer;
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
        body,
      });
    }

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    // Expect 202
    if (res.status !== 202) {
      console.warn(`Unexpected status for notification: ${res.status}`);
    }
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

/**
 * AxMCPStreambleHTTPTransport implements the 2025-03-26 Streamable HTTP transport specification
 * This transport uses a single HTTP endpoint that supports both POST and GET methods
 */
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
  private currentToken?: TokenSet | null;
  private currentIssuer?: string;

  constructor(
    mcpEndpoint: string,
    options?: AxMCPStreamableHTTPTransportOptions
  ) {
    this.mcpEndpoint = mcpEndpoint;
    this.customHeaders = { ...(options?.headers ?? {}) };

    // Add authorization header if provided
    if (options?.authorization) {
      this.customHeaders.Authorization = options.authorization;
    }
    this.oauthHelper = new OAuthHelper(options?.oauth);
  }

  /**
   * Update custom headers (useful for refreshing tokens)
   */
  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = { ...headers };
  }

  /**
   * Update authorization header (convenience method)
   */
  setAuthorization(authorization: string): void {
    this.customHeaders.Authorization = authorization;
  }

  /**
   * Get a copy of the current custom headers
   */
  getHeaders(): Record<string, string> {
    return { ...this.customHeaders };
  }

  /**
   * Build headers for HTTP requests, merging custom headers with required ones
   */
  private buildHeaders(
    baseHeaders: Record<string, string>
  ): Record<string, string> {
    const headers = { ...this.customHeaders, ...baseHeaders };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    return headers;
  }

  /**
   * Set a handler for incoming server messages (requests/notifications)
   */
  setMessageHandler(
    handler: (
      message: AxMCPJSONRPCRequest<unknown> | AxMCPJSONRPCNotification
    ) => void
  ): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    // For Streamable HTTP, connection is implicit when making requests
    // But we can optionally open a GET SSE stream for server-initiated messages
    return Promise.resolve();
  }

  /**
   * Opens an SSE stream to listen for server-initiated messages
   */
  async openListeningStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers = this.buildHeaders({
        Accept: 'text/event-stream',
      });

      // Note: EventSource doesn't support custom headers in standard browsers
      // For custom headers with SSE, you may need to use fetch with ReadableStream
      // or use a library that supports custom headers
      const url = new URL(this.mcpEndpoint);

      // If we have custom headers, we need to use fetch instead of EventSource
      if (Object.keys(this.customHeaders).length > 0) {
        this.openListeningStreamWithFetch(headers).then(resolve).catch(reject);
        return;
      }

      this.eventSource = new EventSource(url.toString());

      this.eventSource.onopen = () => {
        resolve();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (this.messageHandler) {
            this.messageHandler(message);
          }
        } catch (error) {
          console.error('Failed to parse SSE message:', error);
        }
      };

      this.eventSource.onerror = () => {
        reject(new Error('Failed to establish SSE connection'));
      };
    });
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
    });

    if (response.status === 401) {
      const www = response.headers.get('WWW-Authenticate');
      const ensured = await this.oauthHelper.ensureAccessToken({
        requestedUrl: this.mcpEndpoint,
        wwwAuthenticate: www,
        currentToken: this.currentToken,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.currentToken = ensured.token;
      this.currentIssuer = ensured.issuer;
      this.customHeaders.Authorization = `Bearer ${ensured.token.accessToken}`;
      // retry
      return this.openListeningStreamWithFetch(
        this.buildHeaders({ Accept: 'text/event-stream' })
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to open SSE stream: ${response.status} ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error('No response body available for SSE stream');
    }

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
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove 'data: ' prefix
            if (data === '[DONE]') {
              return;
            }

            try {
              const message = JSON.parse(data);
              if (this.messageHandler) {
                this.messageHandler(message);
              }
            } catch (error) {
              console.error('Failed to parse SSE data:', error);
            }
          }
        }

        // Continue reading
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
        currentToken: this.currentToken,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.currentToken = ensured.token;
      this.currentIssuer = ensured.issuer;
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
        // Session expired, clear it
        this.sessionId = undefined;
        throw new Error('Session expired. Please reinitialize.');
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    // Check if this is the initialization response with session ID
    const sessionIdHeader = response.headers.get('Mcp-Session-Id');
    if (sessionIdHeader) {
      this.sessionId = sessionIdHeader;
    }

    const contentType = response.headers.get('Content-Type');

    if (contentType?.includes('text/event-stream')) {
      // Handle SSE response
      return this.handleSSEResponse(response, message.id);
    }
    if (contentType?.includes('application/json')) {
      // Handle JSON response
      return response.json() as Promise<AxMCPJSONRPCResponse<unknown>>;
    }
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
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6); // Remove 'data: ' prefix
              if (data === '[DONE]') {
                return;
              }

              try {
                const message = JSON.parse(data);

                // Check if this is the response to our request
                if ('id' in message && message.id === requestId) {
                  resolve(message as AxMCPJSONRPCResponse<unknown>);
                  return;
                }

                // Handle other messages (server requests/notifications)
                if (this.messageHandler) {
                  this.messageHandler(message);
                }
              } catch (error) {
                console.error('Failed to parse SSE data:', error);
              }
            }
          }

          // Continue reading
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
        currentToken: this.currentToken,
      });
      if (!ensured) throw new Error(`HTTP 401: Unauthorized`);
      this.currentToken = ensured.token;
      this.currentIssuer = ensured.issuer;
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
        // Session expired, clear it
        this.sessionId = undefined;
        throw new Error('Session expired. Please reinitialize.');
      }
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    // For notifications, we expect 202 Accepted with no body
    if (response.status !== 202) {
      console.warn(`Unexpected status for notification: ${response.status}`);
    }
  }

  /**
   * Explicitly terminate the session (if supported by server)
   */
  async terminateSession(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      const headers = this.buildHeaders({});

      const response = await fetch(this.mcpEndpoint, {
        method: 'DELETE',
        headers,
      });

      if (response.status === 405) {
        // Server doesn't support explicit session termination
        console.info('Server does not support explicit session termination');
      }
    } catch (error) {
      console.error('Failed to terminate session:', error);
    } finally {
      this.sessionId = undefined;
    }
  }

  /**
   * Close any open connections
   */
  close(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
  }
}
