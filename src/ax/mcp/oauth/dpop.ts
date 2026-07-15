import { getCrypto, randomUUID } from '../../util/crypto.js';

export interface AxMCPDPoPProofRequest {
  url: string;
  method: string;
  accessToken?: string;
  nonce?: string;
}

export interface AxMCPDPoPOptions {
  privateKey?: CryptoKey;
  publicJwk?: JsonWebKey;
  createProof?: (
    request: Readonly<AxMCPDPoPProofRequest>
  ) => string | Promise<string>;
  now?: () => number;
  jti?: () => string;
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function encodeJSON(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function accessTokenHash(accessToken: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await getCrypto().subtle.digest(
        'SHA-256',
        new TextEncoder().encode(accessToken)
      )
    )
  );
}

export class AxMCPDPoPProofFactory {
  private keyPair?: Promise<{
    privateKey: CryptoKey;
    publicJwk: JsonWebKey;
  }>;

  constructor(private readonly options: Readonly<AxMCPDPoPOptions> = {}) {}

  async createProof(request: Readonly<AxMCPDPoPProofRequest>): Promise<string> {
    if (this.options.createProof) return this.options.createProof(request);
    const keys = await this.getKeys();
    const url = new URL(request.url);
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: keys.publicJwk };
    const payload: Record<string, unknown> = {
      jti: this.options.jti?.() ?? randomUUID(),
      htm: request.method.toUpperCase(),
      htu: `${url.origin}${url.pathname}`,
      iat: Math.floor((this.options.now?.() ?? Date.now()) / 1000),
      ...(request.nonce ? { nonce: request.nonce } : {}),
      ...(request.accessToken
        ? { ath: await accessTokenHash(request.accessToken) }
        : {}),
    };
    const signingInput = `${encodeJSON(header)}.${encodeJSON(payload)}`;
    const signature = await getCrypto().subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  }

  private async getKeys(): Promise<{
    privateKey: CryptoKey;
    publicJwk: JsonWebKey;
  }> {
    if (this.options.privateKey && this.options.publicJwk) {
      return {
        privateKey: this.options.privateKey,
        publicJwk: this.publicOnlyJwk(this.options.publicJwk),
      };
    }
    this.keyPair ??= (async () => {
      const pair = (await getCrypto().subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair;
      return {
        privateKey: pair.privateKey,
        publicJwk: this.publicOnlyJwk(
          await getCrypto().subtle.exportKey('jwk', pair.publicKey)
        ),
      };
    })();
    return this.keyPair;
  }

  private publicOnlyJwk(jwk: Readonly<JsonWebKey>): JsonWebKey {
    const { d: _private, key_ops: _operations, ...publicJwk } = jwk;
    return publicJwk;
  }
}
