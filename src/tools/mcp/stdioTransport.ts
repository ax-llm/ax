import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import readline from 'node:readline';

import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
  AxMCPTransport,
} from '@ax-llm/ax';

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export class AxMCPStdioTransport implements AxMCPTransport {
  private process: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private pendingResponses = new Map<
    string | number,
    {
      resolve: (res: AxMCPJSONRPCResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  private closed = false;
  private closePromise: Promise<void>;
  private messageHandler?: (
    message: Readonly<AxMCPJSONRPCMessage>
  ) => void | Promise<void>;

  constructor(config: Readonly<StdioTransportConfig>) {
    this.process = spawn(config.command, config.args ?? [], {
      env: config.env ? { ...process.env, ...config.env } : process.env,
    });
    this.closePromise = new Promise((resolve) => {
      this.process.once('close', () => {
        this.closeWithError(new Error('MCP server process closed'));
        resolve();
      });
    });
    this.process.once('error', (error) => this.closeWithError(error));
    this.process.once('exit', (code, signal) => {
      this.closeWithError(
        new Error(
          `MCP server process exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}`
        )
      );
    });
    this.process.stdin.on('error', (error) => this.closeWithError(error));
    this.rl = readline.createInterface({ input: this.process.stdout });
    this.rl.on('line', (line) => {
      try {
        const message: AxMCPJSONRPCMessage = JSON.parse(line);
        if ('method' in message) {
          void this.messageHandler?.(message);
          return;
        }
        const response = message as AxMCPJSONRPCResponse;
        const pending =
          response.id === null
            ? undefined
            : this.pendingResponses.get(response.id);
        if (pending) {
          pending.resolve(response);
          if (response.id !== null) this.pendingResponses.delete(response.id);
        } else {
          void this.messageHandler?.(message);
        }
      } catch (_error) {
        // Skip non-JSON lines (might be debug output from the MCP server)
        console.warn('Non-JSON output from MCP server:', line);
      }
    });
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    return new Promise<AxMCPJSONRPCResponse<unknown>>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('MCP server process is not running'));
        return;
      }
      this.pendingResponses.set(message.id, {
        resolve: (res) => resolve(res as AxMCPJSONRPCResponse<unknown>),
        reject,
      });
      void this.writeMessage(message).catch((error: Error) => {
        this.pendingResponses.delete(message.id);
        reject(error);
      });
    });
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    await this.writeMessage(message);
  }

  async sendResponse(message: Readonly<AxMCPJSONRPCResponse>): Promise<void> {
    await this.writeMessage(message);
  }

  setMessageHandler(
    handler: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>
  ): void {
    this.messageHandler = handler;
  }

  async connect(): Promise<void> {
    // Connection is implicit when the process is spawned
    return Promise.resolve();
  }

  /**
   * Terminate the child process and clean up resources
   */
  async terminate(): Promise<void> {
    this.rl.close();
    if (this.closed) return;
    this.process.kill();
    await this.closePromise;
  }

  private async writeMessage(
    message: Readonly<AxMCPJSONRPCMessage>
  ): Promise<void> {
    if (this.closed || this.process.stdin.destroyed) {
      throw new Error('MCP server process is not running');
    }
    await new Promise<void>((resolve, reject) => {
      this.process.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private closeWithError(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pendingResponses.values()) {
      pending.reject(error);
    }
    this.pendingResponses.clear();
  }
}

/**
 * Create a new AxMCPStdioTransport instance
 * @param config Configuration for the stdio transport
 * @returns A new AxMCPStdioTransport instance
 */
export function axCreateMCPStdioTransport(
  config: Readonly<StdioTransportConfig>
): AxMCPStdioTransport {
  return new AxMCPStdioTransport(config);
}
