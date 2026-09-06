import { SSEParser } from '../../util/sse.js';
import type {
  AxAICredentialProvider,
  AxAIServiceOptions,
  AxModelUsage,
} from '../types.js';
import { axResolveOpenAIResponsesReasoningEffort } from './effort.js';
import { axIsGPT6Astra } from './model_family.js';
import type {
  AxAIOpenAIResponsesRequest,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesSessionEvent,
  AxAIOpenAIResponsesSteerRequest,
} from './responses_types.js';
import { axNormalizeOpenAIUsage } from './usage.js';

/** Native Responses requests default their model from the configured AI. */
export type AxAIOpenAIResponseCreateRequest = Omit<
  AxAIOpenAIResponsesRequest<string>,
  'model'
> & { readonly model?: string };

/** Host-owned WebSocket adapter; core does not depend on a Node implementation. */
export interface AxAIOpenAIResponsesSocket {
  readonly readyState?: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}
export type AxAIOpenAIResponsesOptions = Pick<
  AxAIServiceOptions,
  | 'fetch'
  | 'abortSignal'
  | 'timeout'
  | 'webSocket'
  | 'thinkingTokenBudget'
  | 'serviceTier'
> & {
  /** Connect to an authenticated host proxy, or supply a platform-specific socket. */
  webSocketFactory?: (
    url: string,
    headers: Readonly<Record<string, string>>
  ) => AxAIOpenAIResponsesSocket;
};

/** Internal construction settings for the native Responses adapter. */
export type AxAIOpenAIResponsesClientConfig = {
  apiKey?: string | (() => Promise<string>);
  credentialProvider?: AxAICredentialProvider;
  apiURL?: string;
  defaults: Partial<AxAIOpenAIResponsesRequest<string>>;
  options: () => AxAIServiceOptions;
  estimateCost: (usage: AxModelUsage) => number;
};

/** Shared validation for HTTP, WebSocket, and Ax's standard Responses adapter. */
export function axValidateOpenAIResponseRequest<T>(
  request: AxAIOpenAIResponsesRequest<T>
): AxAIOpenAIResponsesRequest<T> {
  const astra = axIsGPT6Astra(request.model);
  const items = Array.isArray(request.input) ? request.input : [];
  const hasUpdates = items.some(
    (item) => typeof item === 'object' && item.type === 'configuration_update'
  );
  if (hasUpdates) {
    if (
      !astra ||
      request.truncation === 'auto' ||
      (request as any).context_management?.length ||
      (request as any).reasoning?.mode === 'pro' ||
      (request as any).agents
    ) {
      throw new Error(
        'configuration_update requires GPT-6 Astra in standard single-agent mode without automatic compaction or truncation'
      );
    }
    let previousWasUpdate = false;
    for (const item of items) {
      const update =
        typeof item === 'object' && item.type === 'configuration_update';
      if (update) {
        if (previousWasUpdate)
          throw new Error(
            'Adjacent configuration_update items are not supported'
          );
        if (
          !['low', 'medium', 'high', 'xhigh', 'max'].includes(
            item.reasoning.effort
          )
        )
          throw new Error('Invalid Astra reasoning effort');
      }
      previousWasUpdate = update;
    }
  }
  if (!astra) return request;
  if (
    request.reasoning?.effort &&
    !['low', 'medium', 'high', 'xhigh', 'max'].includes(
      request.reasoning.effort
    )
  ) {
    throw new Error(
      'GPT-6 Astra requires reasoning effort low, medium, high, xhigh, or max'
    );
  }
  const { temperature: _temperature, top_p: _topP, ...clean } = request;
  // Also sanitize dynamically supplied fields, even when callers bypass TS types.
  const result = { ...clean } as AxAIOpenAIResponsesRequest<T> &
    Record<string, unknown>;
  delete result.top_logprobs;
  delete result.logprobs;
  delete result.prompt_cache_retention;
  return {
    ...result,
    ...(result.include
      ? {
          include: result.include.filter(
            (value) => String(value) !== 'message.output_text.logprobs'
          ),
        }
      : {}),
  };
}

/** Native OpenAI Responses API. Tool execution and conversation history belong to the caller. */
export class AxAIOpenAIResponsesClient {
  private readonly usage = new Map<string, AxModelUsage>();
  private readonly history = new Map<
    string,
    { hasUpdates: boolean; lastWasUpdate: boolean }
  >();

