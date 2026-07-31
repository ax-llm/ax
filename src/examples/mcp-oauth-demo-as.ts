import { createHash, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { fileURLToPath } from 'node:url';

export interface AxMCPOAuthDemoASOptions {
  wrongAuthorizationResponseIssuer?: boolean;
}

type AuthorizationCode = {
  challenge: string;
  clientId: string;
  redirectUri: string;
  resource: string;
};

export class AxMCPOAuthDemoAS {
  private readonly server = createServer((request, response) => {
    void this.handle(request, response);
  });
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly refreshTokens = new Map<string, string>();
  private readonly accessTokens = new Map<string, number>();
  private issuer?: string;
  private codeExchanges = 0;
  private refreshExchanges = 0;

  constructor(
    private readonly options: Readonly<AxMCPOAuthDemoASOptions> = {}
  ) {}

  async start(port = 0): Promise<string> {
    if (this.issuer) return this.issuer;
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('OAuth demo authorization server did not bind a port');
    }
    this.issuer = `http://127.0.0.1:${address.port}/as`;
    return this.issuer;
  }

  validateAccessToken(token: string): boolean {
    const remainingUses = this.accessTokens.get(token);
    if (remainingUses === undefined || remainingUses === 0) return false;
    if (Number.isFinite(remainingUses)) {
      this.accessTokens.set(token, remainingUses - 1);
    }
    return true;
  }

  getCodeExchangeCount(): number {
    return this.codeExchanges;
  }

  getRefreshExchangeCount(): number {
    return this.refreshExchanges;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve()))
    );
    this.issuer = undefined;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    if (!this.issuer || !request.url) {
      response.writeHead(503).end();
      return;
    }
    const url = new URL(request.url, this.issuer);
    if (
      request.method === 'GET' &&
      (url.pathname === '/.well-known/oauth-authorization-server/as' ||
        url.pathname === '/.well-known/openid-configuration/as' ||
        url.pathname === '/as/.well-known/openid-configuration')
    ) {
      this.writeJSON(response, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        grant_types_supported: [
          'authorization_code',
          'refresh_token',
          'client_credentials',
        ],
        scopes_supported: ['mcp:read'],
        authorization_response_iss_parameter_supported: true,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/as/authorize') {
      const code = randomUUID();
      const challenge = url.searchParams.get('code_challenge') ?? '';
      const clientId = url.searchParams.get('client_id') ?? '';
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const resource = url.searchParams.get('resource') ?? '';
      if (
        !challenge ||
        url.searchParams.get('code_challenge_method') !== 'S256' ||
        !clientId ||
        !redirectUri ||
        !resource
      ) {
        this.writeJSON(response, { error: 'invalid_request' }, 400);
        return;
      }
      this.codes.set(code, { challenge, clientId, redirectUri, resource });
      this.writeJSON(response, {
        code,
        state: url.searchParams.get('state') ?? '',
        iss: this.options.wrongAuthorizationResponseIssuer
          ? `${this.issuer}/wrong`
          : this.issuer,
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/as/token') {
      await this.exchange(request, response);
      return;
    }
    response.writeHead(404).end();
  }

  private async exchange(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const body = new URLSearchParams(await this.readBody(request));
    const grantType = body.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = body.get('code') ?? '';
      const record = this.codes.get(code);
      const verifier = body.get('code_verifier') ?? '';
      if (
        !record ||
        record.challenge !==
          createHash('sha256').update(verifier).digest('base64url') ||
        record.clientId !== body.get('client_id') ||
        record.redirectUri !== body.get('redirect_uri') ||
        record.resource !== body.get('resource')
      ) {
        this.writeJSON(response, { error: 'invalid_grant' }, 400);
        return;
      }
      this.codes.delete(code);
      this.codeExchanges += 1;
      this.issueToken(response, record.resource, 1, true);
      return;
    }
    if (grantType === 'refresh_token') {
      const refreshToken = body.get('refresh_token') ?? '';
      const resource = this.refreshTokens.get(refreshToken);
      if (!resource || resource !== body.get('resource')) {
        this.writeJSON(response, { error: 'invalid_grant' }, 400);
        return;
      }
      this.refreshExchanges += 1;
      this.issueToken(response, resource, Number.POSITIVE_INFINITY, false);
      return;
    }
    if (grantType === 'client_credentials') {
      const resource = body.get('resource') ?? '';
      if (!resource) {
        this.writeJSON(response, { error: 'invalid_target' }, 400);
        return;
      }
      this.issueToken(response, resource, Number.POSITIVE_INFINITY, false);
      return;
    }
    this.writeJSON(response, { error: 'unsupported_grant_type' }, 400);
  }

  private issueToken(
    response: ServerResponse,
    resource: string,
    uses: number,
    includeRefreshToken: boolean
  ): void {
    const accessToken = `access-${randomUUID()}`;
    this.accessTokens.set(accessToken, uses);
    const value: Record<string, unknown> = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: uses === Number.POSITIVE_INFINITY ? 3600 : 1,
      scope: 'mcp:read',
    };
    if (includeRefreshToken) {
      const refreshToken = `refresh-${randomUUID()}`;
      this.refreshTokens.set(refreshToken, resource);
      value.refresh_token = refreshToken;
    }
    this.writeJSON(response, value);
  }

  private writeJSON(
    response: ServerResponse,
    value: unknown,
    status = 200
  ): void {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    response.end(body);
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const authorizationServer = new AxMCPOAuthDemoAS();
  const issuer = await authorizationServer.start(Number(process.env.PORT ?? 0));
  console.log(`MCP OAuth demo authorization server listening at ${issuer}`);
  const stop = async () => {
    await authorizationServer.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
