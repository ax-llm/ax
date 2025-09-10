import { getCrypto, randomUUID } from '../../util/crypto.js';

export function base64url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  // @ts-ignore - btoa may or may not exist depending on environment
  const b64: string = typeof btoa === 'function' ? btoa(binary) : '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await getCrypto().subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export async function newCodeVerifier(): Promise<string> {
  // random seed via UUID + random; then SHA-256 and base64url
  return base64url(
    await sha256Bytes(randomUUID() + Math.random().toString(36))
  );
}

export async function newCodeChallenge(verifier: string): Promise<string> {
  return base64url(await sha256Bytes(verifier));
}
