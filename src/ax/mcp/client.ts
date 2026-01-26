import type {
  AxFunction,
  AxFunctionJSONSchema,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { randomUUID } from '../util/crypto.js';

import type { AxMCPTransport } from './transport.js';
import type {
  AxMCPBlobResourceContents,
  AxMCPEmbeddedResource,
  AxMCPImageContent,
  AxMCPInitializeParams,
  AxMCPInitializeResult,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPPrompt,
  AxMCPPromptGetResult,
  AxMCPPromptMessage,
  AxMCPPromptsListResult,
  AxMCPResource,
  AxMCPResourceReadResult,
  AxMCPResourcesListResult,
  AxMCPResourceTemplate,
  AxMCPResourceTemplatesListResult,
  AxMCPTextContent,
  AxMCPTextResourceContents,
  AxMCPToolsListResult,
} from './types.js';

/**
 * Configuration for overriding function properties
 */
interface FunctionOverride {
  /** Original function name to override */
  name: string;
  /** Updates to apply to the function */
  updates: {
    /** Alternative name for the function */
    name?: string;
    /** Alternative description for the function */
    description?: string;
  };
}

/**
 * Options for the MCP client
 */
interface AxMCPClientOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Logger function for debug output */
  logger?: AxLoggerFunction;
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
  functionOverrides?: FunctionOverride[];
}

