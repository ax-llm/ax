import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AxMCPClient } from './client.js';
import type { AxMCPTransport } from './transport.js';
import type {
  AxMCPFunctionDescription,
  AxMCPJSONRPCResponse,
  AxMCPJSONRPCSuccessResponse,
  AxMCPPrompt,
  AxMCPPromptGetResult,
  AxMCPResource,
  AxMCPResourceTemplate,
} from './types.js';

// Mock the transport
const createMockTransport = () => {
  const mockTransport: AxMCPTransport = {
    send: vi.fn(),
    sendNotification: vi.fn(),
  };
  return mockTransport;
};

// Fake transport for testing
class FakeTransport {
  sendResponses: Record<string, AxMCPJSONRPCResponse<unknown>> = {};
  send = (
    request: Readonly<{ method: string; [key: string]: unknown }>
  ): Promise<AxMCPJSONRPCResponse<unknown>> => {
    const response = this.sendResponses[request.method];
    if (response) {
      return Promise.resolve(response);
    }
    return Promise.resolve({ jsonrpc: '2.0', id: 'default-id', result: {} });
  };
  sendNotification = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_notification: unknown): Promise<void> => Promise.resolve()
  );
  connect?(): Promise<void> {
    return Promise.resolve();
  }
}

describe('AxMCPClient', () => {
  let mockTransport: AxMCPTransport;
  let _consoleSpy: ReturnType<typeof vi.spyOn>;
  let transport: FakeTransport;
  let client: AxMCPClient;

  beforeEach(() => {
    mockTransport = createMockTransport();
    _consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

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
        };
      }

      if (request.method === 'tools/list') {
        const tools: AxMCPFunctionDescription[] = [
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
        ];

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            name: 'TestTools',
            description: 'Test tools list',
            tools,
          },
        };
      }

      if (request.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { success: true, data: 'Function result' },
        };
      }

      if (request.method === 'ping') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {},
        };
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {},
      };
    });

    transport = new FakeTransport();

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
    };

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
    };

    // Default ping response
    transport.sendResponses.ping = {
      jsonrpc: '2.0',
      id: 'ping-id',
      result: {},
    };

    client = new AxMCPClient(transport, { debug: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('with mock transport', () => {
    it('should initialize and discover functions', async () => {
      const client = new AxMCPClient(mockTransport);
      await client.init();

      // Verify initialize was called
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'initialize',
        })
      );

      // Verify tools/list was called
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'tools/list',
        })
      );

      // Verify functions were discovered
      const functions = client.toFunction();
      expect(functions).toHaveLength(2);
      expect(functions[0]?.name).toBe('function1');
      expect(functions[1]?.name).toBe('function2');
    });

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
      });

      await client.init();

      const functions = client.toFunction();
      expect(functions).toHaveLength(2);

      // Check that the override was applied
      const firstFunction = functions[0];
      expect(firstFunction?.name).toBe('renamedFunction1');
      expect(firstFunction?.description).toBe('New description for function 1');

      // Check that the other function was not affected
      const secondFunction = functions[1];
      expect(secondFunction?.name).toBe('function2');
      expect(secondFunction?.description).toBe('Description for function 2');
    });

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
      });

      await client.init();

      const functions = client.toFunction();
      const firstFunction = functions[0];

      if (!firstFunction) {
        throw new Error('Function not found');
      }

      // Call the renamed function
      await firstFunction.func({ param1: 'test' });

      // Verify the original name was used in the call
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'tools/call',
          params: {
            name: 'function1', // Original name, not the renamed one
            arguments: { param1: 'test' },
          },
        })
      );
    });

    it('should ping the server', async () => {
      const client = new AxMCPClient(mockTransport);
      await client.init();

      await client.ping();

      // Verify ping was called
      expect(mockTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'ping',
        })
      );
    });

    it('should succeed when tools are not supported', async () => {
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
          };
        }
        return { jsonrpc: '2.0', id: request.id, result: {} };
      });

      const client = new AxMCPClient(mockTransport);
      await client.init();

      // Client should have no functions since tools are not supported
      expect(client.toFunction()).toHaveLength(0);
      expect(client.hasToolsCapability()).toBe(false);
    });

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
        } as AxMCPJSONRPCResponse;
      });

      const client = new AxMCPClient(mockTransport);

      // Expect init to throw an error
      await expect(client.init()).rejects.toThrow('RPC Error 123: Test error');
    });

    it('should handle invalid responses', async () => {
      // Override the send method to return an invalid response
      vi.mocked(mockTransport.send).mockImplementationOnce(async () => {
        return {
          jsonrpc: '2.0',
          id: 1,
          // No result or error property
        } as AxMCPJSONRPCResponse;
      });

      const client = new AxMCPClient(mockTransport);

      // Expect init to throw an error
      await expect(client.init()).rejects.toThrow(
        'Invalid response no result or error'
      );
    });
  });

  describe('with fake transport', () => {
    it('init should succeed with correct protocol version and discover functions', async () => {
      await client.init();
      const functions = client.toFunction();
      expect(functions.length).toBe(1);
      expect(functions[0]?.name).toBe('testFn');
    });

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
      };
      await expect(client.init()).rejects.toThrow(/Protocol version mismatch/);
    });

    it('ping should succeed with empty response', async () => {
      await expect(client.ping()).resolves.toBeUndefined();
    });

    it('ping should fail with non-empty response', async () => {
      transport.sendResponses.ping = {
        jsonrpc: '2.0',
        id: 'ping-id',
        result: { unexpected: 'data' },
      };
      await expect(client.ping()).rejects.toThrow(/Unexpected ping response/);
    });

    it('cancelRequest cancels an active pending request', async () => {
      // Override transport.send to return a pending promise
      const pendingPromise = new Promise<AxMCPJSONRPCSuccessResponse<unknown>>(
        () => {
          // This promise intentionally never resolves
        }
      );
      transport.send = vi.fn(() => pendingPromise);

      // Call a private sendRequest via casting client as any
      const sendRequestPromise = (
        client as unknown as {
          sendRequest(
            method: string,
            params: unknown
          ): Promise<{ id: string; result: unknown }>;
        }
      ).sendRequest('longRunningMethod', {});

      // Get the active request id from client.activeRequests
      const activeRequests: Map<string, { reject: (reason: unknown) => void }> =
        (
          client as unknown as {
            activeRequests: Map<string, { reject: (reason: unknown) => void }>;
          }
        ).activeRequests;
      const activeRequestIds = Array.from(activeRequests.keys());
      expect(activeRequestIds.length).toBeGreaterThan(0);
      const requestId = activeRequestIds[0];

      // Ensure requestId is defined
      if (!requestId) {
        throw new Error('No active request ID found');
      }

      // Cancel the active request
      client.cancelRequest(requestId);

      await expect(sendRequestPromise).rejects.toThrow(
        `Request ${requestId} cancelled`
      );

      // Verify that sendNotification was called for cancellation
      expect(transport.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'notifications/cancelled',
          params: { requestId, reason: 'Client cancelled request' },
        })
      );
    });
  });

  describe('capabilities', () => {
    it('should return capabilities from getCapabilities', async () => {
      await client.init();
      const caps = client.getCapabilities();
      expect(caps).toEqual({
        tools: true,
        resources: true,
        prompts: false,
      });
    });

    it('should return individual capability checks', async () => {
      await client.init();
      expect(client.hasToolsCapability()).toBe(true);
      expect(client.hasResourcesCapability()).toBe(true);
      expect(client.hasPromptsCapability()).toBe(false);
    });
  });

  describe('prompts', () => {
    let promptsEnabledClient: AxMCPClient;
    let promptsTransport: FakeTransport;

    beforeEach(() => {
      promptsTransport = new FakeTransport();

      // Set up responses with prompts enabled
      promptsTransport.sendResponses.initialize = {
        jsonrpc: '2.0',
        id: 'init-id',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: true,
            resources: false,
            prompts: true,
          },
        },
      };

      promptsTransport.sendResponses['tools/list'] = {
        jsonrpc: '2.0',
        id: 'tools-list-id',
        result: {
          tools: [],
        },
      };

      promptsEnabledClient = new AxMCPClient(promptsTransport, {
        debug: false,
      });
    });

    it('should throw error when prompts not supported', async () => {
      await client.init();
      await expect(client.listPrompts()).rejects.toThrow(
        'Prompts are not supported'
      );
    });

    it('should list prompts when capability is enabled', async () => {
      const prompts: AxMCPPrompt[] = [
        {
          name: 'greeting',
          description: 'A greeting prompt',
          arguments: [
            { name: 'name', description: 'Name to greet', required: true },
          ],
        },
        {
          name: 'farewell',
          description: 'A farewell prompt',
        },
      ];

      // Set up response without cursor for init() to complete
      promptsTransport.sendResponses['prompts/list'] = {
        jsonrpc: '2.0',
        id: 'prompts-list-id',
        result: {
          prompts,
        },
      };

      await promptsEnabledClient.init();

      // Now update response to include cursor for testing listPrompts
      promptsTransport.sendResponses['prompts/list'] = {
        jsonrpc: '2.0',
        id: 'prompts-list-id',
        result: {
          prompts,
          nextCursor: 'cursor123',
        },
      };

      const result = await promptsEnabledClient.listPrompts();

      expect(result.prompts).toHaveLength(2);
      expect(result.prompts[0]?.name).toBe('greeting');
      expect(result.prompts[1]?.name).toBe('farewell');
      expect(result.nextCursor).toBe('cursor123');
    });

    it('should list prompts with cursor', async () => {
      promptsTransport.sendResponses['prompts/list'] = {
        jsonrpc: '2.0',
        id: 'prompts-list-id',
        result: {
          prompts: [],
        },
      };

      const originalSend = promptsTransport.send.bind(promptsTransport);
      promptsTransport.send = vi.fn((request) => {
        if (
          request.method === 'prompts/list' &&
          (request as { params?: { cursor?: string } }).params?.cursor ===
            'cursor123'
        ) {
          return Promise.resolve({
            jsonrpc: '2.0',
            id: 'prompts-list-id',
            result: {
              prompts: [{ name: 'next-page-prompt' }],
            },
          });
        }
        return originalSend(request);
      });

      await promptsEnabledClient.init();
      const result = await promptsEnabledClient.listPrompts('cursor123');

      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]?.name).toBe('next-page-prompt');
    });

    it('should get prompt with arguments', async () => {
      const promptResult: AxMCPPromptGetResult = {
        description: 'A greeting prompt',
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: 'Hello, John!' },
          },
          {
            role: 'assistant',
            content: { type: 'text', text: 'Hello! How can I help you today?' },
          },
        ],
      };

      const originalSend = promptsTransport.send.bind(promptsTransport);
      promptsTransport.send = vi.fn((request) => {
        if (request.method === 'prompts/get') {
          const params = (
            request as {
              params: { name: string; arguments?: Record<string, string> };
            }
          ).params;
          expect(params.name).toBe('greeting');
          expect(params.arguments).toEqual({ name: 'John' });
          return Promise.resolve({
            jsonrpc: '2.0',
            id: 'prompts-get-id',
            result: promptResult,
          });
        }
        return originalSend(request);
      });

      await promptsEnabledClient.init();
      const result = await promptsEnabledClient.getPrompt('greeting', {
        name: 'John',
      });

      expect(result.description).toBe('A greeting prompt');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.role).toBe('user');
      expect(result.messages[1]?.role).toBe('assistant');
    });

    it('should throw error when getting prompt without capability', async () => {
      await client.init();
      await expect(client.getPrompt('test')).rejects.toThrow(
        'Prompts are not supported'
      );
    });

    it('should include prompt functions in toFunction()', async () => {
      const prompts: AxMCPPrompt[] = [
        {
          name: 'greeting',
          description: 'A greeting prompt',
          arguments: [
            { name: 'name', description: 'Name to greet', required: true },
            { name: 'style', description: 'Greeting style', required: false },
          ],
        },
        {
          name: 'farewell',
          description: 'A farewell prompt',
        },
      ];

      promptsTransport.sendResponses['prompts/list'] = {
        jsonrpc: '2.0',
        id: 'prompts-list-id',
        result: {
          prompts,
        },
      };

      await promptsEnabledClient.init();
      const functions = promptsEnabledClient.toFunction();

      // Should have prompt functions
      const promptFns = functions.filter((f) => f.name.startsWith('prompt_'));
      expect(promptFns).toHaveLength(2);

      const greetingFn = promptFns.find((f) => f.name === 'prompt_greeting');
      expect(greetingFn).toBeDefined();
      expect(greetingFn?.description).toBe('A greeting prompt');
      expect(greetingFn?.parameters).toBeDefined();
      expect(greetingFn?.parameters?.required).toEqual(['name']);

      const farewellFn = promptFns.find((f) => f.name === 'prompt_farewell');
      expect(farewellFn).toBeDefined();
      expect(farewellFn?.description).toBe('A farewell prompt');
      expect(farewellFn?.parameters).toBeUndefined();
    });

    it('should execute prompt function and return formatted messages', async () => {
      const prompts: AxMCPPrompt[] = [
        {
          name: 'greeting',
          description: 'A greeting prompt',
          arguments: [{ name: 'name', required: true }],
        },
      ];

      promptsTransport.sendResponses['prompts/list'] = {
        jsonrpc: '2.0',
        id: 'prompts-list-id',
        result: { prompts },
      };

      const promptResult: AxMCPPromptGetResult = {
        messages: [
          { role: 'user', content: { type: 'text', text: 'Hello, John!' } },
          {
            role: 'assistant',
            content: { type: 'text', text: 'Greetings! How may I assist you?' },
          },
        ],
      };

      const originalSend = promptsTransport.send.bind(promptsTransport);
      promptsTransport.send = vi.fn((request) => {
        if (request.method === 'prompts/get') {
          return Promise.resolve({
            jsonrpc: '2.0',
            id: 'prompts-get-id',
            result: promptResult,
          });
        }
        return originalSend(request);
      });

      await promptsEnabledClient.init();
      const functions = promptsEnabledClient.toFunction();
      const greetingFn = functions.find((f) => f.name === 'prompt_greeting');

      const result = await greetingFn?.func({ name: 'John' });
      expect(result).toBe(
        'User: Hello, John!\n\nAssistant: Greetings! How may I assist you?'
      );
    });

    it('should handle pagination when discovering prompts', async () => {
      const originalSend = promptsTransport.send.bind(promptsTransport);
      let callCount = 0;

      promptsTransport.send = vi.fn((request) => {
        if (request.method === 'prompts/list') {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              jsonrpc: '2.0',
              id: 'prompts-list-id-1',
              result: {
                prompts: [{ name: 'prompt1', description: 'First prompt' }],
                nextCursor: 'page2',
              },
            });
          } else {
            return Promise.resolve({
              jsonrpc: '2.0',
              id: 'prompts-list-id-2',
              result: {
                prompts: [{ name: 'prompt2', description: 'Second prompt' }],
              },
            });
          }
        }
        return originalSend(request);
      });

      await promptsEnabledClient.init();
      const functions = promptsEnabledClient.toFunction();
      const promptFns = functions.filter((f) => f.name.startsWith('prompt_'));

      expect(promptFns).toHaveLength(2);
      expect(promptFns.map((f) => f.name)).toContain('prompt_prompt1');
      expect(promptFns.map((f) => f.name)).toContain('prompt_prompt2');
    });
  });

  describe('resources', () => {
    let resourcesEnabledClient: AxMCPClient;
    let resourcesTransport: FakeTransport;

    beforeEach(() => {
      resourcesTransport = new FakeTransport();

      // Set up responses with resources enabled
      resourcesTransport.sendResponses.initialize = {
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
      };

      resourcesTransport.sendResponses['tools/list'] = {
        jsonrpc: '2.0',
        id: 'tools-list-id',
        result: {
          tools: [],
        },
      };

      resourcesEnabledClient = new AxMCPClient(resourcesTransport, {
        debug: false,
      });
    });

    it('should throw error when resources not supported', async () => {
      // Create client without resources capability
      const noResourcesTransport = new FakeTransport();
      noResourcesTransport.sendResponses.initialize = {
        jsonrpc: '2.0',
        id: 'init-id',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: true,
            resources: false,
            prompts: false,
          },
        },
      };
      noResourcesTransport.sendResponses['tools/list'] = {
        jsonrpc: '2.0',
        id: 'tools-list-id',
        result: { tools: [] },
      };

      const noResourcesClient = new AxMCPClient(noResourcesTransport, {
        debug: false,
      });
      await noResourcesClient.init();

      await expect(noResourcesClient.listResources()).rejects.toThrow(
        'Resources are not supported'
      );
    });

    it('should list resources when capability is enabled', async () => {
      const resources: AxMCPResource[] = [
        {
          uri: 'file:///path/to/file.txt',
          name: 'file.txt',
          description: 'A text file',
          mimeType: 'text/plain',
        },
        {
          uri: 'file:///path/to/image.png',
          name: 'image.png',
          mimeType: 'image/png',
        },
      ];

      // Set up response without cursor for init() to complete
      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: {
          resources,
        },
      };

      await resourcesEnabledClient.init();

      // Now update response to include cursor for testing listResources
      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: {
          resources,
          nextCursor: 'next-page',
        },
      };

      const result = await resourcesEnabledClient.listResources();

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]?.uri).toBe('file:///path/to/file.txt');
      expect(result.resources[0]?.name).toBe('file.txt');
      expect(result.resources[1]?.mimeType).toBe('image/png');
      expect(result.nextCursor).toBe('next-page');
    });

    it('should list resource templates', async () => {
      const templates: AxMCPResourceTemplate[] = [
        {
          uriTemplate: 'file:///{path}',
          name: 'File template',
          description: 'Access files by path',
        },
        {
          uriTemplate: 'db://{table}/{id}',
          name: 'Database record',
          mimeType: 'application/json',
        },
      ];

      resourcesTransport.sendResponses['resources/templates/list'] = {
        jsonrpc: '2.0',
        id: 'templates-list-id',
        result: {
          resourceTemplates: templates,
        },
      };

      await resourcesEnabledClient.init();
      const result = await resourcesEnabledClient.listResourceTemplates();

      expect(result.resourceTemplates).toHaveLength(2);
      expect(result.resourceTemplates[0]?.uriTemplate).toBe('file:///{path}');
      expect(result.resourceTemplates[1]?.name).toBe('Database record');
    });

    it('should read text resource', async () => {
      resourcesTransport.sendResponses['resources/read'] = {
        jsonrpc: '2.0',
        id: 'resources-read-id',
        result: {
          contents: [
            {
              uri: 'file:///path/to/file.txt',
              mimeType: 'text/plain',
              text: 'Hello, World!',
            },
          ],
        },
      };

      await resourcesEnabledClient.init();
      const result = await resourcesEnabledClient.readResource(
        'file:///path/to/file.txt'
      );

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toHaveProperty('text', 'Hello, World!');
    });

    it('should read blob resource', async () => {
      resourcesTransport.sendResponses['resources/read'] = {
        jsonrpc: '2.0',
        id: 'resources-read-id',
        result: {
          contents: [
            {
              uri: 'file:///path/to/image.png',
              mimeType: 'image/png',
              blob: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
            },
          ],
        },
      };

      await resourcesEnabledClient.init();
      const result = await resourcesEnabledClient.readResource(
        'file:///path/to/image.png'
      );

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toHaveProperty('blob');
      expect(result.contents[0]).toHaveProperty('mimeType', 'image/png');
    });

    it('should subscribe to resource', async () => {
      const originalSend = resourcesTransport.send.bind(resourcesTransport);
      resourcesTransport.send = vi.fn((request) => {
        if (request.method === 'resources/subscribe') {
          const params = (request as { params: { uri: string } }).params;
          expect(params.uri).toBe('file:///path/to/watched.txt');
          return Promise.resolve({
            jsonrpc: '2.0',
            id: 'subscribe-id',
            result: {},
          });
        }
        return originalSend(request);
      });

      await resourcesEnabledClient.init();
      await expect(
        resourcesEnabledClient.subscribeResource('file:///path/to/watched.txt')
      ).resolves.toBeUndefined();
    });

    it('should unsubscribe from resource', async () => {
      const originalSend = resourcesTransport.send.bind(resourcesTransport);
      resourcesTransport.send = vi.fn((request) => {
        if (request.method === 'resources/unsubscribe') {
          const params = (request as { params: { uri: string } }).params;
          expect(params.uri).toBe('file:///path/to/watched.txt');
          return Promise.resolve({
            jsonrpc: '2.0',
            id: 'unsubscribe-id',
            result: {},
          });
        }
        return originalSend(request);
      });

      await resourcesEnabledClient.init();
      await expect(
        resourcesEnabledClient.unsubscribeResource(
          'file:///path/to/watched.txt'
        )
      ).resolves.toBeUndefined();
    });

    it('should throw error for subscribe without capability', async () => {
      const noResourcesTransport = new FakeTransport();
      noResourcesTransport.sendResponses.initialize = {
        jsonrpc: '2.0',
        id: 'init-id',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: true,
            resources: false,
            prompts: false,
          },
        },
      };
      noResourcesTransport.sendResponses['tools/list'] = {
        jsonrpc: '2.0',
        id: 'tools-list-id',
        result: { tools: [] },
      };

      const noResourcesClient = new AxMCPClient(noResourcesTransport, {
        debug: false,
      });
      await noResourcesClient.init();

      await expect(
        noResourcesClient.subscribeResource('file:///test')
      ).rejects.toThrow('Resources are not supported');
      await expect(
        noResourcesClient.unsubscribeResource('file:///test')
      ).rejects.toThrow('Resources are not supported');
      await expect(
        noResourcesClient.readResource('file:///test')
      ).rejects.toThrow('Resources are not supported');
      await expect(noResourcesClient.listResourceTemplates()).rejects.toThrow(
        'Resources are not supported'
      );
    });

    it('should include resource functions in toFunction()', async () => {
      const resources: AxMCPResource[] = [
        {
          uri: 'file:///config.json',
          name: 'config.json',
          description: 'Configuration file',
        },
        {
          uri: 'file:///data/users.csv',
          name: 'users.csv',
        },
      ];

      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: { resources },
      };

      resourcesTransport.sendResponses['resources/templates/list'] = {
        jsonrpc: '2.0',
        id: 'templates-list-id',
        result: { resourceTemplates: [] },
      };

      await resourcesEnabledClient.init();
      const functions = resourcesEnabledClient.toFunction();

      const resourceFns = functions.filter((f) =>
        f.name.startsWith('resource_')
      );
      expect(resourceFns).toHaveLength(2);

      const configFn = resourceFns.find(
        (f) => f.name === 'resource_config_json'
      );
      expect(configFn).toBeDefined();
      expect(configFn?.description).toBe('Configuration file');
      expect(configFn?.parameters).toBeUndefined();

      const usersFn = resourceFns.find((f) => f.name === 'resource_users_csv');
      expect(usersFn).toBeDefined();
      expect(usersFn?.description).toBe('Read users.csv');
    });

    it('should include resource template functions with parameters', async () => {
      const templates: AxMCPResourceTemplate[] = [
        {
          uriTemplate: 'db://{database}/{table}',
          name: 'database-table',
          description: 'Access database tables',
        },
      ];

      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: { resources: [] },
      };

      resourcesTransport.sendResponses['resources/templates/list'] = {
        jsonrpc: '2.0',
        id: 'templates-list-id',
        result: { resourceTemplates: templates },
      };

      await resourcesEnabledClient.init();
      const functions = resourcesEnabledClient.toFunction();

      const templateFn = functions.find(
        (f) => f.name === 'resource_database_table'
      );
      expect(templateFn).toBeDefined();
      expect(templateFn?.description).toBe('Access database tables');
      expect(templateFn?.parameters).toBeDefined();
      expect(templateFn?.parameters?.required).toEqual(['database', 'table']);
      expect(templateFn?.parameters?.properties).toHaveProperty('database');
      expect(templateFn?.parameters?.properties).toHaveProperty('table');
    });

    it('should execute resource function and return formatted contents', async () => {
      const resources: AxMCPResource[] = [
        {
          uri: 'file:///test.txt',
          name: 'test.txt',
        },
      ];

      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: { resources },
      };

      resourcesTransport.sendResponses['resources/templates/list'] = {
        jsonrpc: '2.0',
        id: 'templates-list-id',
        result: { resourceTemplates: [] },
      };

      resourcesTransport.sendResponses['resources/read'] = {
        jsonrpc: '2.0',
        id: 'resources-read-id',
        result: {
          contents: [{ uri: 'file:///test.txt', text: 'Hello, World!' }],
        },
      };

      await resourcesEnabledClient.init();
      const functions = resourcesEnabledClient.toFunction();
      const testFn = functions.find((f) => f.name === 'resource_test_txt');

      const result = await testFn?.func();
      expect(result).toBe('Hello, World!');
    });

    it('should execute resource template function with expanded URI', async () => {
      const templates: AxMCPResourceTemplate[] = [
        {
          uriTemplate: 'file:///{path}',
          name: 'file-access',
        },
      ];

      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: { resources: [] },
      };

      resourcesTransport.sendResponses['resources/templates/list'] = {
        jsonrpc: '2.0',
        id: 'templates-list-id',
        result: { resourceTemplates: templates },
      };

      const originalSend = resourcesTransport.send.bind(resourcesTransport);
      resourcesTransport.send = vi.fn((request) => {
        if (request.method === 'resources/read') {
          const params = (request as { params: { uri: string } }).params;
          expect(params.uri).toBe('file:///documents/report.txt');
          return Promise.resolve({
            jsonrpc: '2.0',
            id: 'resources-read-id',
            result: {
              contents: [{ uri: params.uri, text: 'Report content' }],
            },
          });
        }
        return originalSend(request);
      });

      await resourcesEnabledClient.init();
      const functions = resourcesEnabledClient.toFunction();
      const fileFn = functions.find((f) => f.name === 'resource_file_access');

      const result = await fileFn?.func({ path: 'documents/report.txt' });
      expect(result).toBe('Report content');
    });

    it('should handle pagination when discovering resources', async () => {
      const originalSend = resourcesTransport.send.bind(resourcesTransport);
      let resourceCallCount = 0;
      let templateCallCount = 0;

      resourcesTransport.send = vi.fn((request) => {
        if (request.method === 'resources/list') {
          resourceCallCount++;
          if (resourceCallCount === 1) {
            return Promise.resolve({
              jsonrpc: '2.0',
              id: 'resources-list-id-1',
              result: {
                resources: [{ uri: 'file:///a.txt', name: 'a.txt' }],
                nextCursor: 'page2',
              },
            });
          } else {
            return Promise.resolve({
              jsonrpc: '2.0',
              id: 'resources-list-id-2',
              result: {
                resources: [{ uri: 'file:///b.txt', name: 'b.txt' }],
              },
            });
          }
        }
        if (request.method === 'resources/templates/list') {
          templateCallCount++;
          if (templateCallCount === 1) {
            return Promise.resolve({
              jsonrpc: '2.0',
              id: 'templates-list-id-1',
              result: {
                resourceTemplates: [
                  { uriTemplate: 'tmpl:///{x}', name: 'tmpl1' },
                ],
                nextCursor: 'tpage2',
              },
            });
          } else {
            return Promise.resolve({
              jsonrpc: '2.0',
              id: 'templates-list-id-2',
              result: {
                resourceTemplates: [
                  { uriTemplate: 'tmpl:///{y}', name: 'tmpl2' },
                ],
              },
            });
          }
        }
        return originalSend(request);
      });

      await resourcesEnabledClient.init();
      const functions = resourcesEnabledClient.toFunction();
      const resourceFns = functions.filter((f) =>
        f.name.startsWith('resource_')
      );

      expect(resourceFns).toHaveLength(4);
      expect(resourceFns.map((f) => f.name)).toContain('resource_a_txt');
      expect(resourceFns.map((f) => f.name)).toContain('resource_b_txt');
      expect(resourceFns.map((f) => f.name)).toContain('resource_tmpl1');
      expect(resourceFns.map((f) => f.name)).toContain('resource_tmpl2');
    });
  });

  describe('function overrides for prompts and resources', () => {
    it('should apply function overrides to prompt functions', async () => {
      const promptsTransport = new FakeTransport();

      promptsTransport.sendResponses.initialize = {
        jsonrpc: '2.0',
        id: 'init-id',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: true,
            resources: false,
            prompts: true,
          },
        },
      };

      promptsTransport.sendResponses['tools/list'] = {
        jsonrpc: '2.0',
        id: 'tools-list-id',
        result: { tools: [] },
      };

      promptsTransport.sendResponses['prompts/list'] = {
        jsonrpc: '2.0',
        id: 'prompts-list-id',
        result: {
          prompts: [{ name: 'greeting', description: 'Original description' }],
        },
      };

      const clientWithOverrides = new AxMCPClient(promptsTransport, {
        functionOverrides: [
          {
            name: 'prompt_greeting',
            updates: {
              name: 'say_hello',
              description: 'Overridden description',
            },
          },
        ],
      });

      await clientWithOverrides.init();
      const functions = clientWithOverrides.toFunction();

      const overriddenFn = functions.find((f) => f.name === 'say_hello');
      expect(overriddenFn).toBeDefined();
      expect(overriddenFn?.description).toBe('Overridden description');
    });

    it('should apply function overrides to resource functions', async () => {
      const resourcesTransport = new FakeTransport();

      resourcesTransport.sendResponses.initialize = {
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
      };

      resourcesTransport.sendResponses['tools/list'] = {
        jsonrpc: '2.0',
        id: 'tools-list-id',
        result: { tools: [] },
      };

      resourcesTransport.sendResponses['resources/list'] = {
        jsonrpc: '2.0',
        id: 'resources-list-id',
        result: {
          resources: [{ uri: 'file:///config.json', name: 'config.json' }],
        },
      };

      resourcesTransport.sendResponses['resources/templates/list'] = {
        jsonrpc: '2.0',
        id: 'templates-list-id',
        result: { resourceTemplates: [] },
      };

      const clientWithOverrides = new AxMCPClient(resourcesTransport, {
        functionOverrides: [
          {
            name: 'resource_config_json',
            updates: {
              name: 'get_config',
              description: 'Get application configuration',
            },
          },
        ],
      });

      await clientWithOverrides.init();
      const functions = clientWithOverrides.toFunction();

      const overriddenFn = functions.find((f) => f.name === 'get_config');
      expect(overriddenFn).toBeDefined();
      expect(overriddenFn?.description).toBe('Get application configuration');
    });
  });
});
