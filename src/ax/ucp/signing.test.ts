import { describe, expect, it } from 'vitest';
import { getCrypto } from '../util/crypto.js';
import { AxUCPHTTPMessageVerifier, axSignUCPRequest } from './signing.js';

describe('UCP HTTP message signatures', () => {
  it('constructs RFC 9421 signature and content-digest headers', async () => {
    let signatureBase = '';
    const headers = await axSignUCPRequest(
      {
        url: 'https://shop.example/ucp/checkout-sessions',
        method: 'POST',
        headers: {
          'UCP-Agent': 'profile="https://agent.example/.well-known/ucp"',
          'Request-Id': 'request-1',
        },
        body: '{"line_items":[]}',
      },
      {
        keyId: 'platform-2026',
        algorithm: 'ecdsa-p256-sha256',
        created: () => 1_706_800_000,
        sign: (value) => {
          signatureBase = new TextDecoder().decode(value);
          return new Uint8Array([1, 2, 3]);
        },
      }
    );

    expect(new Headers(headers).get('Content-Digest')).toMatch(
      /^sha-256=:[A-Za-z0-9+/]+=*:/
    );
    expect(headers['Signature-Input']).toContain('keyid="platform-2026"');
    expect(headers.Signature).toBe('sig1=:AQID:');
    expect(signatureBase).toContain('"@method": POST');
    expect(signatureBase).toContain('"content-digest": sha-256=:');
  });

  it('verifies signed responses, raw body digests, key rotation, and replay', async () => {
    const pair = (await getCrypto().subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair;
    const publicJwk = await getCrypto().subtle.exportKey('jwk', pair.publicKey);
    const body = '{"ucp":{"version":"2026-04-08"}}';
    const digest = await getCrypto().subtle.digest(
      'SHA-256',
      new TextEncoder().encode(body)
    );
    let binary = '';
    for (const byte of new Uint8Array(digest)) {
      binary += String.fromCharCode(byte);
    }
    const contentDigest = `sha-256=:${btoa(binary)}:`;
    const parameters =
      '("@status" "content-digest" "content-type");created=1800000000;keyid="rotated-key";alg="ES256";nonce="response-1"';
    const signatureBase = [
      '"@status": 200',
      `"content-digest": ${contentDigest}`,
      '"content-type": application/json',
      `"@signature-params": ${parameters}`,
    ].join('\n');
    const signed = await getCrypto().subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      new TextEncoder().encode(signatureBase)
    );
    binary = '';
    for (const byte of new Uint8Array(signed))
      binary += String.fromCharCode(byte);
    const response = () =>
      new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Digest': contentDigest,
          'Signature-Input': `sig1=${parameters}`,
          Signature: `sig1=:${btoa(binary)}:`,
        },
      });
    const refreshSigningKeys = async () => [
      { ...publicJwk, kid: 'rotated-key', alg: 'ES256' },
    ];
    const verifier = new AxUCPHTTPMessageVerifier({
      required: true,
      replayProtection: true,
      maxAgeSeconds: 300,
      now: () => 1_800_000_100_000,
    });

    await expect(
      verifier.verify(response(), {
        body,
        signingKeys: [],
        refreshSigningKeys,
      })
    ).resolves.toBeUndefined();
    await expect(
      verifier.verify(response(), {
        body,
        signingKeys: await refreshSigningKeys(),
      })
    ).rejects.toMatchObject({ code: 'signature_replayed' });
    await expect(
      new AxUCPHTTPMessageVerifier({
        required: true,
        now: () => 1_800_000_100_000,
      }).verify(response(), {
        body: `${body} `,
        signingKeys: await refreshSigningKeys(),
      })
    ).rejects.toMatchObject({ code: 'digest_mismatch' });
  });
});
