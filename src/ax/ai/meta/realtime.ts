import type { AxAPI } from '../../util/apicall.js';
import type {
  AxAIOpenAIResponsesConfig,
  AxAIOpenAIResponsesInputContentPart,
  AxAIOpenAIResponsesRealtimeRequest,
  AxAIOpenAIResponsesResponse,
  OpenAIResponsesResponseDelta,
} from '../openai/responses_types.js';
import type { AxChatResponseResult } from '../types.js';

type WebSocketLike = {
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener?: (
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void
  ) => void;
  on?: (type: 'open' | 'message' | 'error' | 'close', listener: any) => void;
};

type MetaRealtimeTurn = {
  id: string;
  transcript: string;
  speaker?: string;
  finalized?: boolean;
  emitted?: boolean;
};

const attach = (
  socket: WebSocketLike,
  type: 'open' | 'message' | 'error' | 'close',
  listener: (event: any) => void
): void => {
  if (socket.addEventListener) socket.addEventListener(type, listener);
  else if (type === 'close') {
    socket.on?.(type, (code: number, reason: unknown) =>
      listener({ code, reason })
    );
  } else socket.on?.(type, listener);
};

const parseMessage = (event: any): Record<string, any> => {
  const data = event?.data ?? event;
  if (typeof data === 'string') return JSON.parse(data);
  if (data instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(data));
  }
  return JSON.parse(String(data));
};

const base64ToBytes = (value: string): Uint8Array => {
  const raw = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const buffer = (globalThis as any).Buffer;
  if (buffer) return new Uint8Array(buffer.from(raw, 'base64'));
  const binary = atob(raw);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const audioParts = (
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>
) => {
  if (!Array.isArray(request.request.input)) return [];
  return request.request.input.flatMap((item) => {
    if (!item || typeof item === 'string' || item.type !== 'message') return [];
    if (!Array.isArray(item.content)) return [];
    return item.content.flatMap((part: AxAIOpenAIResponsesInputContentPart) =>
      part.type === 'input_audio' ? [part.input_audio] : []
    );
  });
};

const metaConfig = (
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>
) =>
  (
    request as Readonly<
      AxAIOpenAIResponsesRealtimeRequest<any> & {
        metaConfig?: AxAIOpenAIResponsesConfig<
          any,
          any
        >['realtimeTranscription'];
      }
    >
  ).metaConfig;

const resolveAudioEncoding = (
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>
): 'PCM_16KHZ' | 'PCM_24KHZ' => {
  const sampleRate = request.audio?.input?.sampleRate ?? 24_000;
  const channels = request.audio?.input?.channels ?? 1;
  if (channels !== 1) {
    throw new Error('Meta Voice realtime transcription requires mono audio');
  }
  if (sampleRate === 16_000) return 'PCM_16KHZ';
  if (sampleRate === 24_000) return 'PCM_24KHZ';
  throw new Error(
    'Meta Voice realtime transcription requires 16000 Hz or 24000 Hz audio'
  );
};

const createHandshake = (
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>
) => {
  const config = metaConfig(request);
  return {
    model: String(request.model),
    authorization: { accessToken: `Bearer ${request.apiKey}` },
    audioEncoding: resolveAudioEncoding(request),
    ...(config?.mode ? { mode: config.mode.toUpperCase() } : {}),
    ...(config?.languageBias?.length
      ? { languageBias: config.languageBias }
      : {}),
    ...(config?.keywords?.length ? { keywords: config.keywords } : {}),
    ...(config?.partialMode
      ? { partialMode: config.partialMode.toUpperCase() }
      : {}),
    ...(config?.emitAudioProgress !== undefined
      ? { emitAudioProgress: config.emitAudioProgress }
      : {}),
    ...(config?.zdrOverride !== undefined
      ? { zdrOverride: config.zdrOverride }
      : {}),
  };
};

const finalResponse = (
  model: unknown,
  sessionId: string,
  turns: ReadonlyArray<MetaRealtimeTurn>
): AxAIOpenAIResponsesResponse =>
  ({
    id: sessionId,
    object: 'response',
    created: Math.floor(Date.now() / 1000),
    model: String(model),
    output: [
      {
        type: 'message',
        id: sessionId,
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: turns.map((turn) => turn.transcript).join('\n'),
          },
        ],
      },
    ],
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    meta_session_id: sessionId,
    meta_results: turns.map(
      (turn, index): AxChatResponseResult => ({
        index,
        id: turn.id,
        content: turn.transcript,
        name: turn.speaker,
        finishReason: 'stop',
      })
    ),
  }) as unknown as AxAIOpenAIResponsesResponse;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const sendAudio = async (
  socket: WebSocketLike,
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>,
  isDone: () => boolean,
  onEndStream: () => void
): Promise<void> => {
  const sampleRate = request.audio?.input?.sampleRate ?? 24_000;
  const chunkBytes = Math.max(2, Math.floor(sampleRate * 2 * 0.08));
  for (const part of audioParts(request)) {
    if (part.format !== 'pcm16' && part.format !== 'pcm') {
      throw new Error(
        `Meta Voice realtime audio requires pcm16 audio, received ${part.format ?? 'unknown format'}`
      );
    }
    const bytes = base64ToBytes(part.data);
    if (bytes.length % 2 !== 0) {
      throw new Error(
        'Meta Voice PCM16 audio must contain complete 16-bit samples'
      );
    }
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      if (isDone()) return;
      const chunk = bytes.slice(offset, offset + chunkBytes);
      socket.send(chunk);
      await delay((chunk.length / (sampleRate * 2)) * 1000);
    }
  }
  if (isDone()) return;
  onEndStream();
  socket.send(JSON.stringify({ type: 'endStream' }));
};

