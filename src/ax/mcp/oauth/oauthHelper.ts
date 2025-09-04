import { newCodeChallenge, newCodeVerifier } from './pkce.js';
import { toQuery } from '../util/http.js';
import { discoverASMetadata, discoverResourceAndAS } from './discovery.js';
import type { AxMCPOAuthOptions, TokenSet } from './types.js';

export class OAuthHelper {
  private tokenCache = new Map<string, TokenSet>(); // key: resource::issuer
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

  private isExpired(ts?: number): boolean {
    if (!ts) return false;
    return Date.now() > ts - 60_000;
  }

  private async getASMeta(issuer: string): Promise<any> {
    if (this.asMetaCache.has(issuer)) return this.asMetaCache.get(issuer);
    const meta = await discoverASMetadata(issuer);
    this.asMetaCache.set(issuer, meta);
    return meta;
  }

  async ensureAccessToken(options: {
    requestedUrl: string;
    wwwAuthenticate: string | null;
    currentToken?: TokenSet | null;
  }): Promise<{
    token: TokenSet;
    issuer: string;
    asMeta: any;
    resource: string;
  } | null> {
    if (!this.oauth) return null;

    const { resource, issuers } = await discoverResourceAndAS(
      options.requestedUrl,
      options.wwwAuthenticate
    );
    const issuer = this.oauth.selectAuthorizationServer
      ? await this.oauth.selectAuthorizationServer(issuers, {})
      : issuers[0]!;
    const asMeta = await this.getASMeta(issuer);

    const existing =
      options.currentToken ?? (await this.getStoredToken(resource, issuer));
    if (existing?.accessToken && !this.isExpired(existing.expiresAt)) {
      return { token: existing, issuer, asMeta, resource };
    }

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

    const redirectUri =
      this.oauth.redirectUri ?? 'http://localhost:8787/callback';
    const client: { client_id: string; client_secret?: string } = this.oauth
      .clientId
      ? {
          client_id: this.oauth.clientId,
          client_secret: this.oauth.clientSecret,
        }
      : await this.dynamicClientRegistration(asMeta, redirectUri);

    const codeVerifier = await newCodeVerifier();
    const codeChallenge = await newCodeChallenge(codeVerifier);
    const state = await newCodeVerifier();

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
    _issuer: string,
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