  private remember(
    response: AxAIOpenAIResponsesResponse,
    request: AxAIOpenAIResponsesRequest<string>
  ): void {
    const parent = request.previous_response_id
      ? this.history.get(request.previous_response_id)
      : undefined;
    const items =
      typeof request.input === 'string' ? [request.input] : request.input;
    const isUpdate = (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      item.type === 'configuration_update';
    this.history.set(response.id, {
      hasUpdates: !!parent?.hasUpdates || items.some(isUpdate),
      lastWasUpdate: response.output?.length
        ? false
        : items.length
          ? isUpdate(items[items.length - 1])
          : !!parent?.lastWasUpdate,
    });
  }
  constructor(private readonly config: AxAIOpenAIResponsesClientConfig) {}

  /** One normalized usage entry per response, including steering continuations. */
  getUsage(): readonly AxModelUsage[] {
    return structuredClone([...this.usage.values()]);
  }
  getEstimatedCost(): number {
    return [...this.usage.values()].reduce(
      (sum, usage) => sum + this.config.estimateCost(usage),
      0
    );
  }

  private record(response: AxAIOpenAIResponsesResponse): void {
    const tokens = axNormalizeOpenAIUsage(
      response.usage,
      response.service_tier_used ?? response.service_tier
    );
    if (tokens && !this.usage.has(response.id))
      this.usage.set(response.id, {
        ai: 'openai-responses',
        model: response.model,
        tokens,
      });
  }
  private recordEvent = (
    event: AxAIOpenAIResponsesSessionEvent,
    request?: AxAIOpenAIResponsesRequest<string>
  ): void => {
    if (request && 'response' in event) this.remember(event.response, request);
    if (
      event.type === 'response.completed' ||
      event.type === 'response.incomplete' ||
      event.type === 'response.failed'
    )
      this.record(event.response);
  };
  private prepare = (
    request: AxAIOpenAIResponseCreateRequest,
    options: AxAIOpenAIResponsesOptions
  ): AxAIOpenAIResponsesRequest<string> => {
    const merged = { ...this.config.defaults, ...request };
    if (!merged.model) throw new Error('Responses model is required');
    if (merged.service_tier === undefined && options.serviceTier !== undefined)
      merged.service_tier =
        options.serviceTier === 'standard' ? 'default' : options.serviceTier;

    if (
      options.thinkingTokenBudget !== undefined &&
      request.reasoning?.effort === undefined
    ) {
      merged.reasoning = {
        ...merged.reasoning,
        effort: axResolveOpenAIResponsesReasoningEffort(
          merged.model,
          options.thinkingTokenBudget
        ),
      };
    }
    const parent = merged.previous_response_id
      ? this.history.get(merged.previous_response_id)
      : undefined;
    const first = Array.isArray(merged.input) ? merged.input[0] : undefined;
    if (parent?.lastWasUpdate && first?.type === 'configuration_update')
      throw new Error(
        'Adjacent configuration_update items are not supported across responses'
      );
    if (parent?.hasUpdates) {
      axValidateOpenAIResponseRequest({
        ...merged,
        input: [{ type: 'configuration_update', reasoning: { effort: 'low' } }],
      } as AxAIOpenAIResponsesRequest<string>);
    }
    return axValidateOpenAIResponseRequest(
      merged as AxAIOpenAIResponsesRequest<string>
    );
  };
  private url(): string {
    return `${(this.config.apiURL ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/responses`;
  }
  private async headers(
    url: string,
    method: string
  ): Promise<Record<string, string>> {
    return {
      ...(this.config.apiKey
        ? {
            Authorization: `Bearer ${typeof this.config.apiKey === 'function' ? await this.config.apiKey() : this.config.apiKey}`,
          }
        : {}),
      ...(await this.config.credentialProvider?.({
        profile: 'openai-responses',
        operation: 'responses',
        method,
        url,
      })),
    };
  }

  create(
    request: AxAIOpenAIResponseCreateRequest & { stream: true },
    options?: AxAIOpenAIResponsesOptions
  ): Promise<AsyncIterable<AxAIOpenAIResponsesSessionEvent>>;
  create(
    request: AxAIOpenAIResponseCreateRequest & { stream?: false | null },
    options?: AxAIOpenAIResponsesOptions
  ): Promise<AxAIOpenAIResponsesResponse>;
  create(
    request: AxAIOpenAIResponseCreateRequest,
    options?: AxAIOpenAIResponsesOptions
  ): Promise<
    AxAIOpenAIResponsesResponse | AsyncIterable<AxAIOpenAIResponsesSessionEvent>
  >;
  async create(
    request: AxAIOpenAIResponseCreateRequest,
    overrides: AxAIOpenAIResponsesOptions = {}
  ): Promise<
    AxAIOpenAIResponsesResponse | AsyncIterable<AxAIOpenAIResponsesSessionEvent>
  > {
    const options = { ...this.config.options(), ...overrides };
    const prepared = this.prepare(request, options);
    const controller = new AbortController();
    const abort = () => controller.abort(options.abortSignal?.reason);
    options.abortSignal?.throwIfAborted();
    options.abortSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error('Responses request timed out')),
      options.timeout ?? 300_000
    );
    const cleanup = () => {
      clearTimeout(timer);
      options.abortSignal?.removeEventListener('abort', abort);
    };
    controller.signal.addEventListener('abort', cleanup, { once: true });
    try {
      const url = this.url();
      const headers = await this.headers(url, 'POST');
      controller.signal.throwIfAborted();
      const response = await (options.fetch ?? globalThis.fetch)(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared),
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!response.ok)
        throw new Error(
          `OpenAI Responses HTTP ${response.status}: ${await response.text()}`
        );
      if (!prepared.stream) {
        const result = (await response.json()) as AxAIOpenAIResponsesResponse;
        controller.signal.throwIfAborted();
        this.remember(result, prepared);
        this.record(result);
        cleanup();
        return result;
      }
      if (!response.body) throw new Error('Responses stream has no body');
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          new SSEParser<AxAIOpenAIResponsesSessionEvent>({
            onError: (error) => {
              throw error;
            },
          })
        )
        .getReader();
      const record = (event: AxAIOpenAIResponsesSessionEvent) =>
        this.recordEvent(event, prepared);
      return (async function* () {
        let terminal = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (!terminal)
                throw new Error('Responses stream closed before completion');
              break;
            }
            record(value);
            if (
              [
                'response.completed',
                'response.failed',
                'response.incomplete',
                'error',
              ].includes(value.type)
            )
              terminal = true;
            yield value;
          }
        } finally {
          cleanup();
          controller.abort();
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      })();
    } catch (error) {
      cleanup();
      controller.abort();
      throw error;
    }
  }

  async connect(
    overrides: AxAIOpenAIResponsesOptions = {}
  ): Promise<AxAIOpenAIResponsesSession> {
    const options = { ...this.config.options(), ...overrides };
    options.abortSignal?.throwIfAborted();
    const url = this.url().replace(/^http/, 'ws');
    const headers = await this.headers(url, 'GET');
    options.abortSignal?.throwIfAborted();
    const factory =
      options.webSocketFactory ??
      (options.webSocket
        ? (url: string, headers: Readonly<Record<string, string>>) =>
            new options.webSocket(url, { headers })
        : undefined);
    if (!factory)
      throw new Error(
        'Responses WebSocket requires options.webSocket (for example ws) or webSocketFactory for an authenticated host transport'
      );
    return AxAIOpenAIResponsesSession.connect(
      factory(url, headers),
      options,
      (request) => this.prepare(request, options),
      this.recordEvent
    );
  }
}

