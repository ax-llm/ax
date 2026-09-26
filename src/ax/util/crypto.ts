/**
 * Cross-platform crypto utilities that work in both Node.js and browser environments
 * using Web Crypto API standards
 */

function getWebCrypto(): Crypto {
  if (globalThis.crypto) {
    return globalThis.crypto;
  }

  throw new Error(
    'Web Crypto API not available. Requires modern Node.js, Deno, or a modern browser.'
  );
}

function getRandomUUIDCrypto(): Crypto & { randomUUID: () => string } {
  const crypto = getWebCrypto();

  if (typeof crypto.randomUUID === 'function') {
    return crypto as Crypto & { randomUUID: () => string };
  }

  throw new Error(
    'Web Crypto API randomUUID support not available. Requires modern Node.js, Deno, or a modern browser.'
  );
}

function getSubtleCrypto(): Crypto & { subtle: SubtleCrypto } {
  const crypto = getWebCrypto();

  if (crypto.subtle) {
    return crypto as Crypto & { subtle: SubtleCrypto };
  }

  throw new Error(
    'Web Crypto API subtle.digest support not available. Requires modern Node.js, Deno, or a modern browser.'
  );
}

/**
 * Generate a random UUID using Web Crypto API
 * @returns A random UUID string
 */
export function randomUUID(): string {
  return getRandomUUIDCrypto().randomUUID();
}

/**
 * Create a SHA-256 hash of the input data
 * @param data - The data to hash (string or ArrayBuffer)
 * @returns A promise that resolves to the hex-encoded hash
 */
export async function sha256(data: string | ArrayBuffer): Promise<string> {
  const encoder = new TextEncoder();
  const inputData = typeof data === 'string' ? encoder.encode(data) : data;

  const hashBuffer = await getSubtleCrypto().subtle.digest(
    'SHA-256',
    inputData
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex;
}

// SHA-256 round constants (FIPS 180-4, section 4.2.2).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/**
 * Synchronous SHA-256 (FIPS 180-4) of the given bytes, as lowercase hex.
 * Pure JavaScript, so it runs wherever Ax runs, without Web Crypto's async API.
 */
function sha256HexSync(message: Uint8Array): string {
  // Pad to a multiple of 64 bytes: 0x80, zeros, then the bit length as a
  // 64-bit big-endian integer.
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = words[i - 15]!;
      const w2 = words[i - 2]!;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[i] = words[i - 16]! + s0 + words[i - 7]! + s1;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + SHA256_K[i]! + words[i]!) | 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    hash[0] = hash[0]! + a;
    hash[1] = hash[1]! + b;
    hash[2] = hash[2]! + c;
    hash[3] = hash[3]! + d;
    hash[4] = hash[4]! + e;
    hash[5] = hash[5]! + f;
    hash[6] = hash[6]! + g;
    hash[7] = hash[7]! + h;
  }

  let hex = '';
  for (const word of hash) {
    hex += word.toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * Create a hash instance that can be updated incrementally (similar to Node.js
 * createHash). `digest('hex')` is the SHA-256 of the UTF-8 encoded updates,
 * computed synchronously in pure JavaScript.
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
    return sha256HexSync(new TextEncoder().encode(this.data));
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
export function getCrypto(): Crypto {
  return getWebCrypto();
}
