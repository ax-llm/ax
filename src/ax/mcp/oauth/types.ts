export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  issuer?: string;
};

export interface AxMCPOAuthOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string; // default: http://localhost:8787/callback (not auto-handled)
  scopes?: string[];
  selectAuthorizationServer?: (
    issuers: string[],
    resourceMetadata: unknown
  ) => Promise<string> | string;
  onAuthCode?: (
    authorizationUrl: string
  ) => Promise<{ code: string; redirectUri?: string }>;
  tokenStore?: {
    getToken: (key: string) => Promise<TokenSet | null> | TokenSet | null;
    setToken: (key: string, token: TokenSet) => Promise<void> | void;
    clearToken?: (key: string) => Promise<void> | void;
  };
}
