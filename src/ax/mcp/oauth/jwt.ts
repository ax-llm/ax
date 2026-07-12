import { getCrypto } from '../../util/crypto.js';
import { fetchWithSSRFProtection } from '../util/ssrf.js';
import type { AxMCPOAuthJWTValidationOptions } from './types.js';

export interface AxMCPVerifiedJWT {
  header: Readonly<Record<string, unknown>>;
  claims: Readonly<Record<string, unknown>>;
}

type JWTAlgorithm =
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA';

type JWK = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
};

const DEFAULT_ALGORITHMS: readonly JWTAlgorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJSON(value: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(decodeBase64Url(value))
    ) as Record<string, unknown>;
  } catch {
    throw new Error(`OAuth JWT has an invalid ${label}`);
  }
}

function algorithmParameters(algorithm: JWTAlgorithm): {
  importAlgorithm:
    | AlgorithmIdentifier
    | RsaHashedImportParams
    | EcKeyImportParams;
  verifyAlgorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
} {
  const bits = algorithm.endsWith('256')
    ? 'SHA-256'
    : algorithm.endsWith('384')
      ? 'SHA-384'
      : 'SHA-512';
  if (algorithm.startsWith('RS')) {
    return {
      importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: bits },
      verifyAlgorithm: { name: 'RSASSA-PKCS1-v1_5' },
    };
  }
  if (algorithm.startsWith('PS')) {
    return {
      importAlgorithm: { name: 'RSA-PSS', hash: bits },
      verifyAlgorithm: {
        name: 'RSA-PSS',
        saltLength: Number.parseInt(algorithm.slice(2), 10) / 8,
      },
    };
  }
  if (algorithm.startsWith('ES')) {
    const namedCurve =
      algorithm === 'ES256'
        ? 'P-256'
        : algorithm === 'ES384'
          ? 'P-384'
          : 'P-521';
    return {
      importAlgorithm: { name: 'ECDSA', namedCurve },
      verifyAlgorithm: { name: 'ECDSA', hash: bits },
    };
  }
  return {
    importAlgorithm: { name: 'Ed25519' },
    verifyAlgorithm: { name: 'Ed25519' },
  };
}

function asAudience(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return [];
}

/** Browser-compatible OAuth/OIDC JWT verifier backed by Web Crypto and JWKS. */
export class AxMCPOAuthJWTVerifier {
  private readonly jwksCache = new Map<string, readonly JWK[]>();

  constructor(
    private readonly options: Readonly<AxMCPOAuthJWTValidationOptions> = {}
  ) {}

  async verify(
    token: string,
    expected: Readonly<{
      issuer: string;
      audience: string | readonly string[];
      nonce?: string;
      jwksUri: string;
    }>
  ): Promise<AxMCPVerifiedJWT> {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error('OAuth JWT must contain three encoded segments');
    }
    const header = decodeJSON(parts[0], 'header');
    const claims = decodeJSON(parts[1], 'claims');
    const algorithm = header.alg;
    if (
      typeof algorithm !== 'string' ||
      !(this.options.allowedAlgorithms ?? DEFAULT_ALGORITHMS).includes(
        algorithm
      )
    ) {
      throw new Error(
        `OAuth JWT uses disallowed algorithm ${String(algorithm)}`
      );
    }
    const jwks = await this.getJWKS(expected.jwksUri);
    const candidates = jwks.filter(
      (jwk) =>
        (!header.kid || jwk.kid === header.kid) &&
        (!jwk.alg || jwk.alg === algorithm) &&
        (!jwk.use || jwk.use === 'sig')
    );
    if (candidates.length === 0) {
      throw new Error(
        `OAuth JWT signing key ${String(header.kid ?? '<none>')} not found`
      );
    }
    const parameters = algorithmParameters(algorithm as JWTAlgorithm);
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = decodeBase64Url(parts[2]);
    let verified = false;
    for (const jwk of candidates) {
      try {
        const key = await getCrypto().subtle.importKey(
          'jwk',
          jwk,
          parameters.importAlgorithm,
          false,
          ['verify']
        );
        if (
          await getCrypto().subtle.verify(
            parameters.verifyAlgorithm,
            key,
            signature,
            signingInput
          )
        ) {
          verified = true;
          break;
        }
      } catch {
        // A JWKS can contain mixed key families; try the next eligible key.
      }
    }
    if (!verified) throw new Error('OAuth JWT signature verification failed');
    this.validateClaims(claims, expected);
    return { header, claims };
  }

  clearJWKSCache(jwksUri?: string): void {
    if (jwksUri) this.jwksCache.delete(jwksUri);
    else this.jwksCache.clear();
  }

  private async getJWKS(uri: string): Promise<readonly JWK[]> {
    const cached = this.jwksCache.get(uri);
    if (cached) return cached;
    const response = await fetchWithSSRFProtection(uri, {
      headers: { Accept: 'application/json' },
      ssrfProtection: this.options.ssrfProtection,
      ssrfContext: 'oauth-authorization-server-metadata',
      fetch: this.options.fetch,
    });
    if (!response.ok) {
      throw new Error(
        `OAuth JWKS request failed: ${response.status} ${response.statusText}`
      );
    }
    const value = (await response.json()) as { keys?: JWK[] };
    if (!Array.isArray(value.keys) || value.keys.length === 0) {
      throw new Error('OAuth JWKS response contains no keys');
    }
    this.jwksCache.set(uri, value.keys);
    return value.keys;
  }

  private validateClaims(
    claims: Readonly<Record<string, unknown>>,
    expected: Readonly<{
      issuer: string;
      audience: string | readonly string[];
      nonce?: string;
    }>
  ): void {
    const now = Math.floor((this.options.now?.() ?? Date.now()) / 1000);
    const tolerance = this.options.clockToleranceSeconds ?? 60;
    if (claims.iss !== expected.issuer)
      throw new Error('OAuth JWT issuer mismatch');
    const actualAudience = asAudience(claims.aud);
    const expectedAudience =
      typeof expected.audience === 'string'
        ? [expected.audience]
        : expected.audience;
    if (
      !expectedAudience.some((audience) => actualAudience.includes(audience))
    ) {
      throw new Error('OAuth JWT audience mismatch');
    }
    if (actualAudience.length > 1 && typeof claims.azp !== 'string') {
      throw new Error('OAuth ID token with multiple audiences is missing azp');
    }
    if (
      actualAudience.length > 1 &&
      !expectedAudience.includes(claims.azp as string)
    ) {
      throw new Error('OAuth JWT authorized-party mismatch');
    }
    if (typeof claims.exp !== 'number' || now > claims.exp + tolerance) {
      throw new Error('OAuth JWT is expired or missing exp');
    }
    if (typeof claims.iat !== 'number' || claims.iat > now + tolerance) {
      throw new Error('OAuth JWT has an invalid or missing iat');
    }
    if (typeof claims.nbf === 'number' && claims.nbf > now + tolerance) {
      throw new Error('OAuth JWT is not active yet');
    }
    if (expected.nonce !== undefined && claims.nonce !== expected.nonce) {
      throw new Error('OAuth ID token nonce mismatch');
    }
  }
}