const runMetaRealtime = async (
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>,
  onDelta?: (delta: OpenAIResponsesResponseDelta) => void,
  endpoint = 'wss://api.meta.ai/v1/asr/realtime'
): Promise<AxAIOpenAIResponsesResponse> => {
  const WebSocketCtor = request.webSocket ?? globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error(
      'Meta Voice realtime transcription requires a WebSocket constructor'
    );
  }
  request.abortSignal?.throwIfAborted();
  resolveAudioEncoding(request);
  const url = new URL(endpoint);
  if (request.sessionId) url.searchParams.set('sessionId', request.sessionId);
  const socket = new (WebSocketCtor as any)(url.toString()) as WebSocketLike;
  const turns = new Map<string, MetaRealtimeTurn>();
  let latestTurnId = 'turn-0';
  let sessionId = request.sessionId ?? 'meta-realtime';
  let handshakeComplete = false;
  let endStreamSent = false;
  let done = false;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;

  const emitTranscript = (
    turn: MetaRealtimeTurn,
    audioProcessedMs?: number
  ) => {
    const emit = (item: MetaRealtimeTurn, content: string) =>
      onDelta?.({
        type: 'response.output_text.delta',
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: content,
        transcript: { text: item.transcript, isFinal: !!item.finalized },
        speaker: item.speaker,
        audioProcessedMs,
      } as OpenAIResponsesResponseDelta);
    // Partials are replacement snapshots, never append-only text deltas.
    emit(turn, '');
    for (const item of turns.values()) {
      if (!item.finalized) break;
      if (!item.emitted) {
        item.emitted = true;
        emit(item, item.transcript);
      }
    }
  };

  return await new Promise((resolve, reject) => {
    const handshakeTimer = setTimeout(
      () => fail(new Error('Meta Voice realtime handshake timed out')),
      10_000
    );
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(handshakeTimer);
      if (completionTimer) clearTimeout(completionTimer);
      request.abortSignal?.removeEventListener('abort', onAbort);
      resolve(finalResponse(request.model, sessionId, [...turns.values()]));
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(handshakeTimer);
      if (completionTimer) clearTimeout(completionTimer);
      request.abortSignal?.removeEventListener('abort', onAbort);
      try {
        socket.close();
      } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onAbort = () =>
      fail(request.abortSignal?.reason ?? new Error('Aborted'));
    request.abortSignal?.addEventListener('abort', onAbort, { once: true });

    attach(socket, 'open', () => {
      try {
        socket.send(JSON.stringify(createHandshake(request)));
      } catch (error) {
        fail(error);
      }
    });

    attach(socket, 'error', (event) =>
      fail(event?.error ?? event?.message ?? 'Meta Voice WebSocket error')
    );
    attach(socket, 'close', (event) => {
      if (event?.code === 1000 && handshakeComplete && endStreamSent) finish();
      else {
        fail(
          new Error(
            `Meta Voice WebSocket closed before graceful completion${event?.code ? ` (code ${event.code})` : ''}`
          )
        );
      }
    });
    attach(socket, 'message', (event) => {
      try {
        const message = parseMessage(event);
        if (message.type === 'error') {
          fail(message.message ?? 'Meta Voice error');
          return;
        }
        if (!handshakeComplete && !message.type && message.sessionId) {
          handshakeComplete = true;
          sessionId = String(message.sessionId);
          clearTimeout(handshakeTimer);
          void sendAudio(
            socket,
            request,
            () => done,
            () => {
              endStreamSent = true;
            }
          )
            .then(() => {
              if (done) return;
              completionTimer = setTimeout(
                () =>
                  fail(
                    new Error('Meta Voice realtime transcription timed out')
                  ),
                request.turnTimeoutMs ?? 30_000
              );
            })
            .catch(fail);
          return;
        }
        if (!handshakeComplete) {
          fail(
            new Error('Meta Voice realtime server did not acknowledge setup')
          );
          return;
        }
        sessionId = message.sessionId ?? sessionId;
        if (message.type === 'speechStart') {
          latestTurnId = String(message.turnId ?? latestTurnId);
          if (!turns.has(latestTurnId))
            turns.set(latestTurnId, { id: latestTurnId, transcript: '' });
          return;
        }
        if (message.type === 'transcript') {
          const previous = turns.get(latestTurnId) ?? {
            id: latestTurnId,
            transcript: '',
          };
          const incoming = String(message.transcript ?? '');
          const cumulative = metaConfig(request)?.partialMode !== 'delta';
          previous.transcript =
            cumulative || message.final === true
              ? incoming
              : previous.transcript + incoming;
          previous.finalized = message.final === true;
          turns.set(latestTurnId, previous);
          emitTranscript(previous, message.audioProcessedMs);
          return;
        }
        if (message.type === 'speaker') {
          const previous = turns.get(latestTurnId) ?? {
            id: latestTurnId,
            transcript: '',
          };
          previous.speaker = String(message.label ?? '');
          turns.set(latestTurnId, previous);
          onDelta?.({
            type: 'response.output_text.delta',
            item_id: latestTurnId,
            output_index: 0,
            content_index: 0,
            delta: '',
            speaker: previous.speaker,
            audioProcessedMs: message.audioProcessedMs,
          } as OpenAIResponsesResponseDelta);
          return;
        }
        if (message.type === 'speechComplete') {
          const turnId = String(message.turnId ?? latestTurnId);
          const previous = turns.get(turnId) ?? { id: turnId, transcript: '' };
          const complete = String(message.transcript ?? previous.transcript);
          previous.transcript = complete;
          previous.finalized = true;
          turns.set(turnId, previous);
          emitTranscript(previous, message.audioProcessedMs);
          return;
        }
        if (message.type === 'audioProgress' || message.type === 'speechEnd') {
          const turnId = String(message.turnId ?? latestTurnId);
          onDelta?.({
            type: 'response.output_text.delta',
            item_id: turnId,
            output_index: 0,
            content_index: 0,
            delta: '',
            speaker: turns.get(turnId)?.speaker,
            audioProcessedMs: message.audioProcessedMs,
          } as OpenAIResponsesResponseDelta);
        }
      } catch (error) {
        fail(error);
      }
    });
  });
};

