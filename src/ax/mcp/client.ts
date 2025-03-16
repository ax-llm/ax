import type { AxFunction } from '../ai/types.js'
import { ColorLog } from '../util/log.js'

import type { AxMCPTransport } from './transport.js'
import type {
  JSONRPCNotification,
  JSONRPCRequest,
  MCPInitializeParams,
  MCPToolsListResult,
} from './types.js'

const colorLog = new ColorLog()

interface AxMCPClientOptions {
  debug?: boolean
}

export class AxMCPClient {
  private functions: AxFunction[] = []
  private requestId = 0
  private capabilities: {
    tools?: boolean
    resources?: boolean
    prompts?: boolean
  } = {}

  constructor(
    private readonly transport: AxMCPTransport,
    private readonly options: Readonly<AxMCPClientOptions> = {}
  ) {}

  async init(): Promise<void> {
    if ('connect' in this.transport) {
      await this.transport.connect?.()
    }

    const res = await this.sendRequest<MCPInitializeParams>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      clientInfo: {
        name: 'AxMCPClient',
        version: '1.0.0',
      },
    } as MCPInitializeParams)

    if (res.capabilities.tools) {
      this.capabilities.tools = true
    }

    if (res.capabilities.resources) {
      this.capabilities.resources = true
    }

    if (res.capabilities.prompts) {
      this.capabilities.prompts = true
    }

    await this.sendNotification('initialized')

    await this.discoverFunctions()
  }

  private async discoverFunctions(): Promise<void> {
    if (!this.capabilities.tools) {
      throw new Error('Tools are not supported')
    }

    const res = await this.sendRequest<MCPToolsListResult>('tools/list')
    this.functions = res.tools.map(
      (fn): AxFunction => ({
        name: fn.name,
        description: fn.description,
        parameters: fn.inputSchema,
        func: async (args) => {
          const res = await this.sendRequest<{
            name: string
            // eslint-disable-next-line functional/functional-parameters
            arguments: unknown
          }>('tools/call', { name: fn.name, arguments: args })

          if ('error' in res) {
            throw new Error((res.error as Error).message)
          }
          if ('result' in res) {
            return res.result
          }
          return null
        },
      })
    )
  }

  async ping() {
    await this.sendRequest('ping')
  }

  toFunction(): AxFunction[] {
    return this.functions
  }

  private async sendRequest<T = unknown>(
    method: string,
    params?: T
  ): Promise<T> {
    const request: JSONRPCRequest<T> = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }

    if (this.options.debug) {
      console.log(
        colorLog.blueBright(
          `> Sending request:\n${JSON.stringify(request, null, 2)}`
        )
      )
    }

    const response = await this.transport.send(request)

    if (this.options.debug) {
      console.log(
        colorLog.greenBright(
          `> Received response:\n${JSON.stringify(response, null, 2)}`
        )
      )
    }

    if ('error' in response) {
      throw new Error(
        `RPC Error ${response.error.code}: ${response.error.message}`
      )
    }
    return response.result as T
  }

  private async sendNotification(
    method: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    if (this.options.debug) {
      console.log(
        '➡️ Sending notification:',
        JSON.stringify(notification, null, 2)
      )
    }

    await this.transport.sendNotification(notification)
  }
}
