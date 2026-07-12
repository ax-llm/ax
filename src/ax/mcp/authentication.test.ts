import { describe, expect, it } from 'vitest';
import {
  axApplyMCPAuthentication,
  axMCPAPIKeyAuthentication,
  axMCPBasicAuthentication,
  axMCPHMACAuthentication,
} from './authentication.js';

describe('MCP authentication strategies', () => {
  it('composes Basic authentication with query API keys', async () => {
    const authenticated = await axApplyMCPAuthentication(
      'https://mcp.example/rpc',
      { method: 'POST', headers: { Accept: 'application/json' } },
      [
        axMCPBasicAuthentication('client', 'secret'),
        axMCPAPIKeyAuthentication({
          key: 'key-1',
          name: 'api_key',
          in: 'query',
        }),
      ]
    );

    expect(new URL(authenticated.url).searchParams.get('api_key')).toBe(
      'key-1'
    );
    expect(new Headers(authenticated.init.headers).get('Authorization')).toBe(
      'Basic Y2xpZW50OnNlY3JldA=='
    );
  });

  it('produces deterministic HMAC request signatures', async () => {
    const authenticated = await axApplyMCPAuthentication(
      'https://mcp.example/rpc?version=1',
      { method: 'POST', body: '{"ok":true}' },
      axMCPHMACAuthentication({
        keyId: 'client-1',
        secret: 'shared-secret',
        now: () => 1234,
        nonce: () => 'nonce-1',
      })
    );
    const headers = new Headers(authenticated.init.headers);

    expect(headers.get('X-Timestamp')).toBe('1234');
    expect(headers.get('X-Nonce')).toBe('nonce-1');
    expect(headers.get('X-Signature')).toMatch(
      /^keyId=client-1,algorithm=hmac-sha256,signature=[a-f0-9]{64}$/
    );
  });
});
