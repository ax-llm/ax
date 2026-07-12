import type { AxMCPSSRFProtectionOptions } from '../util/ssrf.js';
import type { AxMCPDPoPOptions } from './dpop.js';

export type AxMCPTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  issuer?: string;
  tokenType?: string;
  scope?: string;
  idToken?: string;
};

export type TokenSet = AxMCPTokenSet;

export interface AxMCPOAuthTokenIntrospection {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  sub?: string;
  aud?: string | readonly string[];
  iss?: string;
  jti?: string;
  [key: string]: unknown;
}

export type AxMCPOAuthTokenEndpointAuthMethod =
  | 'none'
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'client_secret_jwt'
  | 'private_key_jwt';

export interface AxMCPOAuthClientRegistration {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  registration_access_token?: string;
  registration_client_uri?: string;
  token_endpoint_auth_method?: AxMCPOAuthTokenEndpointAuthMethod;
}

export type AxMCPEnterpriseIdentityAssertionType =
  | 'urn:ietf:params:oauth:token-type:id_token'
  | 'urn:ietf:params:oauth:token-type:saml2'
  | (string & {});

export interface AxMCPEnterpriseAuthorizationContext {
  /** MCP authorization-server issuer discovered for the protected resource. */
  authorizationServerUrl: string;
  /** Canonical MCP protected-resource identifier from RFC 9728 discovery. */
  resourceUrl: string;
  scope?: string;
}

export interface AxMCPEnterpriseManagedAuthorizationOptions {
  /**
   * Supplies an already-issued ID-JAG. Use this when an organization owns the
   * IdP exchange outside Ax. When omitted, Ax performs the RFC 8693 exchange
   * using the identity-provider options below.
   */
  getAuthorizationGrant?: (
    context: Readonly<AxMCPEnterpriseAuthorizationContext>
  ) => string | Promise<string>;
  /** IdP token endpoint used to exchange the user's identity assertion. */
  identityProviderTokenEndpoint?: string;
  /** Supplies the ID token or SAML assertion retained from enterprise SSO. */
  getIdentityAssertion?: (
    context: Readonly<AxMCPEnterpriseAuthorizationContext>
  ) =>
    | string
    | Readonly<{
        assertion: string;
        type?: AxMCPEnterpriseIdentityAssertionType;
      }>
    | Promise<
        | string
        | Readonly<{
            assertion: string;
            type?: AxMCPEnterpriseIdentityAssertionType;
          }>
      >;
  identityProviderClientId?: string;
  identityProviderClientSecret?: string;
  identityProviderTokenEndpointAuthMethod?: AxMCPOAuthTokenEndpointAuthMethod;
  /** Creates an IdP client assertion for secret/private-key JWT auth. */
  createIdentityProviderClientAssertion?: (
    request: Readonly<{
      method: 'client_secret_jwt' | 'private_key_jwt';
      clientId: string;
      audience: string;
    }>
  ) => string | Promise<string>;
  /** Additional organization-defined RFC 8693 parameters. */
  identityProviderParameters?: Readonly<Record<string, string>>;
}

export interface AxMCPOAuthJWTValidationOptions {
  /** Set false only when the host independently verifies every returned ID token. */
  validateIdTokens?: boolean;
  allowedAlgorithms?: readonly string[];
  clockToleranceSeconds?: number;
  now?: () => number;
  ssrfProtection?: AxMCPSSRFProtectionOptions;
  fetch?: typeof globalThis.fetch;
}

export interface AxMCPMTLSOptions {
  /**
   * Fetch implementation whose host TLS stack presents the configured client
   * certificate. Browsers may satisfy this through their certificate UI;
   * server runtimes typically inject an agent/dispatcher-backed fetch.
   */
  fetch: typeof globalThis.fetch;
  /** Require RFC 8705 certificate-bound access tokens in AS metadata. */
  requireCertificateBoundAccessTokens?: boolean;
}

export interface AxMCPOAuthOptions {
  grantType?: 'authorization_code' | 'client_credentials';
  dpop?: AxMCPDPoPOptions;
  /** Official Enterprise-Managed Authorization extension (ID-JAG flow). */
  enterpriseManagedAuthorization?: AxMCPEnterpriseManagedAuthorizationOptions;
  /** OIDC ID-token signature and claim validation. Enabled by default. */
  jwtValidation?: AxMCPOAuthJWTValidationOptions;
  /** RFC 8705 mutual-TLS channel and certificate-bound token policy. */
  mtls?: AxMCPMTLSOptions;
  /** Custom fetch for OAuth endpoints when mTLS is not required. */
  fetch?: typeof globalThis.fetch;
  /** RFC 9126 pushed authorization request behavior. */
  usePAR?: boolean | 'auto';
  /** RFC 9101 request-object producer. The callback must sign the claims. */
  createAuthorizationRequestJWT?: (
    claims: Readonly<Record<string, unknown>>
  ) => string | Promise<string>;
  /** RFC 9396 rich authorization details. */
  authorizationDetails?: readonly Record<string, unknown>[];
  /** Additional RFC 8707 resource indicators. */
  resources?: readonly string[];
  clientId?: string;
  clientSecret?: string;
  /** HTTPS URL used as the client_id when CIMD is advertised by the server. */
  clientMetadataDocumentUrl?: string;
  tokenEndpointAuthMethod?: AxMCPOAuthTokenEndpointAuthMethod;
  /** Creates JWT client assertions for secret/private-key authentication. */
  createClientAssertion?: (
    request: Readonly<{
      method: 'client_secret_jwt' | 'private_key_jwt';
      clientId: string;
      audience: string;
    }>
  ) => string | Promise<string>;
  redirectUri?: string; // default: http://localhost:8787/callback (not auto-handled)
  scopes?: string[];
  /**
   * SSRF protection for OAuth discovery, registration, and token URLs supplied
   * by MCP servers and authorization metadata. Enabled by default.
   */
  ssrfProtection?: AxMCPSSRFProtectionOptions;
  selectAuthorizationServer?: (
    issuers: string[],
    resourceMetadata: unknown
  ) => Promise<string> | string;
  onAuthCode?: (
    authorizationUrl: string,
    context: Readonly<{ state: string; nonce: string; redirectUri: string }>
  ) => Promise<{ code: string; state: string; redirectUri?: string }>;
  tokenStore?: {
    getToken: (key: string) => Promise<TokenSet | null> | TokenSet | null;
    setToken: (key: string, token: TokenSet) => Promise<void> | void;
    clearToken?: (key: string) => Promise<void> | void;
  };
  registrationStore?: {
    getRegistration: (
      issuer: string
    ) =>
      | AxMCPOAuthClientRegistration
      | null
      | Promise<AxMCPOAuthClientRegistration | null>;
    setRegistration: (
      issuer: string,
      registration: AxMCPOAuthClientRegistration
    ) => void | Promise<void>;
    clearRegistration?: (issuer: string) => void | Promise<void>;
  };
}
