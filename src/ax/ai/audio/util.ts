import type { AxAudioFormat } from './types.js';

export const axAudioMimeType = (
  format?: AxAudioFormat,
  sampleRate?: number,
  fallback = 'audio/mpeg'
): string => {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'opus':
      return 'audio/opus';
    case 'aac':
      return 'audio/aac';
    case 'pcm':
    case 'pcm16':
      return sampleRate ? `audio/pcm;rate=${sampleRate}` : 'audio/pcm';
    case 'ogg':
      return 'audio/ogg';
    default:
      return fallback;
  }
};

export const axAudioFormatFromMimeType = (
  mimeType?: string
): AxAudioFormat | undefined => {
  const mt = mimeType?.toLowerCase();
  if (!mt) return undefined;
  if (mt.includes('wav')) return 'wav';
  if (mt.includes('mpeg') || mt.includes('mp3')) return 'mp3';
  if (mt.includes('flac')) return 'flac';
  if (mt.includes('opus')) return 'opus';
  if (mt.includes('aac')) return 'aac';
  if (mt.includes('ogg')) return 'ogg';
  if (mt.includes('pcm16')) return 'pcm16';
  if (mt.includes('pcm')) return 'pcm';
  return undefined;
};

const base64ToBytes = (value: string): Uint8Array => {
  const g = globalThis as typeof globalThis & {
    Buffer?: {
      from: (value: string, encoding: 'base64') => Uint8Array;
    };
  };

  if (g.Buffer) {
    return new Uint8Array(g.Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const g = globalThis as typeof globalThis & {
    Buffer?: {
      from: (value: Uint8Array) => { toString: (encoding: 'base64') => string };
    };
  };

  if (g.Buffer) {
    return g.Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export const axConcatBase64 = (chunks: readonly string[]): string => {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0] ?? '';

  const decoded = chunks.map((chunk) => base64ToBytes(chunk));
  const totalLength = decoded.reduce((sum, bytes) => sum + bytes.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const bytes of decoded) {
    merged.set(bytes, offset);
    offset += bytes.length;
  }

  return bytesToBase64(merged);
};
