import {
  assertSSRFProtectedURL,
  fetchWithSSRFProtection,
} from '../util/ssrf.js';
import {
  discoverASMetadata,
  discoverResourceAndAS,
  parseWWWAuthenticateScope,
} from './discovery.js';
import { AxMCPDPoPProofFactory } from './dpop.js';
import { AxMCPOAuthJWTVerifier } from './jwt.js';
import { newCodeChallenge, newCodeVerifier } from './pkce.js';
import type {
  AxMCPEnterpriseAuthorizationContext,
  AxMCPEnterpriseManagedAuthorizationOptions,
  AxMCPOAuthClientRegistration,
  AxMCPOAuthOptions,
  AxMCPOAuthTokenEndpointAuthMethod,
  AxMCPOAuthTokenIntrospection,
  TokenSet,
} from './types.js';

type OAuthClient = {
  client_id: string;
  client_secret?: string;
  token_endpoint_auth_method?: AxMCPOAuthTokenEndpointAuthMethod;
};

export class OAuthHelper {
  private tokenCache = new Map<string, TokenSet>(); // key: resource::issuer
  private asMetaCache = new Map<string, any>();
  private readonly dpopFactory?: AxMCPDPoPProofFactory;
  private readonly jwtVerifier: AxMCPOAuthJWTVerifier;
  private readonly dpopNonces = new Map<string, string>();

  constructor(private readonly oauth?: AxMCPOAuthOptions) {
    this.dpopFactory = oauth?.dpop
      ? new AxMCPDPoPProofFactory(oauth.dpop)
      : undefined;
    this.jwtVerifier = new AxMCPOAuthJWTVerifier({
      ...oauth?.jwtValidation,
      ssrfProtection:
        oauth?.jwtValidation?.ssrfProtection ?? oauth?.ssrfProtection,
      fetch: oauth?.jwtValidation?.fetch ?? oauth?.mtls?.fetch ?? oauth?.fetch,
    });
  }

  hasDPoP(): boolean {
    return this.dpopFactory !== undefined;
  }

  async createDPoPProof(request: {
    url: string;
    method: string;
    accessToken?: string;
    nonce?: string;
  }): Promise<string | undefined> {
    return this.dpopFactory?.createProof({
      ...request,
      nonce: request.nonce ?? this.dpopNonces.get(new URL(request.url).origin),
    });
  }

