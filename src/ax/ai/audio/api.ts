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

export const axNormalizeMetaTranscriptionResponse = (
  value: unknown
): AxTranscriptionResponse => {
  const obj = value as JsonRecord;
  const turns = Array.isArray(obj?.turns)
    ? obj.turns.map((turn: JsonRecord) => ({
        id: turn.turnId ?? turn.turn_id,
        text: String(turn.transcript ?? turn.text ?? ''),
        start:
          typeof (turn.startMs ?? turn.start_ms) === 'number'
            ? (turn.startMs ?? turn.start_ms) / 1000
            : undefined,
        end:
          typeof (turn.endMs ?? turn.end_ms) === 'number'
            ? (turn.endMs ?? turn.end_ms) / 1000
            : undefined,
        speaker: turn.speaker ?? turn.speakerId ?? turn.speaker_id,
      }))
    : undefined;
  return {
    text: String(obj?.transcript ?? obj?.text ?? ''),
    language: typeof obj?.language === 'string' ? obj.language : undefined,
    duration:
      typeof obj?.audioDurationMs === 'number'
        ? obj.audioDurationMs / 1000
        : typeof obj?.duration === 'number'
          ? obj.duration
          : undefined,
    segments: turns,
    sessionId:
      typeof obj?.sessionId === 'string'
        ? obj.sessionId
        : typeof obj?.session_id === 'string'
          ? obj.session_id
          : undefined,
  };
};

export const axFetchMetaTranscription = async ({
  url,
  headers,
  audio,
  request,
  fetch,
  abortSignal,
  partialMode,
  sessionId,
  acceptEventStream,
}: Readonly<{
  url: string;
  headers: Record<string, string>;
  audio: AxAudioInput;
  request: JsonRecord;
  fetch?: FetchLike;
  abortSignal?: AbortSignal;
  partialMode?: 'cumulative' | 'delta';
  sessionId?: string;
  acceptEventStream?: boolean;
}>): Promise<AxTranscriptionResponse> => {
  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify(request)], { type: 'application/json' })
  );
  form.append('audio', axAudioInputToBlob(audio), axAudioInputFilename(audio));
  const response = await fetchWithNetworkErrors(
    fetch ?? globalThis.fetch,
    url,
    {
      method: 'POST',
      headers: {
        ...headers,
        Accept: acceptEventStream
          ? 'text/event-stream'
          : 'application/json, text/plain',
      },
      body: form,
      signal: abortSignal,
    },
    request
  );
  await checkResponse(response, url, request);
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/plain')) {
    return { text: await response.text(), sessionId };
  }
  if (contentType.includes('text/event-stream')) {
    const turns = new Map<
      string,
      {
        id: string;
        text: string;
        start?: number;
        end?: number;
        speaker?: string | number;
      }
    >();
    let latestTurnId = 'turn-0';
    let resolvedSessionId = sessionId;
    let audioProcessedMs: number | undefined;
    const blocks = (await response.text()).split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data) as JsonRecord;
      resolvedSessionId = event.sessionId ?? resolvedSessionId;
      if (typeof event.audioProcessedMs === 'number') {
        audioProcessedMs = event.audioProcessedMs;
      }
      if (event.type === 'error') {
        throw new Error(String(event.message ?? 'Meta Voice error'));
      }
      if (event.type === 'speechStart') {
        latestTurnId = String(event.turnId ?? latestTurnId);
        turns.set(latestTurnId, {
          id: latestTurnId,
          text: '',
          start:
            typeof event.audioProcessedMs === 'number'
              ? event.audioProcessedMs / 1000
              : undefined,
        });
      } else if (event.type === 'transcript') {
        const turn = turns.get(latestTurnId) ?? {
          id: latestTurnId,
          text: '',
        };
        const incoming = String(event.transcript ?? '');
        turn.text =
          partialMode === 'delta' && event.final !== true
            ? turn.text + incoming
            : incoming;
        turns.set(latestTurnId, turn);
      } else if (event.type === 'speaker') {
        const turn = turns.get(latestTurnId) ?? {
          id: latestTurnId,
          text: '',
        };
        turn.speaker = event.label;
        turns.set(latestTurnId, turn);
      } else if (event.type === 'speechEnd') {
        const turnId = String(event.turnId ?? latestTurnId);
        const turn = turns.get(turnId) ?? { id: turnId, text: '' };
        turn.end =
          typeof event.audioProcessedMs === 'number'
            ? event.audioProcessedMs / 1000
            : undefined;
        turns.set(turnId, turn);
      } else if (event.type === 'speechComplete') {
        const turnId = String(event.turnId ?? latestTurnId);
        const turn = turns.get(turnId) ?? { id: turnId, text: '' };
        turn.text = String(event.transcript ?? turn.text);
        turn.end =
          typeof event.audioProcessedMs === 'number'
            ? event.audioProcessedMs / 1000
            : turn.end;
        turns.set(turnId, turn);
      }
    }
    const segments = [...turns.values()].map((turn) => ({
      id: turn.id,
      text: turn.text,
      start: turn.start,
      end: turn.end,
      speaker: turn.speaker,
    }));
    return {
      text: segments.map((segment) => segment.text).join('\n'),
      segments,
      duration:
        audioProcessedMs === undefined ? undefined : audioProcessedMs / 1000,
      audioProcessedMs,
      sessionId: resolvedSessionId,
    };
  }
  const normalized = axNormalizeMetaTranscriptionResponse(
    await response.json()
  );
  return { ...normalized, sessionId: normalized.sessionId ?? sessionId };
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
