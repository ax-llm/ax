import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
  AxMCPLoggingLevel,
} from './types.js';

export interface AxMCPRequestOptions {
  signal?: AbortSignal;
  /** Additional headers for this request when the transport supports them. */
  headers?: Readonly<Record<string, string>>;
  /** Overrides the desired modern per-request logging level. */
  logLevel?: AxMCPLoggingLevel;
}

export type AxMCPEra = 'modern' | 'legacy';

export interface AxMCPListeningHandle {
  /** Resolves when listening stops and rejects when the listener fails. */
  readonly done: Promise<void>;
  close(): void | Promise<void>;
}

export interface AxMCPListeningOptions {
  signal?: AbortSignal;
}

export type AxMCPTransportLifecycleState = 'reconnected';

export interface AxMCPTransport {
  /** Indicates whether optimizer/evaluation use can cause live side effects. */
  readonly evaluationMode?: 'live' | 'record' | 'replay' | 'sandbox';
  /** Transport-level era preference, such as WebSocket's legacy-only binding. */
  readonly eraHint?: AxMCPEra;
  /** Stable key used to cache era detection, normally the HTTP origin. */
  readonly eraCacheKey?: string;
  /** Applies the client-selected protocol era to transport behavior. */
  setEra?(era: AxMCPEra): void;
  /** One-shot metadata for the most recently completed request ID. */
  takeRequestMetadata?(
    id: string | number
  ): Readonly<{ retryCount?: number }> | undefined;
  /**
   * Sends a JSON-RPC request or notification and returns the response
   * @param message The JSON-RPC request or notification to send
   * @returns A Promise that resolves to the JSON-RPC response
   */
  send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPJSONRPCResponse<unknown>>;

  /** Sends one version-gated JSON-RPC batch on transports that support it. */
  sendBatch?(
    messages: readonly Readonly<AxMCPJSONRPCRequest<unknown>>[],
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<readonly AxMCPJSONRPCResponse<unknown>[]>;

  /**
   * Sends a JSON-RPC notification
   * @param message The JSON-RPC notification to send
   */
  sendNotification(message: Readonly<AxMCPJSONRPCNotification>): Promise<void>;

  /**
   * Sends a JSON-RPC response for a server-initiated request.
   * Transports that cannot receive server requests do not need to implement it.
   */
  sendResponse?(message: Readonly<AxMCPJSONRPCResponse>): Promise<void>;

  /**
   * Registers a handler for server-initiated JSON-RPC requests and
   * notifications that arrive outside a direct client request response.
   */
  setMessageHandler?(
    handler: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>
  ): void;

  /** Registers transport lifecycle events that require client-level recovery. */
  setLifecycleHandler?(
    handler: (state: AxMCPTransportLifecycleState) => void | Promise<void>
  ): void;

  /**
   * Stores the negotiated MCP protocol version for transports that must emit
   * it on later frames or HTTP requests.
   */
  setProtocolVersion?(protocolVersion: string): void;

  /**
   * Connects to the transport if needed
   * This method is optional and only required for transports that need connection setup
   */
  connect?(): Promise<void>;

  /** Starts a nonblocking server-message listener when the transport needs one. */
  startListening?(
    options?: Readonly<AxMCPListeningOptions>
  ): AxMCPListeningHandle | Promise<AxMCPListeningHandle>;

  /** Opens a long-lived stream carried by a specific JSON-RPC request. */
  openRequestStream?(
    request: Readonly<AxMCPJSONRPCRequest<unknown>>,
    options?: Readonly<AxMCPListeningOptions>
  ): AxMCPListeningHandle | Promise<AxMCPListeningHandle>;

  /** Terminates a negotiated transport session when supported. */
  terminateSession?(): Promise<void>;

  /** Releases transport resources. Implementations should be idempotent. */
  close?(): void | Promise<void>;
}