  setDPoPNonce(url: string, nonce: string): void {
    this.dpopNonces.set(new URL(url).origin, nonce);
  }

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
    const meta = await discoverASMetadata(
      issuer,
      this.oauth?.ssrfProtection,
      {
        requireAuthorizationEndpoint:
          this.oauth?.grantType !== 'client_credentials' &&
          !this.oauth?.enterpriseManagedAuthorization,
      },
      this.oauth?.mtls?.fetch ?? this.oauth?.fetch
    );
    this.asMetaCache.set(issuer, meta);
    return meta;
  }

  async ensureAccessToken(options: {
    requestedUrl: string;
    wwwAuthenticate: string | null;
    currentToken?: TokenSet | null;
    forceRefresh?: boolean;
  }): Promise<{
    token: TokenSet;
    issuer: string;
    asMeta: any;
    resource: string;
  } | null> {
    if (!this.oauth) return null;

    const { resource, issuers } = await discoverResourceAndAS(
      options.requestedUrl,
      options.wwwAuthenticate,
      this.oauth.ssrfProtection,
      this.oauth.mtls?.fetch ?? this.oauth.fetch
    );
    const issuer = this.oauth.selectAuthorizationServer
      ? await this.oauth.selectAuthorizationServer(issuers, {})
      : issuers[0]!;
    const asMeta = await this.getASMeta(issuer);
    if (
      this.oauth.mtls?.requireCertificateBoundAccessTokens &&
      asMeta.tls_client_certificate_bound_access_tokens !== true
    ) {
      throw new Error(
        'OAuth authorization server does not advertise certificate-bound access tokens'
      );
    }
    const challengedScopes = parseWWWAuthenticateScope(options.wwwAuthenticate);
    const scopes =
      challengedScopes.length > 0
        ? challengedScopes
        : (this.oauth.scopes ?? asMeta.scopes_supported ?? []);

    const existing =
      options.currentToken ?? (await this.getStoredToken(resource, issuer));
    if (
      !options.forceRefresh &&
      existing?.accessToken &&
      !this.isExpired(existing.expiresAt)
    ) {
      return { token: existing, issuer, asMeta, resource };
    }

    const redirectUri =
      this.oauth.redirectUri ?? 'http://localhost:8787/callback';
    let client: OAuthClient | undefined;
    if (existing?.refreshToken) {
      try {
        client = await this.resolveClient(issuer, asMeta, redirectUri);
        const refreshed = await this.refreshToken(
          existing.refreshToken,
          resource,
          asMeta,
          scopes,
          client
        );
        await this.validateToken(refreshed, issuer, asMeta, client.client_id);
        await this.setStoredToken(resource, issuer, refreshed);
        return { token: refreshed, issuer, asMeta, resource };
      } catch {
        await this.clearStoredToken(resource, issuer);
      }
    }

    client ??= await this.resolveClient(issuer, asMeta, redirectUri);

    if (this.oauth.grantType === 'client_credentials') {
      const token = await this.clientCredentialsToken({
        asMeta,
        client,
        resource,
        scopes,
      });
      await this.validateToken(token, issuer, asMeta, client.client_id);
      await this.setStoredToken(resource, issuer, token);
      return { token, issuer, asMeta, resource };
    }

    if (this.oauth.enterpriseManagedAuthorization) {
      const token = await this.enterpriseManagedToken({
        issuer,
        asMeta,
        client,
        resource,
        scopes,
        options: this.oauth.enterpriseManagedAuthorization,
      });
      await this.validateToken(token, issuer, asMeta, client.client_id);
      await this.setStoredToken(resource, issuer, token);
      return { token, issuer, asMeta, resource };
    }

    const codeVerifier = await newCodeVerifier();
    const codeChallenge = await newCodeChallenge(codeVerifier);
    const state = await newCodeVerifier();
    const nonce = await newCodeVerifier();

    const scope = scopes.join(' ') || undefined;
    await assertSSRFProtectedURL(asMeta.authorization_endpoint, {
      context: 'oauth-authorization',
      ssrfProtection: this.oauth.ssrfProtection,
    });
    let authorizationParameters = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
    });
    if (scope) authorizationParameters.set('scope', scope);
    this.appendResources(authorizationParameters, resource);
    if (this.oauth.authorizationDetails?.length) {
      authorizationParameters.set(
        'authorization_details',
        JSON.stringify(this.oauth.authorizationDetails)
      );
    }
    if (this.oauth.createAuthorizationRequestJWT) {
      const claims: Record<string, unknown> = Object.fromEntries(
        authorizationParameters.entries()
      );
      const resourceClaims = authorizationParameters.getAll('resource');
      if (resourceClaims.length > 1) claims.resource = resourceClaims;
      authorizationParameters = new URLSearchParams();
      authorizationParameters.set('client_id', client.client_id);
      authorizationParameters.set(
        'request',
        await this.oauth.createAuthorizationRequestJWT({
          ...claims,
          iss: client.client_id,
          aud: issuer,
        })
      );
    }
    const pushed = await this.maybePushAuthorizationRequest(
      asMeta,
      client,
      authorizationParameters
    );
    const authorizationURL = new URL(asMeta.authorization_endpoint);
    const finalParameters = pushed
      ? new URLSearchParams({
          client_id: client.client_id,
          request_uri: pushed.requestUri,
        })
      : authorizationParameters;
    finalParameters.forEach((value, name) =>
      authorizationURL.searchParams.append(name, value)
    );
    const authUrl = authorizationURL.toString();

    if (!this.oauth.onAuthCode) {
      throw new Error(
        `Authorization required. Provide oauth.onAuthCode to complete the flow. Navigate to: ${authUrl}`
      );
    }

    const {
      code,
      state: returnedState,
      redirectUri: maybeRedirect,
    } = await this.oauth.onAuthCode(authUrl, { state, nonce, redirectUri });
    if (returnedState !== state) {
      throw new Error('OAuth state mismatch');
    }
    const usedRedirectUri = maybeRedirect ?? redirectUri;

    const token = await this.exchangeCodeForToken({
      asMeta,
      code,
      codeVerifier,
      client,
      redirectUri: usedRedirectUri,
      resource,
      scopes,
    });
    await this.validateToken(token, issuer, asMeta, client.client_id, nonce);

    await this.setStoredToken(resource, issuer, token);
    return { token, issuer, asMeta, resource };
  }

  async revokeToken(options: {
    requestedUrl: string;
    wwwAuthenticate?: string | null;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
  }): Promise<void> {
    const { asMeta, client } = await this.resolveOAuthEndpointContext(
      options.requestedUrl,
      options.wwwAuthenticate ?? null
    );
    const endpoint = asMeta.revocation_endpoint as string | undefined;
    if (!endpoint)
      throw new Error('OAuth revocation endpoint is not advertised');
    const body = new URLSearchParams({ token: options.token });
    if (options.tokenTypeHint) {
      body.set('token_type_hint', options.tokenTypeHint);
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(body, headers, endpoint, client);
    const response = await fetchWithSSRFProtection(endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      ssrfProtection: this.oauth?.ssrfProtection,
      ssrfContext: 'oauth-token',
      fetch: this.oauth?.mtls?.fetch ?? this.oauth?.fetch,
    });
    if (!response.ok) {
      throw new Error(
        `OAuth token revocation failed: ${response.status} ${response.statusText}`
      );
    }
  }

  async introspectToken(options: {
    requestedUrl: string;
    wwwAuthenticate?: string | null;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
  }): Promise<AxMCPOAuthTokenIntrospection> {
    const { asMeta, client } = await this.resolveOAuthEndpointContext(
      options.requestedUrl,
      options.wwwAuthenticate ?? null
    );
    const endpoint = asMeta.introspection_endpoint as string | undefined;
    if (!endpoint) {
      throw new Error('OAuth introspection endpoint is not advertised');
    }
    const body = new URLSearchParams({ token: options.token });
    if (options.tokenTypeHint) {
      body.set('token_type_hint', options.tokenTypeHint);
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(body, headers, endpoint, client);
    const response = await fetchWithSSRFProtection(endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      ssrfProtection: this.oauth?.ssrfProtection,
      ssrfContext: 'oauth-token',
      fetch: this.oauth?.mtls?.fetch ?? this.oauth?.fetch,
    });
    if (!response.ok) {
      throw new Error(
        `OAuth token introspection failed: ${response.status} ${response.statusText}`
      );
    }
    const value = (await response.json()) as AxMCPOAuthTokenIntrospection;
    if (typeof value.active !== 'boolean') {
      throw new Error('OAuth introspection response missing active boolean');
    }
    return value;
  }

  private async resolveOAuthEndpointContext(
    requestedUrl: string,
    wwwAuthenticate: string | null
  ): Promise<{ asMeta: any; client: OAuthClient }> {
    if (!this.oauth) throw new Error('OAuth is not configured');
    const { issuers } = await discoverResourceAndAS(
      requestedUrl,
      wwwAuthenticate,
      this.oauth.ssrfProtection,
      this.oauth.mtls?.fetch ?? this.oauth.fetch
    );
    const issuer = this.oauth.selectAuthorizationServer
      ? await this.oauth.selectAuthorizationServer(issuers, {})
      : issuers[0]!;
    const asMeta = await this.getASMeta(issuer);
    const redirectUri =
      this.oauth.redirectUri ?? 'http://localhost:8787/callback';
    return {
      asMeta,
      client: await this.resolveClient(issuer, asMeta, redirectUri),
    };
  }

  private async resolveClient(
    issuer: string,
    asMeta: any,
    redirectUri: string
  ): Promise<OAuthClient> {
    if (this.oauth?.clientId) {
      return {
        client_id: this.oauth.clientId,
        client_secret: this.oauth.clientSecret,
        token_endpoint_auth_method: this.oauth.tokenEndpointAuthMethod,
      };
    }
    if (
      asMeta.client_id_metadata_document_supported === true &&
      this.oauth?.clientMetadataDocumentUrl
    ) {
      const url = new URL(this.oauth.clientMetadataDocumentUrl);
      if (url.protocol !== 'https:' || url.pathname === '/') {
        throw new Error(
          'OAuth clientMetadataDocumentUrl must be HTTPS and include a path'
        );
      }
      return {
        client_id: url.toString(),
        token_endpoint_auth_method:
          this.oauth.tokenEndpointAuthMethod ?? 'none',
      };
    }
    const stored = await this.oauth?.registrationStore?.getRegistration(issuer);
    if (stored && !this.isRegistrationExpired(stored)) return stored;
    if (stored)
      await this.oauth?.registrationStore?.clearRegistration?.(issuer);
    return this.dynamicClientRegistration(issuer, asMeta, redirectUri);
  }

  private isRegistrationExpired(
    registration: Readonly<AxMCPOAuthClientRegistration>
  ): boolean {
    const expires = registration.client_secret_expires_at;
    return (
      expires !== undefined && expires !== 0 && Date.now() >= expires * 1000
    );
  }

  private async dynamicClientRegistration(
    issuer: string,
    asMeta: any,
    redirectUri: string
  ): Promise<OAuthClient> {
    if (!asMeta.registration_endpoint) {
      throw new Error(
        'Authorization server does not support dynamic client registration and no clientId was provided.'
      );
    }
    const appType = redirectUri.startsWith('http://localhost')
      ? 'native'
      : 'web';
    const enterprise = this.oauth?.enterpriseManagedAuthorization !== undefined;
    const body = {
      application_type: appType,
      client_name: 'Ax MCP Client',
      redirect_uris: [redirectUri],
      grant_types: enterprise
        ? ['urn:ietf:params:oauth:grant-type:jwt-bearer', 'refresh_token']
        : this.oauth?.grantType === 'client_credentials'
          ? ['client_credentials']
          : ['authorization_code', 'refresh_token'],
      response_types:
        enterprise || this.oauth?.grantType === 'client_credentials'
          ? []
          : ['code'],
      token_endpoint_auth_method: this.oauth?.tokenEndpointAuthMethod ?? 'none',
    };
    const res = await fetchWithSSRFProtection(asMeta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ssrfProtection: this.oauth?.ssrfProtection,
      ssrfContext: 'oauth-registration',
      fetch: this.oauth?.mtls?.fetch ?? this.oauth?.fetch,
    });
    if (!res.ok)
      throw new Error(
        `Dynamic client registration failed: ${res.status} ${res.statusText}`
      );
    const json = (await res.json()) as AxMCPOAuthClientRegistration;
    if (!json.client_id)
      throw new Error('Dynamic client registration did not return client_id');
    await this.oauth?.registrationStore?.setRegistration(issuer, json);
    return json;
  }

  private async exchangeCodeForToken(args: {
    asMeta: any;
    code: string;
    codeVerifier: string;
    client: OAuthClient;
    redirectUri: string;
    resource: string;
    scopes: readonly string[];
  }): Promise<TokenSet> {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', args.code);
    body.set('redirect_uri', args.redirectUri);
    body.set('code_verifier', args.codeVerifier);
    this.appendResources(body, args.resource);
    if (args.scopes.length > 0) body.set('scope', args.scopes.join(' '));
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(
      body,
      headers,
      args.asMeta.token_endpoint,
      args.client
    );

    const res = await this.fetchTokenEndpoint(args.asMeta.token_endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!res.ok)
      throw new Error(`Token exchange failed: ${res.status} ${res.statusText}`);
    return this.parseTokenResponse(await res.json());
  }

  private async clientCredentialsToken(args: {
    asMeta: any;
    client: OAuthClient;
    resource: string;
    scopes: readonly string[];
  }): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
    });
    this.appendResources(body, args.resource);
    if (args.scopes.length > 0) body.set('scope', args.scopes.join(' '));
    if (this.oauth?.authorizationDetails?.length) {
      body.set(
        'authorization_details',
        JSON.stringify(this.oauth.authorizationDetails)
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(
      body,
      headers,
      args.asMeta.token_endpoint,
      args.client
    );
    const response = await this.fetchTokenEndpoint(args.asMeta.token_endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(
        `Client credentials token request failed: ${response.status} ${response.statusText}`
      );
    }
    return this.parseTokenResponse(await response.json());
  }

  private async enterpriseManagedToken(args: {
    issuer: string;
    asMeta: any;
    client: OAuthClient;
    resource: string;
    scopes: readonly string[];
    options: Readonly<AxMCPEnterpriseManagedAuthorizationOptions>;
  }): Promise<TokenSet> {
    const context: AxMCPEnterpriseAuthorizationContext = {
      authorizationServerUrl: args.issuer,
      resourceUrl: args.resource,
      scope: args.scopes.length > 0 ? args.scopes.join(' ') : undefined,
    };
    const authorizationGrant = args.options.getAuthorizationGrant
      ? await args.options.getAuthorizationGrant(context)
      : await this.requestEnterpriseAuthorizationGrant(args.options, context);
    if (!authorizationGrant) {
      throw new Error('Enterprise authorization did not return an ID-JAG');
    }

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: authorizationGrant,
    });
    this.appendResources(body, args.resource);
    if (args.scopes.length > 0) body.set('scope', args.scopes.join(' '));
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(
      body,
      headers,
      args.asMeta.token_endpoint,
      args.client
    );
    const response = await this.fetchTokenEndpoint(args.asMeta.token_endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!response.ok) {
      throw new Error(
        `Enterprise ID-JAG token exchange failed: ${response.status} ${response.statusText}`
      );
    }
    return this.parseTokenResponse(await response.json());
  }

  private async requestEnterpriseAuthorizationGrant(
    options: Readonly<AxMCPEnterpriseManagedAuthorizationOptions>,
    context: Readonly<AxMCPEnterpriseAuthorizationContext>
  ): Promise<string> {
    if (
      !options.identityProviderTokenEndpoint ||
      !options.getIdentityAssertion
    ) {
      throw new Error(
        'Enterprise authorization requires getAuthorizationGrant or both identityProviderTokenEndpoint and getIdentityAssertion'
      );
    }
    const supplied = await options.getIdentityAssertion(context);
    const assertion =
      typeof supplied === 'string' ? supplied : supplied.assertion;
    const assertionType =
      typeof supplied === 'string'
        ? 'urn:ietf:params:oauth:token-type:id_token'
        : (supplied.type ?? 'urn:ietf:params:oauth:token-type:id_token');
    if (!assertion) throw new Error('Enterprise identity assertion is empty');

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: assertion,
      subject_token_type: assertionType,
      requested_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      audience: context.authorizationServerUrl,
      resource: context.resourceUrl,
    });
    if (context.scope) body.set('scope', context.scope);
    for (const [name, value] of Object.entries(
      options.identityProviderParameters ?? {}
    )) {
      body.set(name, value);
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyEndpointClientAuthentication({
      body,
      headers,
      audience: options.identityProviderTokenEndpoint,
      clientId: options.identityProviderClientId,
      clientSecret: options.identityProviderClientSecret,
      method: options.identityProviderTokenEndpointAuthMethod,
      createClientAssertion: options.createIdentityProviderClientAssertion,
    });
    const response = await fetchWithSSRFProtection(
      options.identityProviderTokenEndpoint,
      {
        method: 'POST',
        headers,
        body: body.toString(),
        ssrfProtection: this.oauth?.ssrfProtection,
        ssrfContext: 'oauth-token',
        fetch: this.oauth?.mtls?.fetch ?? this.oauth?.fetch,
      }
    );
    if (!response.ok) {
      throw new Error(
        `Enterprise identity assertion exchange failed: ${response.status} ${response.statusText}`
      );
    }
    const value = (await response.json()) as {
      access_token?: string;
      issued_token_type?: string;
    };
    if (!value.access_token) {
      throw new Error('Enterprise IdP response missing ID-JAG access_token');
    }
    if (
      value.issued_token_type &&
      value.issued_token_type !== 'urn:ietf:params:oauth:token-type:jwt'
    ) {
      throw new Error(
        `Enterprise IdP returned unsupported issued_token_type ${value.issued_token_type}`
      );
    }
    return value.access_token;
  }

  private async refreshToken(
    refreshToken: string,
    resource: string,
    asMeta: any,
    scopes: readonly string[],
    client: Readonly<OAuthClient>
  ): Promise<TokenSet> {
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    this.appendResources(body, resource);
    if (scopes.length > 0) body.set('scope', scopes.join(' '));
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(
      body,
      headers,
      asMeta.token_endpoint,
      client
    );

    const res = await this.fetchTokenEndpoint(asMeta.token_endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    if (!res.ok)
      throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`);
    const token = this.parseTokenResponse(await res.json());
    return { ...token, refreshToken: token.refreshToken ?? refreshToken };
  }

  private async applyClientAuthentication(
    body: URLSearchParams,
    headers: Record<string, string>,
    audience: string,
    client: Readonly<OAuthClient>
  ): Promise<void> {
    await this.applyEndpointClientAuthentication({
      body,
      headers,
      audience,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      method:
        client.token_endpoint_auth_method ??
        this.oauth?.tokenEndpointAuthMethod,
      createClientAssertion: this.oauth?.createClientAssertion,
    });
  }

  private async applyEndpointClientAuthentication(args: {
    body: URLSearchParams;
    headers: Record<string, string>;
    audience: string;
    clientId?: string;
    clientSecret?: string;
    method?: AxMCPOAuthTokenEndpointAuthMethod;
    createClientAssertion?: (
      request: Readonly<{
        method: 'client_secret_jwt' | 'private_key_jwt';
        clientId: string;
        audience: string;
      }>
    ) => string | Promise<string>;
  }): Promise<void> {
    const method =
      args.method ?? (args.clientSecret ? 'client_secret_post' : 'none');
    if (!args.clientId) {
      if (method === 'none') return;
      throw new Error('OAuth client ID required');
    }
    if (method === 'client_secret_basic') {
      if (!args.clientSecret) throw new Error('OAuth client secret required');
      args.headers.Authorization = `Basic ${this.encodeBase64(`${args.clientId}:${args.clientSecret}`)}`;
      return;
    }
    args.body.set('client_id', args.clientId);
    if (method === 'client_secret_post') {
      if (!args.clientSecret) throw new Error('OAuth client secret required');
      args.body.set('client_secret', args.clientSecret);
      return;
    }
    if (method === 'client_secret_jwt' || method === 'private_key_jwt') {
      if (!args.createClientAssertion) {
        throw new Error(`OAuth ${method} requires createClientAssertion`);
      }
      args.body.set(
        'client_assertion',
        await args.createClientAssertion({
          method,
          clientId: args.clientId,
          audience: args.audience,
        })
      );
      args.body.set(
        'client_assertion_type',
        'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
      );
    }
  }

  private appendResources(
    body: URLSearchParams,
    primaryResource: string
  ): void {
    const resources = new Set([
      primaryResource,
      ...(this.oauth?.resources ?? []),
    ]);
    for (const resource of resources) body.append('resource', resource);
  }

  private async maybePushAuthorizationRequest(
    asMeta: any,
    client: Readonly<OAuthClient>,
    parameters: URLSearchParams
  ): Promise<{ requestUri: string; expiresIn?: number } | undefined> {
    const mode = this.oauth?.usePAR;
    const endpoint = asMeta.pushed_authorization_request_endpoint as
      | string
      | undefined;
    if (!endpoint) {
      if (mode === true) {
        throw new Error(
          'OAuth PAR required but pushed_authorization_request_endpoint is missing'
        );
      }
      return;
    }
    if (mode !== true && mode !== 'auto') return;
    const body = new URLSearchParams(parameters);
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    await this.applyClientAuthentication(body, headers, endpoint, client);
    const response = await fetchWithSSRFProtection(endpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      ssrfProtection: this.oauth?.ssrfProtection,
      ssrfContext: 'oauth-authorization',
      fetch: this.oauth?.mtls?.fetch ?? this.oauth?.fetch,
    });
    if (!response.ok) {
      throw new Error(
        `Pushed authorization request failed: ${response.status} ${response.statusText}`
      );
    }
    const value = (await response.json()) as {
      request_uri?: string;
      expires_in?: number;
    };
    if (!value.request_uri) {
      throw new Error('Pushed authorization response missing request_uri');
    }
    return { requestUri: value.request_uri, expiresIn: value.expires_in };
  }

  private parseTokenResponse(value: unknown): TokenSet {
    const json = value as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
      id_token?: string;
    };
    if (!json.access_token)
      throw new Error('No access_token in token response');
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in
        ? Date.now() + json.expires_in * 1000
        : undefined,
      tokenType: json.token_type ?? 'Bearer',
      scope: json.scope,
      idToken: json.id_token,
    };
  }

  private async validateToken(
    token: Readonly<TokenSet>,
    issuer: string,
    asMeta: any,
    clientId: string,
    nonce?: string
  ): Promise<void> {
    const tokenType = (token.tokenType ?? 'Bearer').toLowerCase();
    if (tokenType !== 'bearer' && tokenType !== 'dpop') {
      throw new Error(
        `OAuth returned unsupported token_type ${token.tokenType}`
      );
    }
    if (this.hasDPoP() && tokenType !== 'dpop') {
      throw new Error('OAuth DPoP flow returned a non-DPoP access token');
    }
    if (
      !token.idToken ||
      this.oauth?.jwtValidation?.validateIdTokens === false
    ) {
      return;
    }
    const jwksUri = asMeta.jwks_uri as string | undefined;
    if (!jwksUri) {
      throw new Error(
        'OAuth ID token returned but authorization metadata has no jwks_uri'
      );
    }
    await this.jwtVerifier.verify(token.idToken, {
      issuer: (asMeta.issuer as string | undefined) ?? issuer,
      audience: clientId,
      nonce,
      jwksUri,
    });
  }

  private async fetchTokenEndpoint(
    url: string,
    init: Readonly<RequestInit>
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = new Headers(init.headers);
      const proof = await this.createDPoPProof({
        url,
        method: init.method ?? 'POST',
      });
      if (proof) headers.set('DPoP', proof);
      const response = await fetchWithSSRFProtection(url, {
        ...init,
        headers,
        ssrfProtection: this.oauth?.ssrfProtection,
        ssrfContext: 'oauth-token',
        fetch: this.oauth?.mtls?.fetch ?? this.oauth?.fetch,
      });
      const nonce = response.headers.get('DPoP-Nonce');
      if (nonce) {
        const previous = this.dpopNonces.get(new URL(url).origin);
        this.setDPoPNonce(url, nonce);
        if (!response.ok && attempt === 0 && nonce !== previous) continue;
      }
      return response;
    }
    throw new Error('DPoP token endpoint retry exhausted');
  }

  private encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}
