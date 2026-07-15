import { afterEach, describe, expect, it, vi } from 'vitest';

import { AxUCPClient } from './client.js';
import { AX_UCP_VERSION } from './types.js';

function profile(transport: 'mcp' | 'rest' = 'mcp') {
  return {
    ucp: {
      version: AX_UCP_VERSION,
      services: {
        'dev.ucp.shopping': [
          {
            version: AX_UCP_VERSION,
            transport,
            endpoint:
              transport === 'mcp'
                ? 'https://shop.example/ucp/mcp'
                : 'https://shop.example/ucp',
          },
        ],
      },
      capabilities: {
        'dev.ucp.shopping.catalog.search': [{ version: AX_UCP_VERSION }],
        'dev.ucp.shopping.checkout': [{ version: AX_UCP_VERSION }],
        'dev.ucp.shopping.discount': [
          {
            version: AX_UCP_VERSION,
            extends: 'dev.ucp.shopping.checkout',
          },
        ],
      },
    },
    signing_keys: [{ kid: 'business-key', kty: 'EC' }],
  };
}

describe('AxUCPClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('discovers UCP and performs direct MCP catalog calls with agent metadata', async () => {
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        if (!init?.method) {
          return new Response(JSON.stringify(profile()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const request = JSON.parse(String(init.body));
        requests.push(request);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                ucp: {
                  version: AX_UCP_VERSION,
                  capabilities: {
                    'dev.ucp.shopping.catalog.search': [
                      { version: AX_UCP_VERSION },
                    ],
                  },
                },
                products: [{ id: 'p1', title: 'Blue shoe' }],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    const client = new AxUCPClient({
      profileUrl: 'https://shop.example',
      agentProfile: 'https://agent.example/.well-known/ucp',
      skipMCPInitialization: true,
    });

    const result = await client.searchCatalog({ query: 'blue shoes' });

    expect(result.products).toEqual([{ id: 'p1', title: 'Blue shoe' }]);
    expect(requests[0]).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'search_catalog',
        arguments: {
          meta: {
            'ucp-agent': {
              profile: 'https://agent.example/.well-known/ucp',
            },
          },
          catalog: { query: 'blue shoes' },
        },
      },
    });
  });

  it('negotiates platform capabilities and prunes orphan extensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(profile('rest')), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    const client = new AxUCPClient({
      profileUrl: 'https://shop.example/.well-known/ucp',
      agentProfile: 'https://agent.example/.well-known/ucp',
      transport: 'rest',
      platformCapabilities: {
        'dev.ucp.shopping.catalog.search': [{ version: AX_UCP_VERSION }],
        'dev.ucp.shopping.discount': [{ version: AX_UCP_VERSION }],
      },
    });
    await client.init();

    expect(client.getProfile().capabilities).toEqual({
      'dev.ucp.shopping.catalog.search': [{ version: AX_UCP_VERSION }],
    });
  });

  it('requires idempotency keys for completing or cancelling checkout', () => {
    const client = new AxUCPClient({
      profileUrl: 'https://shop.example',
      agentProfile: 'https://agent.example/.well-known/ucp',
    });
    expect(() => client.completeCheckout('c1', {})).toThrow(
      'requires an idempotencyKey'
    );
    expect(() => client.cancelCheckout('c1', {})).toThrow(
      'requires an idempotencyKey'
    );
  });

  it('maps UCP REST operations to their normative methods, paths, and headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (!init?.method) return Response.json(profile('rest'));
        return Response.json({
          ucp: { version: AX_UCP_VERSION, status: 'success' },
          id: 'result-1',
        });
      })
    );
    const client = new AxUCPClient({
      profileUrl: 'https://shop.example',
      agentProfile: 'https://agent.example/.well-known/ucp',
      transport: 'rest',
      mcp: { ssrfProtection: { disabled: true } },
    });

    await client.createCheckout({ line_items: [] });
    await client.getOrder('order/1');

    expect(calls[1]).toMatchObject({
      url: 'https://shop.example/ucp/checkout-sessions',
      init: { method: 'POST', body: JSON.stringify({ line_items: [] }) },
    });
    expect(new Headers(calls[1]?.init?.headers).get('UCP-Agent')).toBe(
      'profile="https://agent.example/.well-known/ucp"'
    );
    expect(new Headers(calls[1]?.init?.headers).get('Request-Id')).toBeTruthy();
    expect(calls[2]).toMatchObject({
      url: 'https://shop.example/ucp/orders/order%2F1',
      init: { method: 'GET' },
    });
    expect(calls[2]?.init?.body).toBeUndefined();
  });
});
