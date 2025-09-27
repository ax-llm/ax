import { getCrypto, randomUUID } from '../../util/crypto.js';

/**
 * Converts a byte array to a base64url-encoded string.
 * Base64url encoding is like base64 but uses URL-safe characters and removes padding.
 * @param bytes - The byte array to encode
 * @returns The base64url-encoded string
 */
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

/**
 * Computes the SHA-256 hash of a string and returns it as a byte array.
 * @param input - The string to hash
 * @returns A promise that resolves to the SHA-256 hash as a Uint8Array
 */
export async function sha256Bytes(input: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await getCrypto().subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

/**
 * Generates a new PKCE code verifier string.
 * Creates a cryptographically secure random string by combining a UUID with additional randomness,
 * then hashing and encoding the result.
 * @returns A promise that resolves to a base64url-encoded code verifier
 */
export async function newCodeVerifier(): Promise<string> {
  // random seed via UUID + random; then SHA-256 and base64url
  return base64url(
    await sha256Bytes(randomUUID() + Math.random().toString(36))
  );
}

/**
 * Generates a PKCE code challenge from a code verifier.
 * The challenge is the SHA-256 hash of the verifier, base64url-encoded.
 * @param verifier - The code verifier string
 * @returns A promise that resolves to the corresponding code challenge
 */
export async function newCodeChallenge(verifier: string): Promise<string> {
  return base64url(await sha256Bytes(verifier));
}
