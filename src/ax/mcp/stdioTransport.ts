import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import readline from 'node:readline'

import type { AxMCPTransport } from './transport.js'
import type {
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types.js'

interface StdioTransportConfig {
  command: string
  args?: string[]
  env?: NodeJS.ProcessEnv
}

export class AxMCPStdioTransport implements AxMCPTransport {
  private process: ChildProcessWithoutNullStreams
  private rl: readline.Interface
  private pendingResponses = new Map<
    string | number,
    (res: JSONRPCResponse) => void
  >()

  constructor(config: Readonly<StdioTransportConfig>) {
    this.process = spawn(config.command, config.args ?? [], {
      env: config.env ? { ...process.env, ...config.env } : process.env,
    })
    this.rl = readline.createInterface({ input: this.process.stdout })
    this.rl.on('line', (line) => {
      const response: JSONRPCResponse = JSON.parse(line)
      const resolver = this.pendingResponses.get(response.id)
      if (resolver) {
        resolver(response)
        this.pendingResponses.delete(response.id)
      }
    })
  }

  async send(
    message: Readonly<JSONRPCRequest<unknown>>
  ): Promise<JSONRPCResponse<unknown>> {
    return new Promise<JSONRPCResponse<unknown>>((resolve) => {
      this.pendingResponses.set(message.id, (res: JSONRPCResponse) => {
        resolve(res as JSONRPCResponse<unknown>)
      })
      this.process.stdin.write(`${JSON.stringify(message)}\n`)
    })
  }

  async sendNotification(
    message: Readonly<JSONRPCNotification>
  ): Promise<void> {
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  async connect(): Promise<void> {
    // Existing implementation
  }
}
