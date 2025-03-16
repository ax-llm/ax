import type {
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types.js'

export interface AxMCPTransport {
  /**
   * Sends a JSON-RPC request or notification and returns the response
   * @param message The JSON-RPC request or notification to send
   * @returns A Promise that resolves to the JSON-RPC response
   */
  send(
    message: Readonly<JSONRPCRequest<unknown>>
  ): Promise<JSONRPCResponse<unknown>>

  /**
   * Sends a JSON-RPC notification
   * @param message The JSON-RPC notification to send
   */
  sendNotification(message: Readonly<JSONRPCNotification>): Promise<void>

  /**
   * Connects to the transport if needed
   * This method is optional and only required for transports that need connection setup
   */
  connect?(): Promise<void>
}
