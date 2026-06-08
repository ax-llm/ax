import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertSSRFProtectedURL, fetchWithSSRFProtection } from './ssrf.js';

describe('MCP SSRF protection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows public HTTPS URLs', async () => {
    await expect(
      assertSSRFProtectedURL('https://mcp.example/.well-known/oauth', {
        context: 'oauth-resource-metadata',
      })
    ).resolves.toBeInstanceOf(URL);
  });

  it('blocks plain HTTP by default', async () => {
    await expect(
      assertSSRFProtectedURL('http://mcp.example/.well-known/oauth', {
        context: 'oauth-resource-metadata',
      })
    ).rejects.toThrow(/expected https URL/);
  });

  it('blocks loopback and private literal hosts by default', async () => {
    await expect(
      assertSSRFProtectedURL('https://localhost/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked loopback/);
    await expect(
      assertSSRFProtectedURL('https://10.0.0.1/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    await expect(
      assertSSRFProtectedURL('https://10.1/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    await expect(
      assertSSRFProtectedURL('https://0300.0250.0001.0001/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    await expect(
      assertSSRFProtectedURL('https://0x7f000001/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked loopback/);
    await expect(
      assertSSRFProtectedURL('https://0177.0.0.1/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked loopback/);
    await expect(
      assertSSRFProtectedURL('https://169.254.169.254/latest/meta-data', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    await expect(
      assertSSRFProtectedURL('https://[fe80::1]/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    await expect(
      assertSSRFProtectedURL('https://[::]/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
    await expect(
      assertSSRFProtectedURL('https://[::ffff:127.0.0.1]/token', {
        context: 'oauth-token',
      })
    ).rejects.toThrow(/Blocked loopback/);
  });

  it('allows explicit development exceptions', async () => {
    await expect(
      assertSSRFProtectedURL('http://localhost:8787/callback', {
        context: 'oauth-resource-metadata',
        ssrfProtection: { allowHTTP: true, allowLoopback: true },
      })
    ).resolves.toBeInstanceOf(URL);
  });

  it('validates redirect targets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://169.254.169.254/latest/meta-data' },
        })
      )
    );

    await expect(
      fetchWithSSRFProtection('https://mcp.example/.well-known/oauth', {
        ssrfContext: 'oauth-resource-metadata',
      })
    ).rejects.toThrow(/Blocked private or reserved/);
  });
});
