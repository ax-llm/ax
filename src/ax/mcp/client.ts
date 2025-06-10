import { v4 as uuidv4 } from 'uuid'

import type { AxFunction, AxLoggerFunction } from '../ai/types.js'

import type { AxMCPTransport } from './transport.js'
import type {
  JSONRPCNotification,
  JSONRPCRequest,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPToolsListResult,
} from './types.js'

/**
 * Configuration for overriding function properties
 */
interface FunctionOverride {
  /** Original function name to override */
  name: string
  /** Updates to apply to the function */
  updates: {
    /** Alternative name for the function */
    name?: string
    /** Alternative description for the function */
    description?: string
  }
}

/**
 * Options for the MCP client
 */
interface AxMCPClientOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Logger function for debug output */
  logger?: AxLoggerFunction
  /**
   * List of function overrides
   * Use this to provide alternative names and descriptions for functions
   * while preserving their original functionality
   *
   * Example:
   * ```
   * functionOverrides: [
   *   {
   *     name: "original-function-name",
   *     updates: {
   *       name: "new-function-name",
   *       description: "New function description"
   *     }
   *   }
   * ]
   * ```
   */
  functionOverrides?: FunctionOverride[]
}

export class AxMCPClient {
  private functions: AxFunction[] = []
  private activeRequests: Map<string, { reject: (reason: unknown) => void }> =
    new Map()
  private capabilities: {
    tools?: boolean
    resources?: boolean
    prompts?: boolean
  } = {}
  private logger: AxLoggerFunction

  constructor(
    private readonly transport: AxMCPTransport,
    private readonly options: Readonly<AxMCPClientOptions> = {}
  ) {
    this.logger = options.logger ?? ((message: string) => console.log(message))
  }

  async init(): Promise<void> {
    if ('connect' in this.transport) {
      await this.transport.connect?.()
    }

    const { result: res } = await this.sendRequest<
      MCPInitializeParams,
      MCPInitializeResult
    >('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      clientInfo: {
        name: 'AxMCPClient',
        version: '1.0.0',
      },
    })

    const expectedProtocolVersion = '2024-11-05'
    if (res.protocolVersion !== expectedProtocolVersion) {
      throw new Error(
        `Protocol version mismatch. Expected ${expectedProtocolVersion} but got ${res.protocolVersion}`
      )
    }

    if (res.capabilities.tools) {
      this.capabilities.tools = true
    }

    if (res.capabilities.resources) {
      this.capabilities.resources = true
    }

    if (res.capabilities.prompts) {
      this.capabilities.prompts = true
    }

    await this.sendNotification('notifications/initialized')

    await this.discoverFunctions()
  }

  private async discoverFunctions(): Promise<void> {
    if (!this.capabilities.tools) {
      throw new Error('Tools are not supported')
    }

    const { result: res } = await this.sendRequest<
      undefined,
      MCPToolsListResult
    >('tools/list')

    this.functions = res.tools.map((fn): AxFunction => {
      // Check if there's an override for this function
      const override = this.options.functionOverrides?.find(
        (o) => o.name === fn.name
      )

      const parameters = fn.inputSchema.properties
        ? {
            properties: fn.inputSchema.properties,
            required: fn.inputSchema.required ?? [],
            type: fn.inputSchema.type,
          }
        : undefined

      return {
        name: override?.updates.name ?? fn.name,
        description: override?.updates.description ?? fn.description,
        parameters,
        func: async (args) => {
          // Always use original name when calling the function
          const { result } = await this.sendRequest<{
            name: string
            // eslint-disable-next-line functional/functional-parameters
            arguments: unknown
          }>('tools/call', { name: fn.name, arguments: args })
          return result
        },
      }
    })

    if (this.options.debug) {
      this.logger(`> Discovered ${this.functions.length} functions:`, {
        tags: ['discovery'],
      })
      for (const fn of this.functions) {
        this.logger(`  - ${fn.name}: ${fn.description}`, {
          tags: ['discovery'],
        })
      }
    }
  }

  async ping(timeout = 3000): Promise<void> {
    const pingPromise = this.sendRequest('ping')
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Ping response timeout exceeded')),
        timeout
      )
    )
    const response = (await Promise.race([pingPromise, timeoutPromise])) as {
      result: unknown
    }
    const { result } = response
    if (
      typeof result !== 'object' ||
      result === null ||
      Object.keys(result).length !== 0
    ) {
      throw new Error(`Unexpected ping response: ${JSON.stringify(result)}`)
    }
  }

  toFunction(): AxFunction[] {
    return this.functions
  }

  cancelRequest(id: string): void {
    if (this.activeRequests.has(id)) {
      this.sendNotification('notifications/cancelled', {
        requestId: id,
        reason: 'Client cancelled request',
      })
      const entry = this.activeRequests.get(id)
      if (entry) {
        entry.reject(new Error(`Request ${id} cancelled`))
      }
      this.activeRequests.delete(id)
    }
  }

  private async sendRequest<T = unknown, R = unknown>(
    method: string,
    params: T = {} as T
  ): Promise<{ id: string; result: R }> {
    const requestId = uuidv4()
    const request: JSONRPCRequest<T> = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    }

    if (this.options.debug) {
      this.logger(
        `> Sending request ${requestId}:\n${JSON.stringify(request, null, 2)}`,
        { tags: ['requestStart'] }
      )
    }

    const responsePromise = new Promise<{ result: R }>((resolve, reject) => {
      this.activeRequests.set(requestId, { reject })
      this.transport
        .send(request)
        .then((res: unknown) => {
          this.activeRequests.delete(requestId)
          if (this.options.debug) {
            this.logger(
              `> Received response for request ${requestId}:\n${JSON.stringify(res, null, 2)}`,
              { tags: ['responseContent'] }
            )
          }
          if (res !== null && typeof res === 'object' && 'error' in res) {
            const errorObj = res as { error: { code: number; message: string } }
            reject(
              new Error(
                `RPC Error ${errorObj.error.code}: ${errorObj.error.message}`
              )
            )
          } else if (
            res !== null &&
            typeof res === 'object' &&
            'result' in res
          ) {
            resolve({ result: (res as { result: R }).result })
          } else {
            reject(new Error('Invalid response no result or error'))
          }
        })
        .catch((err: unknown) => {
          this.activeRequests.delete(requestId)
          reject(err)
        })
    })

    const { result } = await responsePromise
    return { id: requestId, result }
  }

  private async sendNotification(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<void> {
    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    if (this.options.debug) {
      this.logger(
        `➡️ Sending notification: ${JSON.stringify(notification, null, 2)}`,
        { tags: ['requestStart'] }
      )
    }

    await this.transport.sendNotification(notification)
  }
}
