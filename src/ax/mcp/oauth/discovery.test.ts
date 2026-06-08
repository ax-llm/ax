import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverResourceAndAS,
  parseWWWAuthenticateForResourceMetadata,
} from './discovery.js';

describe('MCP OAuth discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses resource_metadata from WWW-Authenticate', () => {
    expect(
      parseWWWAuthenticateForResourceMetadata(
        'Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", error="invalid_token"'
      )
    ).toBe('https://mcp.linear.app/.well-known/oauth-protected-resource/mcp');
  });

  it('accepts Linear-style canonical root resources for endpoint metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            resource: 'https://mcp.linear.app',
            authorization_servers: ['https://mcp.linear.app'],
            bearer_methods_supported: ['header'],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );

    await expect(
      discoverResourceAndAS(
        'https://mcp.linear.app/mcp',
        'Bearer resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp"'
      )
    ).resolves.toEqual({
      resource: 'https://mcp.linear.app',
      issuers: ['https://mcp.linear.app'],
    });
  });

  it('rejects protected-resource metadata from another origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            resource: 'https://evil.example',
            authorization_servers: ['https://evil.example'],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );

    await expect(
      discoverResourceAndAS(
        'https://mcp.linear.app/mcp',
        'Bearer resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp"'
      )
    ).rejects.toThrow(/does not cover requested URL/);
  });

  it('blocks protected-resource metadata URLs that target localhost', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      discoverResourceAndAS(
        'https://mcp.linear.app/mcp',
        'Bearer resource_metadata="https://localhost/.well-known/oauth-protected-resource/mcp"'
      )
    ).rejects.toThrow(/Blocked loopback MCP URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
