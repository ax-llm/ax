import { describe, expect, it } from 'vitest';
import { AxMCPDPoPProofFactory } from './dpop.js';

function decodePart(jwt: string, index: number): Record<string, unknown> {
  const part = jwt.split('.')[index]!;
  const base64 = part.replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(atob(base64));
}

describe('AxMCPDPoPProofFactory', () => {
  it('creates unique RFC 9449 proofs bound to method, URI, token, and nonce', async () => {
    let sequence = 0;
    const factory = new AxMCPDPoPProofFactory({
      now: () => 1_700_000_000_000,
      jti: () => `proof-${++sequence}`,
    });
    const first = await factory.createProof({
      url: 'https://mcp.example/tools?ignored=yes#fragment',
      method: 'post',
      accessToken: 'access-token',
      nonce: 'server-nonce',
    });
    const second = await factory.createProof({
      url: 'https://mcp.example/tools',
      method: 'POST',
      accessToken: 'access-token',
    });

    expect(first).not.toBe(second);
    expect(decodePart(first, 0)).toMatchObject({
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: { kty: 'EC', crv: 'P-256' },
    });
    expect(decodePart(first, 1)).toMatchObject({
      jti: 'proof-1',
      htm: 'POST',
      htu: 'https://mcp.example/tools',
      iat: 1_700_000_000,
      nonce: 'server-nonce',
    });
    expect(decodePart(first, 1).ath).toEqual(expect.any(String));
    expect(decodePart(first, 0).jwk).not.toHaveProperty('d');
  });
});
