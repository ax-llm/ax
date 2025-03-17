import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AxMCPClient } from './client.js'
import type { AxMCPTransport } from './transport.js'
import type {
  JSONRPCResponse,
  JSONRPCSuccessResponse,
  MCPFunctionDescription,
} from './types.js'

// Mock the transport
const createMockTransport = () => {
  const mockTransport: AxMCPTransport = {
    send: vi.fn(),
    sendNotification: vi.fn(),
  }
  return mockTransport
}

// Fake transport for testing
class FakeTransport {
  sendResponses: Record<string, JSONRPCResponse<unknown>> = {}
  send = (
    request: Readonly<{ method: string; [key: string]: unknown }>
  ): Promise<JSONRPCResponse<unknown>> => {
    const response = this.sendResponses[request.method]
    if (response) {
      return Promise.resolve(response)
    }
    return Promise.resolve({ jsonrpc: '2.0', id: 'default-id', result: {} })
  }
  sendNotification = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (notification: unknown): Promise<void> => Promise.resolve()
  )
  connect?(): Promise<void> {
    return Promise.resolve()
  }
}

describe('AxMCPClient', () => {
  let mockTransport: AxMCPTransport
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let transport: FakeTransport
  let client: AxMCPClient

  beforeEach(() => {
    mockTransport = createMockTransport()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Setup mock responses
    vi.mocked(mockTransport.send).mockImplementation(async (request) => {
      if (request.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: true,
              resources: true,
              prompts: true,
            },
            serverInfo: {
              name: 'TestServer',
              version: '1.0.0',
            },
          },
        }
      }

      if (request.method === 'tools/list') {
        const tools: MCPFunctionDescription[] = [
          {
            name: 'function1',
            description: 'Description for function 1',
            inputSchema: {
              type: 'object',
              properties: {
                param1: {
                  type: 'string',
                  description: 'Parameter 1',
                },
              },
            },
          },
          {
            name: 'function2',
            description: 'Description for function 2',
            inputSchema: {
              type: 'object',
              properties: {
                param2: {
                  type: 'number',
                  description: 'Parameter 2',
                },
              },
            },
          },
        ]

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            name: 'TestTools',
            description: 'Test tools list',
            tools,
          },
        }
      }

      if (request.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { success: true, data: 'Function result' },
        }
      }

      if (request.method === 'ping') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {},
        }
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {},
      }
    })

    transport = new FakeTransport()

    // Set default responses for init and tools/list
    transport.sendResponses.initialize = {
      jsonrpc: '2.0',
      id: 'init-id',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: true,
          resources: true,
          prompts: false,
        },
      },
    }

    transport.sendResponses['tools/list'] = {
      jsonrpc: '2.0',
      id: 'tools-list-id',
      result: {
        tools: [
          {
            name: 'testFn',
            description: 'Test function',
            inputSchema: {
              properties: { arg: { type: 'string' } },
              required: ['arg'],
              type: 'object',
            },
          },
        ],
      },
    }

    // Default ping response
    transport.sendResponses.ping = {
      jsonrpc: '2.0',
      id: 'ping-id',
      result: {},
    }

    client = new AxMCPClient(transport, { debug: false })
  })

  describe('with mock transport', () => {
    it('should initialize and discover functions', async () => {
      const client = new AxMCPClient(mockTransport)
      await client.init()

      // Verify initialize was called
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'initialize',
        })
      )

      // Verify tools/list was called
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'tools/list',
        })
      )

      // Verify functions were discovered
      const functions = client.toFunction()
      expect(functions).toHaveLength(2)
      expect(functions[0]?.name).toBe('function1')
      expect(functions[1]?.name).toBe('function2')
    })

    it('should apply function overrides', async () => {
      const client = new AxMCPClient(mockTransport, {
        functionOverrides: [
          {
            name: 'function1',
            updates: {
              name: 'renamedFunction1',
              description: 'New description for function 1',
            },
          },
        ],
      })

      await client.init()

      const functions = client.toFunction()
      expect(functions).toHaveLength(2)

      // Check that the override was applied
      const firstFunction = functions[0]
      expect(firstFunction?.name).toBe('renamedFunction1')
      expect(firstFunction?.description).toBe('New description for function 1')

      // Check that the other function was not affected
      const secondFunction = functions[1]
      expect(secondFunction?.name).toBe('function2')
      expect(secondFunction?.description).toBe('Description for function 2')
    })

    it('should use original function name when calling functions', async () => {
      const client = new AxMCPClient(mockTransport, {
        functionOverrides: [
          {
            name: 'function1',
            updates: {
              name: 'renamedFunction1',
            },
          },
        ],
      })

      await client.init()

      const functions = client.toFunction()
      const firstFunction = functions[0]

      if (!firstFunction) {
        throw new Error('Function not found')
      }

      // Call the renamed function
      await firstFunction.func({ param1: 'test' })

      // Verify the original name was used in the call
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'tools/call',
          params: {
            name: 'function1', // Original name, not the renamed one
            arguments: { param1: 'test' },
          },
        })
      )
    })

    it('should log debug information when debug is enabled', async () => {
      const client = new AxMCPClient(mockTransport, { debug: true })
      await client.init()

      // Verify debug logs were printed
      expect(consoleSpy).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sending request')
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Received response')
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Discovered 2 functions')
      )
    })

    it('should not log debug information when debug is disabled', async () => {
      consoleSpy.mockClear()

      const client = new AxMCPClient(mockTransport, { debug: false })
      await client.init()

      // Verify no debug logs were printed
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('should ping the server', async () => {
      const client = new AxMCPClient(mockTransport)
      await client.init()

      await client.ping()

      // Verify ping was called
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'ping',
        })
      )
    })

    it('should throw an error when tools are not supported', async () => {
      // Override the initialize response to indicate tools are not supported
      vi.mocked(mockTransport.send).mockImplementationOnce(async (request) => {
        if (request.method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: false,
              },
              serverInfo: {
                name: 'TestServer',
                version: '1.0.0',
              },
            },
          }
        }
        return { jsonrpc: '2.0', id: request.id, result: {} }
      })

      const client = new AxMCPClient(mockTransport)

      // Expect init to throw an error
      await expect(client.init()).rejects.toThrow('Tools are not supported')
    })

    it('should handle RPC errors', async () => {
      // Override the send method to return an error
      vi.mocked(mockTransport.send).mockImplementationOnce(async () => {
        return {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: 123,
            message: 'Test error',
          },
        } as JSONRPCResponse
      })

      const client = new AxMCPClient(mockTransport)

      // Expect init to throw an error
      await expect(client.init()).rejects.toThrow('RPC Error 123: Test error')
    })

    it('should handle invalid responses', async () => {
      // Override the send method to return an invalid response
      vi.mocked(mockTransport.send).mockImplementationOnce(async () => {
        return {
          jsonrpc: '2.0',
          id: 1,
          // No result or error property
        } as JSONRPCResponse
      })

      const client = new AxMCPClient(mockTransport)

      // Expect init to throw an error
      await expect(client.init()).rejects.toThrow(
        'Invalid response no result or error'
      )
    })
  })

  describe('with fake transport', () => {
    it('init should succeed with correct protocol version and discover functions', async () => {
      await client.init()
      const functions = client.toFunction()
      expect(functions.length).toBe(1)
      expect(functions[0]?.name).toBe('testFn')
    })

    it('init should fail with incorrect protocol version', async () => {
      transport.sendResponses.initialize = {
        jsonrpc: '2.0',
        id: 'initialize-id',
        result: {
          protocolVersion: 'wrong-version',
          capabilities: {
            tools: true,
            resources: true,
            prompts: false,
          },
        },
      }
      await expect(client.init()).rejects.toThrow(/Protocol version mismatch/)
    })

    it('ping should succeed with empty response', async () => {
      await expect(client.ping()).resolves.toBeUndefined()
    })

    it('ping should fail with non-empty response', async () => {
      transport.sendResponses.ping = {
        jsonrpc: '2.0',
        id: 'ping-id',
        result: { unexpected: 'data' },
      }
      await expect(client.ping()).rejects.toThrow(/Unexpected ping response/)
    })

    it('cancelRequest cancels an active pending request', async () => {
      // Override transport.send to return a pending promise
      const pendingPromise = new Promise<JSONRPCSuccessResponse<unknown>>(
        () => {
          // This promise intentionally never resolves
        }
      )
      transport.send = vi.fn(() => pendingPromise)

      // Call a private sendRequest via casting client as any
      const sendRequestPromise = (
        client as unknown as {
          sendRequest(
            method: string,
            params: unknown
          ): Promise<{ id: string; result: unknown }>
        }
      ).sendRequest('longRunningMethod', {})

      // Get the active request id from client.activeRequests
      const activeRequests: Map<string, { reject: (reason: unknown) => void }> =
        (
          client as unknown as {
            activeRequests: Map<string, { reject: (reason: unknown) => void }>
          }
        ).activeRequests
      const activeRequestIds = Array.from(activeRequests.keys())
      expect(activeRequestIds.length).toBeGreaterThan(0)
      const requestId = activeRequestIds[0]

      // Ensure requestId is defined
      if (!requestId) {
        throw new Error('No active request ID found')
      }

      // Cancel the active request
      client.cancelRequest(requestId)

      await expect(sendRequestPromise).rejects.toThrow(
        `Request ${requestId} cancelled`
      )

      // Verify that sendNotification was called for cancellation
      expect(transport.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'notifications/cancelled',
          params: { requestId, reason: 'Client cancelled request' },
        })
      )
    })
  })
})
