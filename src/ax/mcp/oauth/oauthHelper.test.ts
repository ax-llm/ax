import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthHelper } from './oauthHelper.js';

describe('MCP OAuth helper', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses CIMD, validates state, challenged scopes, and client_secret_basic', async () => {
    let tokenRequest: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example/rpc',
            authorization_servers: ['https://auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            issuer: 'https://auth.example',
            authorization_endpoint: 'https://auth.example/authorize',
            token_endpoint: 'https://auth.example/token',
            code_challenge_methods_supported: ['S256'],
            client_id_metadata_document_supported: true,
          });
        }
        if (url === 'https://auth.example/token') {
          tokenRequest = init;
          return Response.json({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            token_type: 'DPoP',
            expires_in: 60,
            scope: 'files:write',
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      })
    );
    const helper = new OAuthHelper({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      tokenEndpointAuthMethod: 'client_secret_basic',
      clientMetadataDocumentUrl: 'https://client.example/metadata.json',
      ssrfProtection: { disabled: true },
      onAuthCode: async (url, context) => {
        expect(new URL(url).searchParams.get('scope')).toBe('files:write');
        return { code: 'code-1', state: context.state };
      },
    });

    const result = await helper.ensureAccessToken({
      requestedUrl: 'https://mcp.example/rpc',
      wwwAuthenticate:
        'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/rpc", scope="files:write"',
    });

    expect(result?.token).toMatchObject({
      accessToken: 'access-1',
      tokenType: 'DPoP',
      scope: 'files:write',
    });
    expect(new Headers(tokenRequest?.headers).get('Authorization')).toBe(
      'Basic Y2xpZW50LTE6c2VjcmV0LTE='
    );
    expect(String(tokenRequest?.body)).toContain(
      'resource=https%3A%2F%2Fmcp.example%2Frpc'
    );
  });

  it('rejects authorization callbacks with the wrong state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://auth.example'],
          });
        }
        return Response.json({
          authorization_endpoint: 'https://auth.example/authorize',
          token_endpoint: 'https://auth.example/token',
          code_challenge_methods_supported: ['S256'],
        });
      })
    );
    const helper = new OAuthHelper({
      clientId: 'client-1',
      ssrfProtection: { disabled: true },
      onAuthCode: async () => ({ code: 'code-1', state: 'wrong' }),
    });

    await expect(
      helper.ensureAccessToken({
        requestedUrl: 'https://mcp.example/rpc',
        wwwAuthenticate: null,
      })
    ).rejects.toThrow('OAuth state mismatch');
  });

  it('obtains non-interactive client credentials tokens', async () => {
    let tokenBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            token_endpoint: 'https://auth.example/token',
          });
        }
        tokenBody = String(init?.body);
        return Response.json({ access_token: 'machine-token', expires_in: 30 });
      })
    );
    const helper = new OAuthHelper({
      grantType: 'client_credentials',
      clientId: 'machine-1',
      clientSecret: 'secret-1',
      tokenEndpointAuthMethod: 'client_secret_post',
      scopes: ['inventory:read'],
      ssrfProtection: { disabled: true },
    });

    const result = await helper.ensureAccessToken({
      requestedUrl: 'https://mcp.example/rpc',
      wwwAuthenticate: null,
    });

    expect(result?.token.accessToken).toBe('machine-token');
    expect(tokenBody).toContain('grant_type=client_credentials');
    expect(tokenBody).toContain('client_id=machine-1');
    expect(tokenBody).toContain('client_secret=secret-1');
    expect(tokenBody).toContain('resource=https%3A%2F%2Fmcp.example');
  });

  it('retries DPoP token requests with authorization-server nonces', async () => {
    let tokenAttempts = 0;
    const proofs: Array<{ nonce?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            token_endpoint: 'https://auth.example/token',
          });
        }
        tokenAttempts++;
        expect(new Headers(init?.headers).get('DPoP')).toBe(
          `proof-${tokenAttempts}`
        );
        if (tokenAttempts === 1) {
          return Response.json(
            { error: 'use_dpop_nonce' },
            { status: 400, headers: { 'DPoP-Nonce': 'nonce-1' } }
          );
        }
        return Response.json({
          access_token: 'dpop-token',
          token_type: 'DPoP',
        });
      })
    );
    const helper = new OAuthHelper({
      grantType: 'client_credentials',
      clientId: 'machine-1',
      clientSecret: 'secret-1',
      ssrfProtection: { disabled: true },
      dpop: {
        createProof: (request) => {
          proofs.push({ nonce: request.nonce });
          return `proof-${proofs.length}`;
        },
      },
    });

    const result = await helper.ensureAccessToken({
      requestedUrl: 'https://mcp.example/rpc',
      wwwAuthenticate: null,
    });

    expect(result?.token).toMatchObject({
      accessToken: 'dpop-token',
      tokenType: 'DPoP',
    });
    expect(proofs).toEqual([{ nonce: undefined }, { nonce: 'nonce-1' }]);
  });

  it('composes JAR, PAR, RAR, and multiple resource indicators', async () => {
    let pushedBody = '';
    let requestClaims: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            authorization_endpoint: 'https://auth.example/authorize?tenant=1',
            token_endpoint: 'https://auth.example/token',
            pushed_authorization_request_endpoint: 'https://auth.example/par',
            code_challenge_methods_supported: ['S256'],
          });
        }
        if (url === 'https://auth.example/par') {
          pushedBody = String(init?.body);
          return Response.json({
            request_uri: 'urn:ietf:params:oauth:request_uri:request-1',
            expires_in: 60,
          });
        }
        return Response.json({ access_token: 'access-1' });
      })
    );
    const helper = new OAuthHelper({
      clientId: 'client-1',
      usePAR: true,
      resources: ['https://api.example'],
      authorizationDetails: [{ type: 'payment_initiation', amount: '10' }],
      createAuthorizationRequestJWT: async (claims) => {
        requestClaims = { ...claims };
        return 'signed.request.jwt';
      },
      ssrfProtection: { disabled: true },
      onAuthCode: async (url, context) => {
        const parsed = new URL(url);
        expect(parsed.searchParams.get('tenant')).toBe('1');
        expect(parsed.searchParams.get('client_id')).toBe('client-1');
        expect(parsed.searchParams.get('request_uri')).toBe(
          'urn:ietf:params:oauth:request_uri:request-1'
        );
        expect(parsed.searchParams.has('state')).toBe(false);
        return { code: 'code-1', state: context.state };
      },
    });

    await helper.ensureAccessToken({
      requestedUrl: 'https://mcp.example/rpc',
      wwwAuthenticate: null,
    });

    expect(requestClaims).toMatchObject({
      iss: 'client-1',
      aud: 'https://auth.example',
      resource: ['https://mcp.example', 'https://api.example'],
      authorization_details: JSON.stringify([
        { type: 'payment_initiation', amount: '10' },
      ]),
    });
    const pushed = new URLSearchParams(pushedBody);
    expect(pushed.get('request')).toBe('signed.request.jwt');
    expect(pushed.get('client_id')).toBe('client-1');
  });

  it('supports authenticated token introspection and revocation', async () => {
    const endpointBodies = new Map<string, string>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            authorization_endpoint: 'https://auth.example/authorize',
            token_endpoint: 'https://auth.example/token',
            introspection_endpoint: 'https://auth.example/introspect',
            revocation_endpoint: 'https://auth.example/revoke',
            code_challenge_methods_supported: ['S256'],
          });
        }
        endpointBodies.set(url, String(init?.body));
        expect(new Headers(init?.headers).get('Authorization')).toBe(
          'Basic Y2xpZW50LTE6c2VjcmV0LTE='
        );
        return url.endsWith('/introspect')
          ? Response.json({ active: true, scope: 'files:read' })
          : new Response(null, { status: 200 });
      })
    );
    const helper = new OAuthHelper({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      tokenEndpointAuthMethod: 'client_secret_basic',
      ssrfProtection: { disabled: true },
    });

    await expect(
      helper.introspectToken({
        requestedUrl: 'https://mcp.example/rpc',
        token: 'access-1',
        tokenTypeHint: 'access_token',
      })
    ).resolves.toMatchObject({ active: true, scope: 'files:read' });
    await helper.revokeToken({
      requestedUrl: 'https://mcp.example/rpc',
      token: 'refresh-1',
      tokenTypeHint: 'refresh_token',
    });

    expect(endpointBodies.get('https://auth.example/introspect')).toContain(
      'token=access-1'
    );
    expect(endpointBodies.get('https://auth.example/revoke')).toContain(
      'token=refresh-1'
    );
  });

  it('performs the enterprise ID assertion and ID-JAG exchanges without redirecting', async () => {
    const endpointBodies = new Map<string, URLSearchParams>();
    const onAuthCode = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://mcp-auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            issuer: 'https://mcp-auth.example',
            token_endpoint: 'https://mcp-auth.example/token',
          });
        }
        endpointBodies.set(url, new URLSearchParams(String(init?.body)));
        if (url === 'https://idp.example/token') {
          expect(new Headers(init?.headers).get('Authorization')).toBe(
            'Basic aWRwLWNsaWVudDppZHAtc2VjcmV0'
          );
          return Response.json({
            access_token: 'signed-id-jag',
            issued_token_type: 'urn:ietf:params:oauth:token-type:jwt',
          });
        }
        return Response.json({
          access_token: 'mcp-access-token',
          refresh_token: 'mcp-refresh-token',
          token_type: 'DPoP',
          expires_in: 300,
        });
      })
    );
    const helper = new OAuthHelper({
      clientId: 'mcp-client',
      clientSecret: 'mcp-secret',
      tokenEndpointAuthMethod: 'client_secret_post',
      ssrfProtection: { disabled: true },
      onAuthCode,
      resources: ['https://related-api.example'],
      enterpriseManagedAuthorization: {
        identityProviderTokenEndpoint: 'https://idp.example/token',
        identityProviderClientId: 'idp-client',
        identityProviderClientSecret: 'idp-secret',
        identityProviderTokenEndpointAuthMethod: 'client_secret_basic',
        getIdentityAssertion: async () => ({
          assertion: 'enterprise-id-token',
          type: 'urn:ietf:params:oauth:token-type:id_token',
        }),
      },
    });

    const result = await helper.ensureAccessToken({
      requestedUrl: 'https://mcp.example/rpc',
      wwwAuthenticate: 'Bearer scope="files:read files:write"',
    });

    expect(result?.token).toMatchObject({
      accessToken: 'mcp-access-token',
      refreshToken: 'mcp-refresh-token',
      tokenType: 'DPoP',
    });
    expect(onAuthCode).not.toHaveBeenCalled();
    expect(
      endpointBodies.get('https://idp.example/token')?.toString()
    ).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange'
    );
    expect(
      endpointBodies.get('https://idp.example/token')?.get('subject_token')
    ).toBe('enterprise-id-token');
    expect(
      endpointBodies.get('https://idp.example/token')?.get('audience')
    ).toBe('https://mcp-auth.example');
    expect(
      endpointBodies.get('https://mcp-auth.example/token')?.get('grant_type')
    ).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(
      endpointBodies.get('https://mcp-auth.example/token')?.get('assertion')
    ).toBe('signed-id-jag');
    expect(
      endpointBodies.get('https://mcp-auth.example/token')?.getAll('resource')
    ).toEqual(['https://mcp.example', 'https://related-api.example']);
  });

  it('accepts an organization-managed ID-JAG provider', async () => {
    const getAuthorizationGrant = vi.fn(async () => 'managed-id-jag');
    let tokenBody = new URLSearchParams();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://mcp-auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            token_endpoint: 'https://mcp-auth.example/token',
          });
        }
        tokenBody = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: 'access-from-managed-jag' });
      })
    );
    const helper = new OAuthHelper({
      clientId: 'mcp-client',
      ssrfProtection: { disabled: true },
      enterpriseManagedAuthorization: { getAuthorizationGrant },
    });

    await helper.ensureAccessToken({
      requestedUrl: 'https://mcp.example/rpc',
      wwwAuthenticate: null,
    });

    expect(getAuthorizationGrant).toHaveBeenCalledWith({
      authorizationServerUrl: 'https://mcp-auth.example',
      resourceUrl: 'https://mcp.example',
      scope: undefined,
    });
    expect(tokenBody.get('assertion')).toBe('managed-id-jag');
  });

  it('uses one host mTLS fetch channel for discovery and certificate-bound tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('global fetch must not be used for mTLS');
      })
    );
    const mtlsFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('oauth-protected-resource')) {
          return Response.json({
            resource: 'https://mcp.example',
            authorization_servers: ['https://auth.example'],
          });
        }
        if (url.includes('oauth-authorization-server')) {
          return Response.json({
            token_endpoint: 'https://auth.example/token',
            tls_client_certificate_bound_access_tokens: true,
          });
        }
        expect(url).toBe('https://auth.example/token');
        expect(String(init?.body)).toContain('grant_type=client_credentials');
        return Response.json({ access_token: 'certificate-bound-token' });
      }
    );
    const helper = new OAuthHelper({
      grantType: 'client_credentials',
      clientId: 'machine-1',
      clientSecret: 'secret-1',
      ssrfProtection: { disabled: true },
      mtls: {
        fetch: mtlsFetch,
        requireCertificateBoundAccessTokens: true,
      },
    });

    await expect(
      helper.ensureAccessToken({
        requestedUrl: 'https://mcp.example/rpc',
        wwwAuthenticate: null,
      })
    ).resolves.toMatchObject({
      token: { accessToken: 'certificate-bound-token' },
    });
    expect(mtlsFetch).toHaveBeenCalledTimes(3);
  });
});
