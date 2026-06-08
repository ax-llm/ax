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
    (res: AxMCPJSONRPCResponse) => void
  >();
  private messageHandler?: (
    message: Readonly<AxMCPJSONRPCMessage>
  ) => void | Promise<void>;

  constructor(config: Readonly<StdioTransportConfig>) {
    this.process = spawn(config.command, config.args ?? [], {
      env: config.env ? { ...process.env, ...config.env } : process.env,
    });
    this.rl = readline.createInterface({ input: this.process.stdout });
    this.rl.on('line', (line) => {
      try {
        const message: AxMCPJSONRPCMessage = JSON.parse(line);
        if ('method' in message) {
          void this.messageHandler?.(message);
          return;
        }
        const response = message as AxMCPJSONRPCResponse;
        const resolver =
          response.id === null
            ? undefined
            : this.pendingResponses.get(response.id);
        if (resolver) {
          resolver(response);
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
    return new Promise<AxMCPJSONRPCResponse<unknown>>((resolve) => {
      this.pendingResponses.set(message.id, (res: AxMCPJSONRPCResponse) => {
        resolve(res as AxMCPJSONRPCResponse<unknown>);
      });
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async sendResponse(message: Readonly<AxMCPJSONRPCResponse>): Promise<void> {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
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
    this.process.kill();
    return new Promise((resolve) => {
      this.process.on('exit', () => resolve());
    });
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
