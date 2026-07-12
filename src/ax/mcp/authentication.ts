import { getCrypto, randomUUID, sha256 } from '../util/crypto.js';

export interface AxMCPAuthenticationRequest {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
}

export interface AxMCPAuthenticationResult {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface AxMCPAuthenticationStrategy {
  authenticate(
    request: Readonly<AxMCPAuthenticationRequest>
  ):
    | AxMCPAuthenticationResult
    | Promise<AxMCPAuthenticationResult | undefined>
    | undefined;
}

export type AxMCPAuthentication =
  | AxMCPAuthenticationStrategy
  | readonly AxMCPAuthenticationStrategy[];

type SecretProvider = string | (() => string | Promise<string>);

async function resolveSecret(provider: SecretProvider): Promise<string> {
  return typeof provider === 'function' ? provider() : provider;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function axMCPBearerAuthentication(
  token: SecretProvider,
  tokenType = 'Bearer'
): AxMCPAuthenticationStrategy {
  return {
    authenticate: async () => ({
      headers: { Authorization: `${tokenType} ${await resolveSecret(token)}` },
    }),
  };
}

export function axMCPBasicAuthentication(
  username: SecretProvider,
  password: SecretProvider
): AxMCPAuthenticationStrategy {
  return {
    authenticate: async () => ({
      headers: {
        Authorization: `Basic ${encodeBase64(`${await resolveSecret(username)}:${await resolveSecret(password)}`)}`,
      },
    }),
  };
}

export function axMCPAPIKeyAuthentication(options: {
  key: SecretProvider;
  name?: string;
  in?: 'header' | 'query';
  prefix?: string;
}): AxMCPAuthenticationStrategy {
  return {
    authenticate: async () => {
      const value = `${options.prefix ?? ''}${await resolveSecret(options.key)}`;
      const name = options.name ?? 'X-API-Key';
      return options.in === 'query'
        ? { query: { [name]: value } }
        : { headers: { [name]: value } };
    },
  };
}

export function axMCPHMACAuthentication(options: {
  keyId: string;
  secret: SecretProvider;
  signatureHeader?: string;
  timestampHeader?: string;
  nonceHeader?: string;
  now?: () => number;
  nonce?: () => string;
}): AxMCPAuthenticationStrategy {
  return {
    authenticate: async (request) => {
      const timestamp = String(options.now?.() ?? Date.now());
      const nonce = options.nonce?.() ?? randomUUID();
      const url = new URL(request.url);
      const bodyDigest = await sha256(request.body ?? '');
      const canonical = [
        request.method.toUpperCase(),
        `${url.pathname}${url.search}`,
        bodyDigest,
        timestamp,
        nonce,
      ].join('\n');
      const key = await getCrypto().subtle.importKey(
        'raw',
        new TextEncoder().encode(await resolveSecret(options.secret)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signature = bytesToHex(
        await getCrypto().subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(canonical)
        )
      );
      return {
        headers: {
          [options.signatureHeader ?? 'X-Signature']:
            `keyId=${options.keyId},algorithm=hmac-sha256,signature=${signature}`,
          [options.timestampHeader ?? 'X-Timestamp']: timestamp,
          [options.nonceHeader ?? 'X-Nonce']: nonce,
        },
      };
    },
  };
}

export async function axApplyMCPAuthentication(
  url: string,
  init: Readonly<RequestInit>,
  authentication?: AxMCPAuthentication
): Promise<{ url: string; init: RequestInit }> {
  if (!authentication) return { url, init: { ...init } };
  const strategies = Array.isArray(authentication)
    ? authentication
    : [authentication];
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const target = new URL(url);
  for (const strategy of strategies) {
    const result = await strategy.authenticate({
      url: target.toString(),
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    Object.assign(headers, result?.headers);
    for (const [name, value] of Object.entries(result?.query ?? {}) as Array<
      [string, string]
    >) {
      target.searchParams.set(name, value);
    }
  }
  return { url: target.toString(), init: { ...init, headers } };
}
