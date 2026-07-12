import { AxMCPClient } from '../mcp/client.js';
import { OAuthHelper } from '../mcp/oauth/oauthHelper.js';
import type { TokenSet } from '../mcp/oauth/types.js';
import type { AxMCPTransport } from '../mcp/transport.js';
import { AxMCPStreamableHTTPTransport } from '../mcp/transports/httpStreamTransport.js';
import type {
  AxMCPJSONRPCResponse,
  AxMCPToolCallResult,
} from '../mcp/types.js';
import { fetchWithSSRFProtection } from '../mcp/util/ssrf.js';
import { randomUUID } from '../util/crypto.js';
import { AxUCPSchemaValidator } from './schema.js';
import { AxUCPHTTPMessageVerifier, axSignUCPRequest } from './signing.js';
import {
  AX_UCP_OPERATION_CAPABILITY,
  AX_UCP_OPERATIONS,
  AX_UCP_SHOPPING_SERVICE,
  AX_UCP_VERSION,
  type AxUCPCallOptions,
  type AxUCPCartInput,
  type AxUCPCatalogLookupRequest,
  type AxUCPCatalogSearchRequest,
  type AxUCPCheckoutCompletion,
  type AxUCPCheckoutInput,
  type AxUCPClientOptions,
  type AxUCPIdentityLinkingConfig,
  type AxUCPNegotiatedProfile,
  type AxUCPOrderEvent,
  type AxUCPOutcome,
  type AxUCPProductRequest,
  type AxUCPProfile,
  type AxUCPService,
  type AxUCPValue,
} from './types.js';

export class AxUCPClient {
  private negotiated?: AxUCPNegotiatedProfile;
  private mcpClient?: AxMCPClient;
  private mcpTransport?: AxMCPTransport;
  private readonly responseVerifier?: AxUCPHTTPMessageVerifier;
  private readonly identityOAuth?: OAuthHelper;
  private identityToken?: TokenSet;
  private readonly webhookIds = new Set<string>();
  private readonly schemaValidator?: AxUCPSchemaValidator;

  constructor(private readonly options: Readonly<AxUCPClientOptions>) {
    this.responseVerifier = options.httpMessageVerification
      ? new AxUCPHTTPMessageVerifier(options.httpMessageVerification)
      : undefined;
    this.identityOAuth = options.identityLinkingOAuth
      ? new OAuthHelper(options.identityLinkingOAuth)
      : undefined;
    this.schemaValidator =
      options.schemaValidation === false
        ? undefined
        : new AxUCPSchemaValidator({
            ...(options.schemaValidation ?? {}),
            fetch:
              options.schemaValidation?.fetch ??
              options.mcp?.mtls?.fetch ??
              options.mcp?.fetch,
            ssrfProtection:
              options.schemaValidation?.ssrfProtection ??
              options.mcp?.ssrfProtection,
          });
  }

  async init(): Promise<void> {
    if (this.negotiated) return;
    const businessProfile = await this.fetchProfile(this.profileURL());
    const version = this.options.version ?? AX_UCP_VERSION;
    if (
      businessProfile.ucp.version !== version &&
      !businessProfile.ucp.supported_versions?.[version]
    ) {
      throw new Error(
        `UCP version ${version} is not supported by business profile ${businessProfile.ucp.version}`
      );
    }
    const profile =
      businessProfile.ucp.version === version
        ? businessProfile
        : await this.fetchProfile(
            businessProfile.ucp.supported_versions![version]!
          );
    const service = this.selectService(profile, version);
    const capabilities = this.negotiateCapabilities(profile, version);
    this.negotiated = {
      version,
      service,
      capabilities,
      paymentHandlers: profile.ucp.payment_handlers ?? {},
      signingKeys: profile.signing_keys ?? [],
      businessProfile: profile,
    };
    if (service.transport === 'mcp') {
      const transport = new AxMCPStreamableHTTPTransport(
        service.endpoint,
        this.options.mcp
      );
      this.mcpTransport = transport;
      this.mcpClient = new AxMCPClient(transport, { namespace: 'ucp' });
      if (!this.options.skipMCPInitialization) await this.mcpClient.init();
    }
  }

