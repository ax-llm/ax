import type {
  AxMCPListeningHandle,
  AxMCPListeningOptions,
  AxMCPRequestOptions,
  AxMCPTransport,
  AxMCPTransportLifecycleState,
} from '../transport.js';
import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from '../types.js';

export type AxMCPTransportRecordingEntry =
  | {
      direction: 'request';
      message: AxMCPJSONRPCRequest<unknown>;
      response: AxMCPJSONRPCResponse<unknown>;
    }
  | { direction: 'notification'; message: AxMCPJSONRPCNotification }
  | { direction: 'response'; message: AxMCPJSONRPCResponse }
  | { direction: 'inbound'; message: AxMCPJSONRPCMessage };

type AxMCPRecordedRequest = Extract<
  AxMCPTransportRecordingEntry,
  { direction: 'request' }
>;

export class AxMCPRecordingTransport implements AxMCPTransport {
  readonly evaluationMode = 'record' as const;
  private readonly entries: AxMCPTransportRecordingEntry[] = [];
  private handler?: (
    message: Readonly<AxMCPJSONRPCMessage>
  ) => void | Promise<void>;
  private lifecycleHandler?: (
    state: AxMCPTransportLifecycleState
  ) => void | Promise<void>;

  constructor(private readonly inner: AxMCPTransport) {
    inner.setMessageHandler?.(async (message) => {
      this.entries.push({
        direction: 'inbound',
        message: structuredClone(message),
      });
      await this.handler?.(message);
    });
    inner.setLifecycleHandler?.((state) => this.lifecycleHandler?.(state));
  }

  getRecording(): readonly AxMCPTransportRecordingEntry[] {
    return structuredClone(this.entries);
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    const response = await this.inner.send(message, options);
    this.entries.push({
      direction: 'request',
      message: structuredClone(message),
      response: structuredClone(response),
    });
    return response;
  }

  async sendBatch(
    messages: readonly Readonly<AxMCPJSONRPCRequest<unknown>>[],
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<readonly AxMCPJSONRPCResponse<unknown>[]> {
    if (!this.inner.sendBatch) {
      throw new Error('Wrapped MCP transport does not support batching');
    }
    const responses = await this.inner.sendBatch(messages, options);
    messages.forEach((message, index) => {
      this.entries.push({
        direction: 'request',
        message: structuredClone(message),
        response: structuredClone(responses[index]!),
      });
    });
    return responses;
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    await this.inner.sendNotification(message);
    this.entries.push({
      direction: 'notification',
      message: structuredClone(message),
    });
  }

  async sendResponse(message: Readonly<AxMCPJSONRPCResponse>): Promise<void> {
    await this.inner.sendResponse?.(message);
    this.entries.push({
      direction: 'response',
      message: structuredClone(message),
    });
  }

  setMessageHandler(
    handler: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>
  ): void {
    this.handler = handler;
  }

  setLifecycleHandler(
    handler: (state: AxMCPTransportLifecycleState) => void | Promise<void>
  ): void {
    this.lifecycleHandler = handler;
  }

  setProtocolVersion(protocolVersion: string): void {
    this.inner.setProtocolVersion?.(protocolVersion);
  }

  takeRequestMetadata(id: string | number) {
    return this.inner.takeRequestMetadata?.(id);
  }

  async connect(): Promise<void> {
    await this.inner.connect?.();
  }

  startListening(
    options?: Readonly<AxMCPListeningOptions>
  ): AxMCPListeningHandle | Promise<AxMCPListeningHandle> {
    if (this.inner.startListening) return this.inner.startListening(options);
    const controller = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    return {
      done: new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
      close: () => controller.abort('MCP recording listener closed'),
    };
  }

  async terminateSession(): Promise<void> {
    await this.inner.terminateSession?.();
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}

export class AxMCPReplayTransport implements AxMCPTransport {
  readonly evaluationMode = 'replay' as const;
  private requestIndex = 0;
  private readonly requests: AxMCPRecordedRequest[];

  constructor(
    recording: readonly AxMCPTransportRecordingEntry[],
    private readonly options: Readonly<{ strict?: boolean }> = {}
  ) {
    this.requests = recording.filter(
      (entry): entry is AxMCPRecordedRequest => entry.direction === 'request'
    );
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    const entry = this.requests[this.requestIndex++];
    if (!entry) throw new Error(`No MCP replay entry for ${message.method}`);
    if (entry.message.method !== message.method) {
      throw new Error(
        `MCP replay mismatch: expected ${entry.message.method}, received ${message.method}`
      );
    }
    if (
      this.options.strict &&
      JSON.stringify(entry.message.params) !== JSON.stringify(message.params)
    ) {
      throw new Error(`MCP replay parameter mismatch for ${message.method}`);
    }
    return { ...structuredClone(entry.response), id: message.id };
  }

  async sendBatch(
    messages: readonly Readonly<AxMCPJSONRPCRequest<unknown>>[]
  ): Promise<readonly AxMCPJSONRPCResponse<unknown>[]> {
    return Promise.all(messages.map((message) => this.send(message)));
  }

  async sendNotification(): Promise<void> {}

  takeRequestMetadata(): Readonly<{ retryCount?: number }> {
    return { retryCount: 0 };
  }
}