export const axCreateMetaRealtimeApi = (
  request: Readonly<AxAIOpenAIResponsesRealtimeRequest<any>>,
  config?: AxAIOpenAIResponsesConfig<any, any>['realtimeTranscription'],
  accessToken?: () => Promise<string>,
  endpoint?: string
): AxAPI => ({
  name: 'meta-asr-realtime',
  localCall: async <_TRequest, TResponse>(
    _data: _TRequest,
    stream?: boolean
  ) => {
    const enriched = {
      ...request,
      apiKey: accessToken ? await accessToken() : request.apiKey,
      metaConfig: config,
    };
    if (!stream)
      return (await runMetaRealtime(
        enriched,
        undefined,
        endpoint
      )) as TResponse;
    const cancellation = new AbortController();
    const streamRequest = {
      ...enriched,
      abortSignal: request.abortSignal
        ? AbortSignal.any([request.abortSignal, cancellation.signal])
        : cancellation.signal,
    };
    let cancelled = false;
    return new ReadableStream<OpenAIResponsesResponseDelta>({
      start(controller) {
        runMetaRealtime(
          streamRequest,
          (delta) => {
            if (!cancelled) controller.enqueue(delta);
          },
          endpoint
        )
          .then((response) => {
            if (cancelled) return;
            controller.enqueue({
              type: 'response.completed',
              response,
              sequence_number: 0,
            } as OpenAIResponsesResponseDelta);
            controller.close();
          })
          .catch((error) => {
            if (!cancelled) controller.error(error);
          });
      },
      cancel(reason) {
        cancelled = true;
        cancellation.abort(reason);
      },
    }) as ReadableStream<TResponse>;
  },
});