  getProfile(): AxUCPNegotiatedProfile {
    if (!this.negotiated) throw new Error('UCP client is not initialized');
    return this.negotiated;
  }

  getNamespace(): string {
    const value = this.options.namespace ?? 'ucp';
    return (
      value
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'ucp'
    );
  }

  getEvaluationMode(): 'live' | 'replay' | 'sandbox' {
    return this.options.evaluationMode ?? 'live';
  }

  getOperationNames(): readonly string[] {
    const capabilities = this.negotiated?.capabilities;
    const names = new Set<string>(
      AX_UCP_OPERATIONS.filter(
        (operation) =>
          capabilities === undefined ||
          capabilities[AX_UCP_OPERATION_CAPABILITY[operation]!]
      )
    );
    for (const tool of this.mcpClient?.getTools() ?? []) names.add(tool.name);
    return [...names];
  }

  getOperationBindings(): AxFunction[] {
    return this.getOperationNames().map((operation) => ({
      name: operation,
      namespace: this.getNamespace(),
      componentId: `ucp:${this.getNamespace()}:${operation}`,
      description: `Execute the negotiated UCP ${operation} operation`,
      parameters: { type: 'object', additionalProperties: true },
      protocol: {
        kind: 'ucp',
        namespace: this.getNamespace(),
        name: operation,
        meta: {
          version:
            this.negotiated?.version ?? this.options.version ?? AX_UCP_VERSION,
        },
      },
      func: (input, extra) =>
        this.call(operation, input ?? {}, { signal: extra?.abortSignal }),
    }));
  }

  getPaymentHandlers(): AxUCPNegotiatedProfile['paymentHandlers'] {
    return this.getProfile().paymentHandlers;
  }

  getIdentityLinkingConfig(): AxUCPIdentityLinkingConfig | undefined {
    const declaration =
      this.getProfile().capabilities['dev.ucp.common.identity_linking']?.[0];
    const config = declaration?.config;
    return config && typeof config === 'object'
      ? (config as AxUCPIdentityLinkingConfig)
      : undefined;
  }

  getIdentityLinkingScopes(): readonly string[] {
    return Object.keys(this.getIdentityLinkingConfig()?.scopes ?? {});
  }

