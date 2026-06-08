import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from './types.js';

export interface AxMCPTransport {
  /**
   * Sends a JSON-RPC request or notification and returns the response
   * @param message The JSON-RPC request or notification to send
   * @returns A Promise that resolves to the JSON-RPC response
   */
  send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>>;

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
}
