import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCrypto } from '../../util/crypto.js';
import { AxMCPOAuthJWTVerifier } from './jwt.js';

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

describe('MCP OAuth JWT verifier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies the signature, issuer, audience, nonce, and lifetime', async () => {
    const pair = (await getCrypto().subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const publicJwk = await getCrypto().subtle.exportKey('jwk', pair.publicKey);
    const now = 1_800_000_000;
    const header = encode({ alg: 'ES256', kid: 'key-1', typ: 'JWT' });
    const payload = encode({
      iss: 'https://auth.example',
      aud: 'client-1',
      exp: now + 300,
      iat: now,
      nonce: 'nonce-1',
      sub: 'user-1',
    });
    const signingInput = `${header}.${payload}`;
    const signature = await getCrypto().subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      new TextEncoder().encode(signingInput)
    );
    const token = `${signingInput}.${encodeBytes(new Uint8Array(signature))}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ keys: [{ ...publicJwk, kid: 'key-1', alg: 'ES256' }] })
      )
    );
    const verifier = new AxMCPOAuthJWTVerifier({
      now: () => now * 1000,
      ssrfProtection: { disabled: true },
    });

    await expect(
      verifier.verify(token, {
        issuer: 'https://auth.example',
        audience: 'client-1',
        nonce: 'nonce-1',
        jwksUri: 'https://auth.example/jwks',
      })
    ).resolves.toMatchObject({ claims: { sub: 'user-1' } });
    await expect(
      verifier.verify(token, {
        issuer: 'https://auth.example',
        audience: 'client-1',
        nonce: 'wrong-nonce',
        jwksUri: 'https://auth.example/jwks',
      })
    ).rejects.toThrow('nonce mismatch');
  });

  it('rejects unsigned, disallowed, and expired tokens', async () => {
    const verifier = new AxMCPOAuthJWTVerifier({
      now: () => 1_800_000_000_000,
      ssrfProtection: { disabled: true },
    });
    const token = `${encode({ alg: 'none' })}.${encode({
      iss: 'https://auth.example',
      aud: 'client-1',
      exp: 1_700_000_000,
      iat: 1_600_000_000,
    })}.unsigned`;
    await expect(
      verifier.verify(token, {
        issuer: 'https://auth.example',
        audience: 'client-1',
        jwksUri: 'https://auth.example/jwks',
      })
    ).rejects.toThrow('disallowed algorithm none');
  });
});
