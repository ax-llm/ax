/**
 * Cross-platform crypto utilities that work in both Node.js and browser environments
 * using Web Crypto API standards
 */

// Web Crypto API is available in both modern Node.js (16+) and browsers via globalThis.crypto
const webCrypto = (() => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto;
  }

  throw new Error(
    'Web Crypto API with randomUUID support not available. Requires Node.js 16+ or modern browser.'
  );
})();

/**
 * Generate a random UUID using Web Crypto API
 * @returns A random UUID string
 */
export function randomUUID(): string {
  return webCrypto.randomUUID();
}

/**
 * Create a SHA-256 hash of the input data
 * @param data - The data to hash (string or ArrayBuffer)
 * @returns A promise that resolves to the hex-encoded hash
 */
export async function sha256(data: string | ArrayBuffer): Promise<string> {
  const encoder = new TextEncoder();
  const inputData = typeof data === 'string' ? encoder.encode(data) : data;

  const hashBuffer = await webCrypto.subtle.digest('SHA-256', inputData);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
}

/**
 * Create a hash instance that can be updated incrementally (similar to Node.js createHash)
 * Note: This is a synchronous wrapper around async Web Crypto API - uses simplified hash for compatibility
 */
export class Hash {
  private data = '';

  update(chunk: string): this {
    this.data += chunk;
    return this;
  }

  digest(encoding: 'hex'): string {
    if (encoding !== 'hex') {
      throw new Error('Only hex encoding is supported');
    }

    // For browser compatibility, we use a simple hash function
    // This maintains API compatibility but is not cryptographically secure
    const encoder = new TextEncoder();
    const inputData = encoder.encode(this.data);

    let hash = 0;
    for (let i = 0; i < inputData.length; i++) {
      const char = inputData[i]!;
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to hex string
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  async digestAsync(): Promise<string> {
    return sha256(this.data);
  }
}

/**
 * Create a hash instance (compatibility function)
 * @param algorithm - The hash algorithm (only 'sha256' supported)
 * @returns A Hash instance
 */
export function createHash(algorithm: string): Hash {
  if (algorithm !== 'sha256') {
    throw new Error('Only SHA-256 algorithm is supported');
  }
  return new Hash();
}

/**
 * Get the crypto object for use in JavaScript interpreter contexts
 * @returns The Web Crypto API object
 */
export function getCrypto() {
  return webCrypto;
}
