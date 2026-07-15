import type {
  AxMCPListeningHandle,
  AxMCPRequestOptions,
  AxMCPTransport,
} from '../transport.js';
import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from '../types.js';

export interface AxMCPWebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
    options?: { once?: boolean }
  ): void;
}

export interface AxMCPWebSocketTransportOptions {
  protocols?: string | string[];
  webSocketFactory?: (
    url: string,
    protocols?: string | string[]
  ) => AxMCPWebSocketLike;
}

export class AxMCPWebSocketTransport implements AxMCPTransport {
  private socket?: AxMCPWebSocketLike;
  private connectPromise?: Promise<void>;
  private listeningDone?: Promise<void>;
  private resolveListening?: () => void;
  private rejectListening?: (error: unknown) => void;
  private closing = false;
  private protocolVersion?: string;
  private handler?: (
    message: Readonly<AxMCPJSONRPCMessage>
  ) => void | Promise<void>;
  private readonly pending = new Map<
    string | number,
    {
      resolve: (response: AxMCPJSONRPCResponse<unknown>) => void;
      reject: (error: unknown) => void;
    }
  >();

  constructor(
    private readonly url: string,
    private readonly options: Readonly<AxMCPWebSocketTransportOptions> = {}
  ) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === 1) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const factory =
        this.options.webSocketFactory ??
        ((url, protocols) =>
          protocols === undefined
            ? new WebSocket(url)
            : new WebSocket(url, protocols));
      const socket = factory(this.url, this.options.protocols);
      this.socket = socket;
      this.closing = false;
      this.listeningDone = new Promise<void>((resolveDone, rejectDone) => {
        this.resolveListening = resolveDone;
        this.rejectListening = rejectDone;
      });
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', (event) => reject(event), {
        once: true,
      });
      socket.addEventListener('message', (event) => {
        void this.handlePayload(String(event.data));
      });
      socket.addEventListener('close', () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error('MCP WebSocket closed'));
        }
        this.pending.clear();
        if (this.closing) this.resolveListening?.();
        else this.rejectListening?.(new Error('MCP WebSocket closed'));
        this.socket = undefined;
      });
    });
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async startListening(): Promise<AxMCPListeningHandle> {
    await this.connect();
    return {
      done: this.listeningDone ?? Promise.resolve(),
      close: () => this.close(),
    };
  }

  setProtocolVersion(protocolVersion: string): void {
    this.protocolVersion = protocolVersion;
  }

  takeRequestMetadata(): Readonly<{ retryCount?: number }> {
    return { retryCount: 0 };
  }

  setMessageHandler(
    handler: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>
  ): void {
    this.handler = handler;
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    if (this.socket?.readyState !== 1) await this.connect();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(message.id);
        reject(options?.signal?.reason ?? new Error('MCP request aborted'));
      };
      if (options?.signal?.aborted) return abort();
      options?.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(message.id, {
        resolve: (response) => {
          options?.signal?.removeEventListener('abort', abort);
          resolve(response);
        },
        reject,
      });
      this.socket!.send(JSON.stringify(message));
    });
  }

  async sendBatch(
    messages: readonly Readonly<AxMCPJSONRPCRequest<unknown>>[],
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<readonly AxMCPJSONRPCResponse<unknown>[]> {
    if (this.protocolVersion !== '2025-03-26') {
      throw new Error(
        `JSON-RPC batching is not allowed for MCP ${this.protocolVersion ?? 'before negotiation'}`
      );
    }
    if (messages.length === 0) throw new Error('MCP batch cannot be empty');
    if (
      new Set(messages.map((message) => message.id)).size !== messages.length
    ) {
      throw new Error('MCP batch request IDs must be unique');
    }
    if (this.socket?.readyState !== 1) await this.connect();
    const promises = messages.map(
      (message) =>
        new Promise<AxMCPJSONRPCResponse<unknown>>((resolve, reject) => {
          const abort = () => {
            this.pending.delete(message.id);
            reject(options?.signal?.reason ?? new Error('MCP batch aborted'));
          };
          if (options?.signal?.aborted) {
            abort();
            return;
          }
          options?.signal?.addEventListener('abort', abort, { once: true });
          this.pending.set(message.id, {
            resolve: (response) => {
              options?.signal?.removeEventListener('abort', abort);
              resolve(response);
            },
            reject,
          });
        })
    );
    try {
      this.socket!.send(JSON.stringify(messages));
    } catch (error) {
      for (const message of messages) this.pending.delete(message.id);
      throw error;
    }
    return Promise.all(promises);
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    if (this.socket?.readyState !== 1) await this.connect();
    this.socket!.send(JSON.stringify(message));
  }

  async sendResponse(message: Readonly<AxMCPJSONRPCResponse>): Promise<void> {
    if (this.socket?.readyState !== 1) await this.connect();
    this.socket!.send(JSON.stringify(message));
  }

  close(): void {
    this.closing = true;
    this.socket?.close(1000, 'MCP client closed');
    if (!this.socket) this.resolveListening?.();
  }

  private async handlePayload(payload: string): Promise<void> {
    const parsed = JSON.parse(payload) as
      | AxMCPJSONRPCMessage
      | AxMCPJSONRPCMessage[];
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    if (Array.isArray(parsed) && this.protocolVersion !== '2025-03-26') {
      throw new Error(
        `JSON-RPC batching is not allowed for MCP ${this.protocolVersion ?? 'before negotiation'}`
      );
    }
    for (const message of messages) {
      if ('id' in message && !('method' in message) && message.id !== null) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          pending.resolve(message as AxMCPJSONRPCResponse<unknown>);
          continue;
        }
      }
      await this.handler?.(message);
    }
  }
}
