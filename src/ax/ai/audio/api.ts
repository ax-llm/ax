import {
  AxAIServiceAuthenticationError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
} from '../../util/apicall.js';
import type {
  AxAudioFormat,
  AxAudioInput,
  AxSpeechResponse,
  AxTranscriptionResponse,
} from './types.js';
import { axAudioFormatFromMimeType, axAudioMimeType } from './util.js';

type FetchLike = typeof fetch;

type JsonRecord = Record<string, any>;

const base64ToBytes = (value: string): Uint8Array => {
  const g = globalThis as typeof globalThis & {
    Buffer?: {
      from: (value: string, encoding: 'base64') => Uint8Array;
    };
  };

  const base64 = value.includes(',')
    ? value.slice(value.indexOf(',') + 1)
    : value;
  if (g.Buffer) {
    return new Uint8Array(g.Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
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

const readErrorBody = async (response: Response): Promise<unknown> => {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch {
    return undefined;
  }
};

const checkResponse = async (
  response: Response,
  url: string,
  requestBody: unknown
): Promise<void> => {
  if (response.ok) return;

  const responseBody = await readErrorBody(response);
  if (response.status === 401 || response.status === 403) {
    throw new AxAIServiceAuthenticationError(url, requestBody, responseBody);
  }

  throw new AxAIServiceStatusError(
    response.status,
    response.statusText,
    url,
    requestBody,
    responseBody
  );
};

const fetchWithNetworkErrors = async (
  fetcher: FetchLike,
  url: string,
  init: RequestInit,
  requestBody: unknown
): Promise<Response> => {
  try {
    return await fetcher(url, init);
  } catch (error) {
    throw new AxAIServiceNetworkError(
      error instanceof Error ? error : new Error(String(error)),
      url,
      requestBody,
      undefined
    );
  }
};

export const axAudioInputToBlob = (
  audio: Readonly<AxAudioInput>,
  fallbackFormat: AxAudioFormat = 'wav'
): Blob => {
  const format =
    audio.format ?? axAudioFormatFromMimeType(audio.mimeType) ?? fallbackFormat;
  const mimeType = audio.mimeType ?? axAudioMimeType(format, audio.sampleRate);
  return new Blob([base64ToBytes(audio.data)], { type: mimeType });
};

export const axAudioInputFilename = (
  audio: Readonly<AxAudioInput>,
  fallbackFormat: AxAudioFormat = 'wav'
): string => {
  if (audio.filename) return audio.filename;
  const format =
    audio.format ?? axAudioFormatFromMimeType(audio.mimeType) ?? fallbackFormat;
  return `audio.${format === 'pcm16' ? 'pcm' : format}`;
};

export const axNormalizeTranscriptionResponse = (
  value: unknown
): AxTranscriptionResponse => {
  if (typeof value === 'string') {
    return { text: value };
  }

  const obj = value as JsonRecord;
  const segments = Array.isArray(obj?.segments)
    ? obj.segments.map((segment: JsonRecord) => ({
        id: segment.id,
        text: String(segment.text ?? ''),
        start: typeof segment.start === 'number' ? segment.start : undefined,
        end: typeof segment.end === 'number' ? segment.end : undefined,
        speaker: segment.speaker ?? segment.speaker_id,
      }))
    : undefined;
  const words = Array.isArray(obj?.words)
    ? obj.words.map((word: JsonRecord) => ({
        id: word.id,
        text: String(word.text ?? word.word ?? ''),
        start: typeof word.start === 'number' ? word.start : undefined,
        end: typeof word.end === 'number' ? word.end : undefined,
        speaker: word.speaker ?? word.speaker_id,
      }))
    : undefined;

  return {
    text: String(obj?.text ?? ''),
    language: typeof obj?.language === 'string' ? obj.language : undefined,
    duration: typeof obj?.duration === 'number' ? obj.duration : undefined,
    segments,
    words,
  };
};

export const axFetchMultipartTranscription = async ({
  url,
  headers,
  audio,
  fields,
  fetch,
  abortSignal,
}: Readonly<{
  url: string;
  headers: Record<string, string>;
  audio: AxAudioInput;
  fields: Record<string, string | number | boolean | undefined>;
  fetch?: FetchLike;
  abortSignal?: AbortSignal;
}>): Promise<AxTranscriptionResponse> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      form.append(key, String(value));
    }
  }
  form.append('file', axAudioInputToBlob(audio), axAudioInputFilename(audio));

  const response = await fetchWithNetworkErrors(
    fetch ?? globalThis.fetch,
    url,
    {
      method: 'POST',
      headers,
      body: form,
      signal: abortSignal,
    },
    fields
  );
  await checkResponse(response, url, fields);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/plain')) {
    return { text: await response.text() };
  }
  return axNormalizeTranscriptionResponse(await response.json());
};

export const axFetchJsonSpeech = async ({
  url,
  headers,
  body,
  format,
  transcript,
  fetch,
  abortSignal,
}: Readonly<{
  url: string;
  headers: Record<string, string>;
  body: JsonRecord;
  format?: AxAudioFormat;
  transcript: string;
  fetch?: FetchLike;
  abortSignal?: AbortSignal;
}>): Promise<AxSpeechResponse> => {
  const response = await fetchWithNetworkErrors(
    fetch ?? globalThis.fetch,
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    },
    body
  );
  await checkResponse(response, url, body);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = (await response.json()) as JsonRecord;
    const data =
      json.audio_data ??
      json.audioData ??
      json.data ??
      json.audio?.data ??
      json.output?.audio?.data ??
      json.candidates?.[0]?.content?.parts?.find(
        (part: JsonRecord) => part.inlineData?.data || part.inline_data?.data
      )?.inlineData?.data ??
      json.candidates?.[0]?.content?.parts?.find(
        (part: JsonRecord) => part.inline_data?.data
      )?.inline_data?.data;
    if (typeof data !== 'string') {
      throw new Error('Speech response JSON did not include audio data');
    }
    const mimeType =
      typeof json.mimeType === 'string'
        ? json.mimeType
        : typeof json.mime_type === 'string'
          ? json.mime_type
          : (json.candidates?.[0]?.content?.parts?.find(
              (part: JsonRecord) => part.inlineData?.mimeType
            )?.inlineData?.mimeType ??
            json.candidates?.[0]?.content?.parts?.find(
              (part: JsonRecord) => part.inline_data?.mime_type
            )?.inline_data?.mime_type ??
            axAudioMimeType(format));
    return {
      data,
      format: format ?? axAudioFormatFromMimeType(mimeType),
      mimeType,
      transcript,
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimeType = contentType || axAudioMimeType(format);
  return {
    data: bytesToBase64(bytes),
    format: format ?? axAudioFormatFromMimeType(mimeType),
    mimeType,
    transcript,
  };
};
