import crypto from 'crypto';

export const uuidDNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const uuidURL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export function uuidv5(name: string, namespace: string): string {
  if (!isUUIDFormat(namespace)) {
    throw new Error('Invalid namespace UUID format');
  }

  // Convert namespace UUID to binary buffer.
  const namespaceBuffer = Buffer.from(namespace, 'hex');

  // Generate SHA1 hash based on namespace and input name.
  const hash = crypto.createHash('sha1');
  hash.update(namespaceBuffer);
  hash.update(name);

  // Extract first 16 bytes from hash to form UUID binary buffer.
  const uuidBuffer = Buffer.alloc(16);
  hash.digest().copy(uuidBuffer, 0, 0, 16);

  // Set version and variant fields in UUID binary buffer.
  uuidBuffer[6] = (uuidBuffer[6] & 0x0f) | 0x50; // version
  uuidBuffer[8] = (uuidBuffer[8] & 0x3f) | 0x80; // variant

  // Convert UUID binary buffer to hex string, with or without dashes.
  const uuid = uuidBuffer.toString('hex');

  return [
    uuid.slice(0, 8),
    '-',
    uuid.slice(8, 12),
    '-',
    uuid.slice(12, 16),
    '-',
    uuid.slice(16, 20),
    '-',
    uuid.slice(20, 32),
  ].join('');
}

function isUUIDFormat(input: string): boolean {
  const regex = new RegExp(
    '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-f0-9A-F]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
  );
  return regex.test(input);
}