/** A single Responses connection. Events remain open until close, abort, or disconnect. */
export class AxAIOpenAIResponsesSession {
  private queue: AxAIOpenAIResponsesSessionEvent[] = [];
  private wake?: () => void;
  private ended = false;
  private failure?: Error;
  private consuming = false;
  private active = false;
  private readonly responseModels = new Map<string, string>();
  private currentModel?: string;
  private currentRequest?: AxAIOpenAIResponsesRequest<string>;
  private readonly listeners: Array<[string, (event: any) => void]> = [];
  private readonly abort = () =>
    this.finish(
      this.options.abortSignal?.reason instanceof Error
        ? this.options.abortSignal.reason
        : new Error('Responses session aborted')
    );
  private constructor(
    private readonly socket: AxAIOpenAIResponsesSocket,
    private readonly options: AxAIOpenAIResponsesOptions,
    private readonly prepare: (
      request: AxAIOpenAIResponseCreateRequest
    ) => AxAIOpenAIResponsesRequest<string>,
    private readonly record: (
      event: AxAIOpenAIResponsesSessionEvent,
      request?: AxAIOpenAIResponsesRequest<string>
    ) => void
  ) {}

  /** @internal */
  static async connect(
    socket: AxAIOpenAIResponsesSocket,
    options: AxAIOpenAIResponsesOptions,
    prepare: (
      request: AxAIOpenAIResponseCreateRequest
    ) => AxAIOpenAIResponsesRequest<string>,
    record: (
      event: AxAIOpenAIResponsesSessionEvent,
      request?: AxAIOpenAIResponsesRequest<string>
    ) => void
  ): Promise<AxAIOpenAIResponsesSession> {
    const session = new AxAIOpenAIResponsesSession(
      socket,
      options,
      prepare,
      record
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('Responses WebSocket connection timed out');
        session.finish(error);
        reject(error);
      }, options.timeout ?? 300_000);
      const opened = () => {
        clearTimeout(timer);
        resolve();
      };
      const failed = (error: Error) => {
        clearTimeout(timer);
        session.finish(error);
        reject(error);
      };
      session.listen('open', opened);
      session.listen('error', () =>
        failed(new Error('Responses WebSocket error'))
      );
      session.listen('close', () =>
        failed(
          new Error(
            'Responses WebSocket disconnected; pending work was not replayed'
          )
        )
      );
      session.listen('message', (event) => {
        try {
          const data = event.data;
          const value = JSON.parse(
            typeof data === 'string' ? data : new TextDecoder().decode(data)
          ) as AxAIOpenAIResponsesSessionEvent;
          if (!value || typeof value.type !== 'string')
            throw new Error('Invalid Responses event');
          if (value.type === 'response.created') {
            session.active = true;
            session.responseModels.set(
              value.response.id,
              value.response.model ?? session.currentModel ?? ''
            );
          }
          if (
            [
              'response.completed',
              'response.incomplete',
              'response.failed',
            ].includes(value.type)
          )
            session.active = false;
          session.record(value, session.currentRequest);
          session.queue.push(value);
          session.wake?.();
        } catch (error) {
          failed(error instanceof Error ? error : new Error(String(error)));
        }
      });
      const aborted = () => {
        clearTimeout(timer);
        session.abort();
        reject(session.failure);
      };
      options.abortSignal?.addEventListener('abort', aborted, { once: true });
      session.listeners.push(['abort', aborted]);
      if (options.abortSignal?.aborted) aborted();
    });
    return session;
  }
  private listen(type: string, listener: (event: any) => void): void {
    this.listeners.push([type, listener]);
    this.socket.addEventListener(type, listener);
  }
  private finish(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const [type, listener] of this.listeners) {
      if (type === 'abort')
        this.options.abortSignal?.removeEventListener('abort', listener);
      else this.socket.removeEventListener(type, listener);
    }
    // Node ws emits an error when close interrupts its opening handshake.
    // Drain that final transport error until close, rather than leaving an
    // unhandled EventEmitter error after detaching the session listeners.
    if (this.socket.readyState === 0) {
      const ignore = () => {};
      const drained = () => {
        this.socket.removeEventListener('error', ignore);
        this.socket.removeEventListener('close', drained);
      };
      this.socket.addEventListener('error', ignore);
      this.socket.addEventListener('close', drained);
    }
    this.socket.close();
    this.wake?.();
  }
  private send(value: unknown): void {
    if (this.ended)
      throw this.failure ?? new Error('Responses session is closed');
    this.socket.send(JSON.stringify(value));
  }
  create(request: AxAIOpenAIResponseCreateRequest): void {
    if (this.active)
      throw new Error(
        'A response is already running; use steer or wait for completion'
      );
    const prepared = this.prepare(request);
    if (prepared.background)
      throw new Error('WebSocket Responses do not support background mode');
    const { stream: _stream, ...body } = prepared;
    this.send({ ...body, type: 'response.create' });
    this.currentRequest = prepared;
    this.currentModel = prepared.model;
    this.active = true;
  }
  steer(request: AxAIOpenAIResponsesSteerRequest): void {
    if (!axIsGPT6Astra(this.responseModels.get(request.previous_response_id)))
      throw new Error(
        'Steering requires an Astra response.created ID from this connection'
      );
    if (
      typeof request.input === 'string'
        ? !request.input.trim()
        : !request.input.length ||
          request.input.some((item) => item.role !== 'user')
    )
      throw new Error('Steering requires nonempty user input');
    this.send({
      type: 'response.steer',
      previous_response_id: request.previous_response_id,
      input: request.input,
    });
  }
  async *events(): AsyncIterable<AxAIOpenAIResponsesSessionEvent> {
    if (this.consuming)
      throw new Error('Responses session supports one event consumer');
    this.consuming = true;
    try {
      while (true) {
        const event = this.queue.shift();
        if (event) {
          yield event;
          continue;
        }
        if (this.ended) {
          if (this.failure) throw this.failure;
          return;
        }
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
      }
    } finally {
      this.consuming = false;
      this.close();
    }
  }
  close(): void {
    this.finish();
  }
}