export class AxMCPClient {
  private functions: AxFunction[] = [];
  private promptFunctions: AxFunction[] = [];
  private resourceFunctions: AxFunction[] = [];
  private activeRequests: Map<string, { reject: (reason: unknown) => void }> =
    new Map();
  private capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  } = {};
  private logger: AxLoggerFunction;

  constructor(
    private readonly transport: AxMCPTransport,
    private readonly options: Readonly<AxMCPClientOptions> = {}
  ) {
    this.logger =
      options.logger ??
      ((message: string | AxLoggerData) => {
        if (typeof message === 'string') {
          console.log(message);
        } else {
          console.log(JSON.stringify(message, null, 2));
        }
      });
  }

  async init(): Promise<void> {
    if ('connect' in this.transport) {
      await this.transport.connect?.();
    }

    const { result: res } = await this.sendRequest<
      AxMCPInitializeParams,
      AxMCPInitializeResult
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
    });

    const expectedProtocolVersion = '2024-11-05';
    if (res.protocolVersion !== expectedProtocolVersion) {
      throw new Error(
        `Protocol version mismatch. Expected ${expectedProtocolVersion} but got ${res.protocolVersion}`
      );
    }

    if (res.capabilities.tools) {
      this.capabilities.tools = true;
    }

    if (res.capabilities.resources) {
      this.capabilities.resources = true;
    }

    if (res.capabilities.prompts) {
      this.capabilities.prompts = true;
    }

    await this.sendNotification('notifications/initialized');

    if (this.capabilities.tools) {
      await this.discoverFunctions();
    }

    if (this.capabilities.prompts) {
      await this.discoverPromptFunctions();
    }

    if (this.capabilities.resources) {
      await this.discoverResourceFunctions();
    }
  }

  private async discoverFunctions(): Promise<void> {
    const { result: res } = await this.sendRequest<
      undefined,
      AxMCPToolsListResult
    >('tools/list');

    this.functions = res.tools.map((fn): AxFunction => {
      // Check if there's an override for this function
      const override = this.options.functionOverrides?.find(
        (o) => o.name === fn.name
      );

      const parameters = fn.inputSchema.properties
        ? {
            properties: fn.inputSchema.properties,
            required: fn.inputSchema.required ?? [],
            type: fn.inputSchema.type,
          }
        : undefined;

      return {
        name: override?.updates.name ?? fn.name,
        description: override?.updates.description ?? fn.description,
        parameters,
        func: async (args) => {
          // Always use original name when calling the function
          const { result } = await this.sendRequest<{
            name: string;
            // eslint-disable-next-line functional/functional-parameters
            arguments: unknown;
          }>('tools/call', { name: fn.name, arguments: args });
          return result;
        },
      };
    });
  }

  private async discoverPromptFunctions(): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.listPrompts(cursor);
      for (const prompt of result.prompts ?? []) {
        this.promptFunctions.push(this.promptToFunction(prompt));
      }
      cursor = result.nextCursor;
    } while (cursor);
  }

  private async discoverResourceFunctions(): Promise<void> {
    // Fetch all resources (handle pagination)
    let cursor: string | undefined;
    do {
      const result = await this.listResources(cursor);
      for (const resource of result.resources ?? []) {
        this.resourceFunctions.push(this.resourceToFunction(resource));
      }
      cursor = result.nextCursor;
    } while (cursor);

    // Also fetch resource templates
    cursor = undefined;
    do {
      const result = await this.listResourceTemplates(cursor);
      for (const template of result.resourceTemplates ?? []) {
        this.resourceFunctions.push(this.resourceTemplateToFunction(template));
      }
      cursor = result.nextCursor;
    } while (cursor);
  }

  private promptToFunction(prompt: Readonly<AxMCPPrompt>): AxFunction {
    const functionName = `prompt_${prompt.name}`;
    const override = this.options.functionOverrides?.find(
      (o) => o.name === functionName
    );

    const parameters: AxFunctionJSONSchema | undefined = prompt.arguments
      ?.length
      ? {
          type: 'object',
          properties: Object.fromEntries(
            prompt.arguments.map((arg) => [
              arg.name,
              { type: 'string', description: arg.description ?? '' },
            ])
          ),
          required: prompt.arguments
            .filter((a) => a.required)
            .map((a) => a.name),
        }
      : undefined;

    return {
      name: override?.updates.name ?? functionName,
      description:
        override?.updates.description ??
        prompt.description ??
        `Get the ${prompt.name} prompt`,
      parameters,
      func: async (args?: Record<string, string>) => {
        const result = await this.getPrompt(prompt.name, args);
        return this.formatPromptMessages(result.messages);
      },
    };
  }

  private resourceToFunction(resource: Readonly<AxMCPResource>): AxFunction {
    const functionName = `resource_${this.sanitizeName(resource.name)}`;
    const override = this.options.functionOverrides?.find(
      (o) => o.name === functionName
    );

    return {
      name: override?.updates.name ?? functionName,
      description:
        override?.updates.description ??
        resource.description ??
        `Read ${resource.name}`,
      parameters: undefined,
      func: async () => {
        const result = await this.readResource(resource.uri);
        return this.formatResourceContents(result.contents);
      },
    };
  }

  private resourceTemplateToFunction(
    template: Readonly<AxMCPResourceTemplate>
  ): AxFunction {
    const functionName = `resource_${this.sanitizeName(template.name)}`;
    const override = this.options.functionOverrides?.find(
      (o) => o.name === functionName
    );

    const params = this.parseUriTemplate(template.uriTemplate);

    return {
      name: override?.updates.name ?? functionName,
      description:
        override?.updates.description ??
        template.description ??
        `Read ${template.name}`,
      parameters: params.length
        ? {
            type: 'object',
            properties: Object.fromEntries(
              params.map((p) => [
                p,
                { type: 'string', description: `Value for ${p}` },
              ])
            ),
            required: params,
          }
        : undefined,
      func: async (args?: Record<string, string>) => {
        const uri = this.expandUriTemplate(template.uriTemplate, args ?? {});
        const result = await this.readResource(uri);
        return this.formatResourceContents(result.contents);
      },
    };
  }

  private formatPromptMessages(
    messages: readonly AxMCPPromptMessage[]
  ): string {
    return messages
      .map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const content = this.extractContent(msg.content);
        return `${role}: ${content}`;
      })
      .join('\n\n');
  }

  private extractContent(
    content: AxMCPTextContent | AxMCPImageContent | AxMCPEmbeddedResource
  ): string {
    if (content.type === 'text') return content.text;
    if (content.type === 'image') return `[Image: ${content.mimeType}]`;
    if (content.type === 'resource') {
      const res = content.resource;
      return 'text' in res ? res.text : `[Binary: ${res.uri}]`;
    }
    return '';
  }

  private formatResourceContents(
    contents: readonly (AxMCPTextResourceContents | AxMCPBlobResourceContents)[]
  ): string {
    return contents
      .map((c) => ('text' in c ? c.text : `[Binary: ${c.uri}]`))
      .join('\n');
  }

  private sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private parseUriTemplate(template: string): string[] {
    const matches = template.match(/\{([^}]+)\}/g) ?? [];
    return matches.map((m) => m.slice(1, -1));
  }

  private expandUriTemplate(
    template: string,
    args: Record<string, string>
  ): string {
    return template.replace(/\{([^}]+)\}/g, (_, key) => args[key] ?? '');
  }

  async ping(timeout = 3000): Promise<void> {
    const pingPromise = this.sendRequest('ping');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Ping response timeout exceeded')),
        timeout
      )
    );
    const response = (await Promise.race([pingPromise, timeoutPromise])) as {
      result: unknown;
    };
    const { result } = response;
    if (
      typeof result !== 'object' ||
      result === null ||
      Object.keys(result).length !== 0
    ) {
      throw new Error(`Unexpected ping response: ${JSON.stringify(result)}`);
    }
  }

  toFunction(): AxFunction[] {
    return [
      ...this.functions,
      ...this.promptFunctions,
      ...this.resourceFunctions,
    ];
  }

  getCapabilities(): { tools: boolean; resources: boolean; prompts: boolean } {
    return {
      tools: this.capabilities.tools ?? false,
      resources: this.capabilities.resources ?? false,
      prompts: this.capabilities.prompts ?? false,
    };
  }

  hasToolsCapability(): boolean {
    return this.capabilities.tools ?? false;
  }

  hasPromptsCapability(): boolean {
    return this.capabilities.prompts ?? false;
  }

  hasResourcesCapability(): boolean {
    return this.capabilities.resources ?? false;
  }

  async listPrompts(cursor?: string): Promise<AxMCPPromptsListResult> {
    if (!this.capabilities.prompts) {
      throw new Error('Prompts are not supported');
    }

    const params = cursor ? { cursor } : undefined;
    const { result } = await this.sendRequest<
      { cursor?: string } | undefined,
      AxMCPPromptsListResult
    >('prompts/list', params);

    return result;
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<AxMCPPromptGetResult> {
    if (!this.capabilities.prompts) {
      throw new Error('Prompts are not supported');
    }

    const { result } = await this.sendRequest<
      { name: string; arguments?: Record<string, string> },
      AxMCPPromptGetResult
    >('prompts/get', { name, arguments: args });

    return result;
  }

  async listResources(cursor?: string): Promise<AxMCPResourcesListResult> {
    if (!this.capabilities.resources) {
      throw new Error('Resources are not supported');
    }

    const params = cursor ? { cursor } : undefined;
    const { result } = await this.sendRequest<
      { cursor?: string } | undefined,
      AxMCPResourcesListResult
    >('resources/list', params);

    return result;
  }

  async listResourceTemplates(
    cursor?: string
  ): Promise<AxMCPResourceTemplatesListResult> {
    if (!this.capabilities.resources) {
      throw new Error('Resources are not supported');
    }

    const params = cursor ? { cursor } : undefined;
    const { result } = await this.sendRequest<
      { cursor?: string } | undefined,
      AxMCPResourceTemplatesListResult
    >('resources/templates/list', params);

    return result;
  }

  async readResource(uri: string): Promise<AxMCPResourceReadResult> {
    if (!this.capabilities.resources) {
      throw new Error('Resources are not supported');
    }

    const { result } = await this.sendRequest<
      { uri: string },
      AxMCPResourceReadResult
    >('resources/read', { uri });

    return result;
  }

  async subscribeResource(uri: string): Promise<void> {
    if (!this.capabilities.resources) {
      throw new Error('Resources are not supported');
    }

    await this.sendRequest<{ uri: string }>('resources/subscribe', { uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    if (!this.capabilities.resources) {
      throw new Error('Resources are not supported');
    }

    await this.sendRequest<{ uri: string }>('resources/unsubscribe', { uri });
  }

  cancelRequest(id: string): void {
    if (this.activeRequests.has(id)) {
      this.sendNotification('notifications/cancelled', {
        requestId: id,
        reason: 'Client cancelled request',
      });
      const entry = this.activeRequests.get(id);
      if (entry) {
        entry.reject(new Error(`Request ${id} cancelled`));
      }
      this.activeRequests.delete(id);
    }
  }

  private async sendRequest<T = unknown, R = unknown>(
    method: string,
    params: T = {} as T
  ): Promise<{ id: string; result: R }> {
    const requestId = randomUUID();
    const request: AxMCPJSONRPCRequest<T> = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    const responsePromise = new Promise<{ result: R }>((resolve, reject) => {
      this.activeRequests.set(requestId, { reject });
      this.transport
        .send(request)
        .then((res: unknown) => {
          this.activeRequests.delete(requestId);
          if (res !== null && typeof res === 'object' && 'error' in res) {
            const errorObj = res as {
              error: { code: number; message: string };
            };
            reject(
              new Error(
                `RPC Error ${errorObj.error.code}: ${errorObj.error.message}`
              )
            );
          } else if (
            res !== null &&
            typeof res === 'object' &&
            'result' in res
          ) {
            resolve({ result: (res as { result: R }).result });
          } else {
            reject(new Error('Invalid response no result or error'));
          }
        })
        .catch((err: unknown) => {
          this.activeRequests.delete(requestId);
          reject(err);
        });
    });

    const { result } = await responsePromise;
    return { id: requestId, result };
  }

  private async sendNotification(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<void> {
    const notification: AxMCPJSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const { debug } = this.options;
    if (debug) {
      const loggerData: AxLoggerData = {
        name: 'Notification',
        id: 'mcp_notification',
        value: `Sending notification: ${JSON.stringify(notification, null, 2)}`,
      };
      this.logger(loggerData);
    }

    await this.transport.sendNotification(notification);
  }
}
