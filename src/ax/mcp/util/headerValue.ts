const BASE64_SENTINEL_PREFIX = '=?base64?';
const BASE64_SENTINEL_SUFFIX = '?=';

/** True when an MCP mirrored value can be emitted without sentinel encoding. */
export function axMCPIsPlainHeaderValue(value: string): boolean {
  if (/^[\t ]|[\t ]$/.test(value)) return false;
  if (
    value.startsWith(BASE64_SENTINEL_PREFIX) &&
    value.endsWith(BASE64_SENTINEL_SUFFIX)
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return false;
  }
  return true;
}

/** Encodes an MCP name or mirrored parameter as an RFC 9110 field value. */
export function axMCPEncodeHeaderValue(value: string): string {
  if (axMCPIsPlainHeaderValue(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${BASE64_SENTINEL_PREFIX}${btoa(binary)}${BASE64_SENTINEL_SUFFIX}`;
}

/** Decodes the MCP Base64 sentinel form, leaving ordinary field values intact. */
export function axMCPDecodeHeaderValue(value: string): string {
  if (
    !value.startsWith(BASE64_SENTINEL_PREFIX) ||
    !value.endsWith(BASE64_SENTINEL_SUFFIX)
  ) {
    return value;
  }
  const encoded = value.slice(
    BASE64_SENTINEL_PREFIX.length,
    -BASE64_SENTINEL_SUFFIX.length
  );
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