  async verifyOrderEvent(request: Request): Promise<AxUCPOrderEvent> {
    await this.init();
    const signer = request.headers
      .get('UCP-Agent')
      ?.match(/(?:^|;)\s*profile="([^"]+)"/)?.[1];
    if (!signer) throw new Error('UCP order event is missing signer profile');
    const trusted = new Set([
      this.profileURL(),
      ...(this.options.trustedBusinessProfileUrls ?? []),
    ]);
    if (!trusted.has(signer)) {
      throw new Error(`UCP order event profile is not trusted: ${signer}`);
    }
    const webhookId = request.headers.get('Webhook-Id');
    const webhookTimestamp = Number(request.headers.get('Webhook-Timestamp'));
    if (!webhookId || !Number.isFinite(webhookTimestamp)) {
      throw new Error('UCP order event is missing webhook identity headers');
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      Math.abs(now - webhookTimestamp) >
      (this.options.webhookMaxAgeSeconds ?? 300)
    ) {
      throw new Error(
        'UCP order event timestamp is outside the acceptance window'
      );
    }
    if (this.webhookIds.has(webhookId)) {
      throw new Error(`UCP order event was replayed: ${webhookId}`);
    }
    const body = await request.clone().text();
    const profile = this.getProfile();
    const verifier = new AxUCPHTTPMessageVerifier({
      required: true,
      replayProtection: true,
    });
    await verifier.verifyRequest(request, {
      body,
      signingKeys: profile.signingKeys,
      refreshSigningKeys: async () => {
        const refreshed = await this.fetchProfile(signer);
        if (signer === this.profileURL()) {
          profile.signingKeys = refreshed.signing_keys ?? [];
          profile.businessProfile = refreshed;
        }
        return refreshed.signing_keys ?? [];
      },
    });
    const event = await this.validateOutcome(
      JSON.parse(body) as AxUCPValue,
      'get_order'
    );
    if (typeof event.id !== 'string' || typeof event.checkout_id !== 'string') {
      throw new Error('Invalid UCP order event: missing id or checkout_id');
    }
    this.webhookIds.add(webhookId);
    return event as AxUCPOrderEvent;
  }

  /** Returns the live MCP client used by AxGen/AxAgent native integration. */
  getMCPClient(): AxMCPClient | undefined {
    return this.options.skipMCPInitialization ? undefined : this.mcpClient;
  }

  async close(): Promise<void> {
    await this.mcpClient?.close();
  }

  searchCatalog(
    catalog: Readonly<AxUCPCatalogSearchRequest>,
    options?: Readonly<AxUCPCallOptions>
  ): Promise<AxUCPOutcome> {
    return this.call('search_catalog', { catalog }, options);
  }

  lookupCatalog(
    catalog: Readonly<AxUCPCatalogLookupRequest>,
    options?: Readonly<AxUCPCallOptions>
  ): Promise<AxUCPOutcome> {
    return this.call('lookup_catalog', { catalog }, options);
  }

  getProduct(
    catalog: Readonly<AxUCPProductRequest>,
    options?: Readonly<AxUCPCallOptions>
  ): Promise<AxUCPOutcome> {
    return this.call('get_product', { catalog }, options);
  }

  createCart(
    cart: Readonly<AxUCPCartInput>,
    options?: Readonly<AxUCPCallOptions>
  ) {
    return this.call('create_cart', { cart }, options);
  }

  getCart(id: string, options?: Readonly<AxUCPCallOptions>) {
    return this.call('get_cart', { id }, options);
  }

  updateCart(
    id: string,
    cart: Readonly<AxUCPCartInput>,
    options?: Readonly<AxUCPCallOptions>
  ) {
    return this.call('update_cart', { id, cart }, options);
  }

  cancelCart(id: string, options?: Readonly<AxUCPCallOptions>) {
    return this.call('cancel_cart', { id }, options);
  }

  createCheckout(
    checkout: Readonly<AxUCPCheckoutInput>,
    options?: Readonly<AxUCPCallOptions>
  ) {
    return this.call('create_checkout', { checkout }, options);
  }

  getCheckout(id: string, options?: Readonly<AxUCPCallOptions>) {
    return this.call('get_checkout', { id }, options);
  }

  updateCheckout(
    id: string,
    checkout: Readonly<AxUCPCheckoutInput>,
    options?: Readonly<AxUCPCallOptions>
  ) {
    return this.call('update_checkout', { id, checkout }, options);
  }

  completeCheckout(
    id: string,
    options: Readonly<AxUCPCallOptions>
  ): Promise<AxUCPOutcome>;
  completeCheckout(
    id: string,
    completion: Readonly<AxUCPCheckoutCompletion>,
    options: Readonly<AxUCPCallOptions>
  ): Promise<AxUCPOutcome>;
  completeCheckout(
    id: string,
    completionOrOptions: Readonly<AxUCPCheckoutCompletion | AxUCPCallOptions>,
    maybeOptions?: Readonly<AxUCPCallOptions>
  ) {
    const completion = maybeOptions ? completionOrOptions : {};
    const options = maybeOptions ?? (completionOrOptions as AxUCPCallOptions);
    this.requireIdempotency('complete_checkout', options);
    return this.call('complete_checkout', { id, ...completion }, options);
  }

  cancelCheckout(id: string, options: Readonly<AxUCPCallOptions>) {
    this.requireIdempotency('cancel_checkout', options);
    return this.call('cancel_checkout', { id }, options);
  }

  getOrder(id: string, options?: Readonly<AxUCPCallOptions>) {
    return this.call('get_order', { id }, options);
  }

  async call(
    operation: string,
    input: Readonly<AxUCPValue>,
    options: Readonly<AxUCPCallOptions> = {}
  ): Promise<AxUCPOutcome> {
    await this.init();
    const profile = this.getProfile();
    const effectiveOptions = {
      ...options,
      idempotencyKey:
        options.idempotencyKey ??
        (this.isStateChanging(operation) ? randomUUID() : undefined),
    };
    const args = this.withAgentMetadata(input, effectiveOptions.idempotencyKey);
    if (profile.service.transport === 'mcp') {
      if (this.options.skipMCPInitialization) {
        if (!this.mcpTransport) {
          throw new Error('UCP MCP transport was not initialized');
        }
        const response = await this.mcpTransport.send(
          {
            jsonrpc: '2.0',
            id: randomUUID(),
            method: 'tools/call',
            params: { name: operation, arguments: args },
          },
          { signal: effectiveOptions.signal }
        );
        return this.outcomeFromMCPResponse(operation, response);
      }
      if (!this.mcpClient)
        throw new Error('UCP MCP client was not initialized');
      const result = await this.mcpClient.callTool(operation, args, {
        signal: effectiveOptions.signal,
      });
      if (result.isError) {
        throw new Error(`UCP MCP operation ${operation} returned isError`);
      }
      if (!result.structuredContent) {
        throw new Error(
          `UCP MCP operation ${operation} did not return structuredContent`
        );
      }
      return this.validateOutcome(result.structuredContent, operation);
    }
    return this.callREST(operation, args, effectiveOptions);
  }

  private profileURL(): string {
    const input = new URL(this.options.profileUrl);
    if (input.pathname === '/' || input.pathname === '') {
      input.pathname = '/.well-known/ucp';
    }
    return input.toString();
  }

  private async fetchProfile(url: string): Promise<AxUCPProfile> {
    const response = await fetchWithSSRFProtection(url, {
      headers: this.options.headers,
      ssrfProtection: this.options.mcp?.ssrfProtection,
      ssrfContext: 'mcp-endpoint',
    });
    if (!response.ok) {
      throw new Error(`UCP profile discovery failed: ${response.status}`);
    }
    const profile = (await response.json()) as AxUCPProfile;
    if (
      !profile.ucp?.version ||
      !profile.ucp.services ||
      !profile.ucp.capabilities
    ) {
      throw new Error(
        'Invalid UCP profile: missing ucp version/services/capabilities'
      );
    }
    return profile;
  }

  private selectService(profile: AxUCPProfile, version: string): AxUCPService {
    const services = profile.ucp.services[AX_UCP_SHOPPING_SERVICE] ?? [];
    const preference = this.options.transport ?? 'auto';
    const candidates = services.filter(
      (service) => service.version === version
    );
    const selected =
      preference === 'auto'
        ? (candidates.find((service) => service.transport === 'mcp') ??
          candidates.find((service) => service.transport === 'rest'))
        : candidates.find((service) => service.transport === preference);
    if (!selected) {
      throw new Error(`No compatible UCP ${preference} shopping service found`);
    }
    return selected;
  }

  private negotiateCapabilities(
    profile: AxUCPProfile,
    version: string
  ): AxUCPNegotiatedProfile['capabilities'] {
    const platform = this.options.platformCapabilities;
    const selected = Object.fromEntries(
      Object.entries(profile.ucp.capabilities).flatMap(
        ([name, declarations]) => {
          const compatible = declarations.filter(
            (item) => item.version === version
          );
          const allowed = platform
            ? compatible.filter((item) =>
                platform[name]?.some(
                  (candidate) => candidate.version === item.version
                )
              )
            : compatible;
          return allowed.length ? [[name, allowed] as const] : [];
        }
      )
    );
    for (const [name, declarations] of Object.entries(selected)) {
      const parents = declarations.flatMap((item) => {
        if (!item.extends) return [];
        return Array.isArray(item.extends) ? item.extends : [item.extends];
      });
      if (parents.some((parent) => !selected[parent])) delete selected[name];
    }
    return selected;
  }

  private withAgentMetadata(
    input: Readonly<AxUCPValue>,
    idempotencyKey?: string
  ): AxUCPValue {
    const current =
      input.meta && typeof input.meta === 'object'
        ? (input.meta as AxUCPValue)
        : {};
    return {
      ...input,
      meta: {
        ...current,
        'ucp-agent': {
          ...(current['ucp-agent'] as AxUCPValue | undefined),
          profile: this.options.agentProfile,
        },
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
    };
  }

  private async callREST(
    operation: string,
    body: Readonly<AxUCPValue>,
    options: Readonly<AxUCPCallOptions>
  ): Promise<AxUCPOutcome> {
    const profile = this.getProfile();
    const rest = this.restRequest(operation, body);
    const endpoint = `${profile.service.endpoint.replace(/\/$/, '')}/${rest.path}`;
    const serialized =
      rest.body === undefined ? undefined : JSON.stringify(rest.body);
    let headers: Record<string, string> = {
      ...(serialized === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      'UCP-Agent': `profile="${this.options.agentProfile.replaceAll('"', '\\"')}"`,
      'Request-Id': randomUUID(),
      ...(options.idempotencyKey
        ? { 'Idempotency-Key': options.idempotencyKey }
        : {}),
      ...this.options.headers,
    };
    if (this.options.httpMessageSignature) {
      headers = await axSignUCPRequest(
        {
          url: endpoint,
          method: rest.method,
          headers,
          body: serialized,
        },
        this.options.httpMessageSignature
      );
    }
    if (this.options.signRequest) {
      headers = {
        ...headers,
        ...(await this.options.signRequest({
          url: endpoint,
          method: rest.method,
          headers,
          body: serialized ?? '',
        })),
      };
    }
    const hostToken = await this.options.getIdentityToken?.();
    if (hostToken) this.identityToken = hostToken;
    if (this.identityToken) {
      headers.Authorization = `${this.identityToken.tokenType ?? 'Bearer'} ${this.identityToken.accessToken}`;
    }
    const execute = () =>
      fetchWithSSRFProtection(endpoint, {
        method: rest.method,
        headers,
        ...(serialized === undefined ? {} : { body: serialized }),
        signal: options.signal,
        ssrfProtection: this.options.mcp?.ssrfProtection,
        ssrfContext: 'mcp-endpoint',
      });
    let response = await execute();
    if (
      (response.status === 401 || response.status === 403) &&
      this.identityOAuth
    ) {
      const ensured = await this.identityOAuth.ensureAccessToken({
        requestedUrl: endpoint,
        wwwAuthenticate: response.headers.get('WWW-Authenticate'),
        currentToken: this.identityToken,
        forceRefresh: this.identityToken !== undefined,
      });
      if (ensured) {
        this.identityToken = ensured.token;
        headers.Authorization = `${ensured.token.tokenType ?? 'Bearer'} ${ensured.token.accessToken}`;
        response = await execute();
      }
    }
    if (this.responseVerifier) {
      await this.responseVerifier.verify(response, {
        body: await response.clone().text(),
        signingKeys: profile.signingKeys,
        refreshSigningKeys: async () => {
          const refreshed = await this.fetchProfile(this.profileURL());
          profile.signingKeys = refreshed.signing_keys ?? [];
          profile.businessProfile = refreshed;
          return profile.signingKeys;
        },
      });
    }
    await this.options.verifyResponse?.(response.clone(), { profile });
    if (!response.ok) {
      throw new Error(
        `UCP REST operation ${operation} failed: ${response.status} ${response.statusText}`
      );
    }
    return this.validateOutcome(
      (await response.json()) as AxUCPValue,
      operation
    );
  }

  private restRequest(
    operation: string,
    input: Readonly<AxUCPValue>
  ): { method: 'GET' | 'POST' | 'PUT'; path: string; body?: AxUCPValue } {
    const id = typeof input.id === 'string' ? encodeURIComponent(input.id) : '';
    const body = (name: string) =>
      input[name] && typeof input[name] === 'object'
        ? (input[name] as AxUCPValue)
        : {};
    const requests: Record<
      string,
      { method: 'GET' | 'POST' | 'PUT'; path: string; body?: AxUCPValue }
    > = {
      search_catalog: {
        method: 'POST',
        path: 'catalog/search',
        body: body('catalog'),
      },
      lookup_catalog: {
        method: 'POST',
        path: 'catalog/lookup',
        body: body('catalog'),
      },
      get_product: {
        method: 'POST',
        path: 'catalog/product',
        body: body('catalog'),
      },
      create_cart: { method: 'POST', path: 'carts', body: body('cart') },
      get_cart: { method: 'GET', path: `carts/${id}` },
      update_cart: { method: 'PUT', path: `carts/${id}`, body: body('cart') },
      cancel_cart: { method: 'POST', path: `carts/${id}/cancel`, body: {} },
      create_checkout: {
        method: 'POST',
        path: 'checkout-sessions',
        body: body('checkout'),
      },
      get_checkout: { method: 'GET', path: `checkout-sessions/${id}` },
      update_checkout: {
        method: 'PUT',
        path: `checkout-sessions/${id}`,
        body: body('checkout'),
      },
      complete_checkout: {
        method: 'POST',
        path: `checkout-sessions/${id}/complete`,
        body: this.operationBody(input),
      },
      cancel_checkout: {
        method: 'POST',
        path: `checkout-sessions/${id}/cancel`,
        body: {},
      },
      get_order: { method: 'GET', path: `orders/${id}` },
    };
    return (
      requests[operation] ?? {
        method: 'POST',
        path: operation.replaceAll('_', '/'),
        body: { ...input },
      }
    );
  }

  private async outcomeFromMCPResponse(
    operation: string,
    response: AxMCPJSONRPCResponse<unknown>
  ): Promise<AxUCPOutcome> {
    if ('error' in response) {
      throw new Error(
        `UCP MCP operation ${operation} failed: ${response.error.code} ${response.error.message}`
      );
    }
    const result = response.result as AxMCPToolCallResult;
    if (result.isError) {
      throw new Error(`UCP MCP operation ${operation} returned isError`);
    }
    if (!result.structuredContent) {
      throw new Error(
        `UCP MCP operation ${operation} did not return structuredContent`
      );
    }
    return this.validateOutcome(result.structuredContent, operation);
  }

  private requireIdempotency(
    operation: string,
    options: Readonly<AxUCPCallOptions>
  ): void {
    if (!options.idempotencyKey) {
      throw new Error(`${operation} requires an idempotencyKey`);
    }
  }

  private isStateChanging(operation: string): boolean {
    return new Set([
      'create_cart',
      'update_cart',
      'cancel_cart',
      'create_checkout',
      'update_checkout',
      'complete_checkout',
      'cancel_checkout',
    ]).has(operation);
  }

  private operationBody(input: Readonly<AxUCPValue>): AxUCPValue {
    const { id: _id, meta: _meta, ...body } = input;
    return body;
  }

  async validateAgainstSchema(
    value: unknown,
    schemaUrl: string
  ): Promise<void> {
    if (!this.schemaValidator) {
      throw new Error('UCP schema validation is disabled');
    }
    await this.schemaValidator.validate(value, schemaUrl);
  }

  private async validateOutcome(
    value: AxUCPValue,
    operation?: string
  ): Promise<AxUCPOutcome> {
    const ucp = value.ucp;
    if (
      !ucp ||
      typeof ucp !== 'object' ||
      typeof (ucp as AxUCPValue).version !== 'string'
    ) {
      throw new Error('Invalid UCP outcome: missing ucp.version');
    }
    if (this.schemaValidator && operation) {
      const root = AX_UCP_OPERATION_CAPABILITY[operation];
      const schemas = new Set<string>();
      for (const [name, declarations] of Object.entries(
        this.getProfile().capabilities
      )) {
        const relevant =
          name === root ||
          declarations.some((declaration) => {
            const parents = Array.isArray(declaration.extends)
              ? declaration.extends
              : declaration.extends
                ? [declaration.extends]
                : [];
            return root !== undefined && parents.includes(root);
          });
        if (!relevant) continue;
        for (const declaration of declarations) {
          if (typeof declaration.schema === 'string') {
            schemas.add(declaration.schema);
          }
        }
      }
      for (const schema of schemas) {
        await this.schemaValidator.validate(value, schema);
      }
    }
    return value as AxUCPOutcome;
  }
}

import type { AxFunction } from '../ai/types.js';
