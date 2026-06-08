import type {
  AxFunction,
  AxFunctionJSONSchema,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { randomUUID } from '../util/crypto.js';

import type { AxMCPTransport } from './transport.js';
import {
  AX_MCP_PROTOCOL_VERSION,
  AX_MCP_SUPPORTED_PROTOCOL_VERSIONS,
  type AxMCPBlobResourceContents,
  type AxMCPClientCapabilities,
  type AxMCPCompletionArgument,
  type AxMCPCompletionReference,
  type AxMCPCompletionRequest,
  type AxMCPCompletionResult,
  type AxMCPContent,
  type AxMCPImplementationInfo,
  type AxMCPInitializeParams,
  type AxMCPInitializeResult,
  type AxMCPJSONRPCMessage,
  type AxMCPJSONRPCNotification,
  type AxMCPJSONRPCRequest,
  type AxMCPListRootsResult,
  type AxMCPLoggingLevel,
  type AxMCPPrompt,
  type AxMCPPromptGetResult,
  type AxMCPPromptMessage,
  type AxMCPPromptsListResult,
  type AxMCPResource,
  type AxMCPResourceReadResult,
  type AxMCPResourcesListResult,
  type AxMCPResourceTemplate,
  type AxMCPResourceTemplatesListResult,
  type AxMCPRoot,
  type AxMCPServerCapabilities,
  type AxMCPTextResourceContents,
  type AxMCPTool,
  type AxMCPToolCallParams,
  type AxMCPToolCallResult,
  type AxMCPToolsListResult,
  axMCPToolInputSchemaToFunctionSchema,
} from './types.js';

export interface AxMCPFunctionOverride {
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

export interface AxMCPClientOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Logger function for debug output */
  logger?: AxLoggerFunction;
  /** MCP protocol version to request during initialize. Defaults to latest. */
  protocolVersion?: string;
  /** Protocol versions this client can accept during negotiation. */
  supportedProtocolVersions?: readonly string[];
  /** Client metadata sent in initialize. */
  clientInfo?: Partial<AxMCPImplementationInfo>;
  /** Extra client capabilities to advertise. Advertise only implemented ones. */
  capabilities?: AxMCPClientCapabilities;
  /** Optional roots support. When set, Ax advertises and answers roots/list. */
  roots?: readonly AxMCPRoot[];
  /** List of function overrides for tool/prompt/resource wrappers. */
  functionOverrides?: AxMCPFunctionOverride[];
  /** Generic notification callback for all server notifications. */
  onNotification?: (
    notification: Readonly<AxMCPJSONRPCNotification>
  ) => void | Promise<void>;
  onToolsChanged?: () => void | Promise<void>;
  onPromptsChanged?: () => void | Promise<void>;
  onResourcesChanged?: () => void | Promise<void>;
  onResourceUpdated?: (uri: string) => void | Promise<void>;
  onLoggingMessage?: (
    params: Readonly<Record<string, unknown>>
  ) => void | Promise<void>;
}

type CapabilityValue =
  | boolean
  | Record<string, unknown>
  | unknown[]
  | undefined;

const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INTERNAL_ERROR = -32603;

export class AxMCPClient {
  private functions: AxFunction[] = [];
  private promptFunctions: AxFunction[] = [];
  private resourceFunctions: AxFunction[] = [];
  private activeRequests: Map<string, { reject: (reason: unknown) => void }> =
    new Map();
  private serverCapabilities: AxMCPServerCapabilities = {};
  private negotiatedProtocolVersion?: string;
  private serverInfo?: AxMCPImplementationInfo;
  private serverInstructions?: string;
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
    this.transport.setMessageHandler?.((message) => {
      void this.handleInboundMessage(message);
    });
  }

  async init(): Promise<void> {
    await this.transport.connect?.();

    const protocolVersion =
      this.options.protocolVersion ?? AX_MCP_PROTOCOL_VERSION;
    const { result: res } = await this.sendRequest<
      AxMCPInitializeParams,
      AxMCPInitializeResult
    >('initialize', {
      protocolVersion,
      capabilities: this.buildClientCapabilities(),
      clientInfo: {
        name: 'AxMCPClient',
        title: 'Ax MCP Client',
        version: '1.0.0',
        ...this.options.clientInfo,
      },
    });

    const supportedVersions =
      this.options.supportedProtocolVersions ??
      AX_MCP_SUPPORTED_PROTOCOL_VERSIONS;
    if (!supportedVersions.includes(res.protocolVersion)) {
      throw new Error(
        `Unsupported MCP protocol version ${res.protocolVersion}. Supported versions: ${supportedVersions.join(', ')}`
      );
    }

    this.negotiatedProtocolVersion = res.protocolVersion;
    this.transport.setProtocolVersion?.(res.protocolVersion);
    this.serverCapabilities = res.capabilities ?? {};
    this.serverInfo = res.serverInfo;
    this.serverInstructions = res.instructions;

    await this.sendNotification('notifications/initialized');
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.functions = [];
    this.promptFunctions = [];
    this.resourceFunctions = [];

    if (this.hasToolsCapability()) {
      await this.discoverFunctions();
    }

    if (this.hasPromptsCapability()) {
      await this.discoverPromptFunctions();
    }

    if (this.hasResourcesCapability()) {
      await this.discoverResourceFunctions();
    }
  }

  getProtocolVersion(): string | undefined {
    return this.negotiatedProtocolVersion;
  }

  getServerInfo(): AxMCPImplementationInfo | undefined {
    return this.serverInfo;
  }

  getServerInstructions(): string | undefined {
    return this.serverInstructions;
  }

  getServerCapabilities(): AxMCPServerCapabilities {
    return this.serverCapabilities;
  }

  private buildClientCapabilities(): AxMCPClientCapabilities {
    const capabilities: AxMCPClientCapabilities = {
      ...(this.options.capabilities ?? {}),
    };
    if (this.options.roots && !capabilities.roots) {
      capabilities.roots = { listChanged: true };
    }
    return capabilities;
  }

  private isCapabilityEnabled(capability: CapabilityValue): boolean {
    return (
      capability !== undefined && capability !== null && capability !== false
    );
  }

  private hasSubCapability(capability: CapabilityValue, name: string): boolean {
    if (capability === true) return true;
    if (
      !capability ||
      typeof capability !== 'object' ||
      Array.isArray(capability)
    )
      return false;
    return Boolean((capability as Record<string, unknown>)[name]);
  }

  private async discoverFunctions(): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.listTools(cursor);
      this.functions.push(...result.tools.map((fn) => this.toolToFunction(fn)));
      cursor = result.nextCursor;
    } while (cursor);
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
    let cursor: string | undefined;
    do {
      const result = await this.listResources(cursor);
      for (const resource of result.resources ?? []) {
        this.resourceFunctions.push(this.resourceToFunction(resource));
      }
      cursor = result.nextCursor;
    } while (cursor);

    cursor = undefined;
    do {
      const result = await this.listResourceTemplates(cursor);
      for (const template of result.resourceTemplates ?? []) {
        this.resourceFunctions.push(this.resourceTemplateToFunction(template));
      }
      cursor = result.nextCursor;
    } while (cursor);
  }

  private toolToFunction(tool: Readonly<AxMCPTool>): AxFunction {
    const override = this.options.functionOverrides?.find(
      (o) => o.name === tool.name
    );

    const parameters = axMCPToolInputSchemaToFunctionSchema(tool.inputSchema);
    const returns = tool.outputSchema as AxFunctionJSONSchema | undefined;

    return {
      name: override?.updates.name ?? tool.name,
      description:
        override?.updates.description ??
        tool.description ??
        tool.title ??
        tool.name,
      parameters,
      returns,
      func: async (args) => {
        const result = await this.callTool(tool.name, args ?? {});
        return this.formatToolResult(result);
      },
    };
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
              {
                type: 'string',
                description: arg.description ?? arg.title ?? '',
              },
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
        prompt.title ??
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
        resource.title ??
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
        template.title ??
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

  private extractContent(content: AxMCPContent): string {
    if (content.type === 'text') return content.text;
    if (content.type === 'image') return `[Image: ${content.mimeType}]`;
    if (content.type === 'audio') return `[Audio: ${content.mimeType}]`;
    if (content.type === 'resource_link') {
      return `[Resource: ${content.name ?? content.uri} <${content.uri}>]`;
    }
    if (content.type === 'resource') {
      const res = content.resource;
      return 'text' in res ? res.text : `[Binary: ${res.uri}]`;
    }
    return '';
  }

  private formatToolResult(result: Readonly<AxMCPToolCallResult>): string {
    const parts: string[] = [];
    const contentText = result.content
      ?.map((content) => this.extractContent(content))
      .filter(Boolean)
      .join('\n');
    if (contentText) parts.push(contentText);
    if (result.structuredContent !== undefined) {
      parts.push(JSON.stringify(result.structuredContent, null, 2));
    }
    const body = parts.join('\n\n');
    if (result.isError) {
      return `MCP tool error:\n${body || 'The MCP server reported an error.'}`;
    }
    return body || '';
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
    const pingPromise = this.sendRequest('ping', undefined);
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
      tools: this.hasToolsCapability(),
      resources: this.hasResourcesCapability(),
      prompts: this.hasPromptsCapability(),
    };
  }

  hasToolsCapability(): boolean {
    return this.isCapabilityEnabled(
      this.serverCapabilities.tools as CapabilityValue
    );
  }

  hasPromptsCapability(): boolean {
    return this.isCapabilityEnabled(
      this.serverCapabilities.prompts as CapabilityValue
    );
  }

  hasResourcesCapability(): boolean {
    return this.isCapabilityEnabled(
      this.serverCapabilities.resources as CapabilityValue
    );
  }

  hasCompletionsCapability(): boolean {
    return this.isCapabilityEnabled(
      this.serverCapabilities.completions as CapabilityValue
    );
  }

  hasLoggingCapability(): boolean {
    return this.isCapabilityEnabled(
      this.serverCapabilities.logging as CapabilityValue
    );
  }

  async listTools(cursor?: string): Promise<AxMCPToolsListResult> {
    if (!this.hasToolsCapability()) {
      throw new Error('Tools are not supported');
    }

    const params = cursor ? { cursor } : undefined;
    const { result } = await this.sendRequest<
      { cursor?: string } | undefined,
      AxMCPToolsListResult
    >('tools/list', params);

    return result;
  }

  async callTool(name: string, args?: unknown): Promise<AxMCPToolCallResult> {
    if (!this.hasToolsCapability()) {
      throw new Error('Tools are not supported');
    }

    const { result } = await this.sendRequest<
      AxMCPToolCallParams,
      AxMCPToolCallResult
    >('tools/call', { name, arguments: args });

    return result;
  }

  async listPrompts(cursor?: string): Promise<AxMCPPromptsListResult> {
    if (!this.hasPromptsCapability()) {
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
    if (!this.hasPromptsCapability()) {
      throw new Error('Prompts are not supported');
    }

    const { result } = await this.sendRequest<
      { name: string; arguments?: Record<string, string> },
      AxMCPPromptGetResult
    >('prompts/get', { name, arguments: args });

    return result;
  }

  async listResources(cursor?: string): Promise<AxMCPResourcesListResult> {
    if (!this.hasResourcesCapability()) {
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
    if (!this.hasResourcesCapability()) {
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
    if (!this.hasResourcesCapability()) {
      throw new Error('Resources are not supported');
    }

    const { result } = await this.sendRequest<
      { uri: string },
      AxMCPResourceReadResult
    >('resources/read', { uri });

    return result;
  }

  async subscribeResource(uri: string): Promise<void> {
    if (
      !this.hasResourcesCapability() ||
      !this.hasSubCapability(this.serverCapabilities.resources, 'subscribe')
    ) {
      throw new Error('Resource subscriptions are not supported');
    }

    await this.sendRequest<{ uri: string }>('resources/subscribe', { uri });
  }

  async unsubscribeResource(uri: string): Promise<void> {
    if (
      !this.hasResourcesCapability() ||
      !this.hasSubCapability(this.serverCapabilities.resources, 'subscribe')
    ) {
      throw new Error('Resource subscriptions are not supported');
    }

    await this.sendRequest<{ uri: string }>('resources/unsubscribe', { uri });
  }

  async complete(
    ref: AxMCPCompletionReference,
    argument: AxMCPCompletionArgument,
    context?: AxMCPCompletionRequest['context']
  ): Promise<AxMCPCompletionResult> {
    if (!this.hasCompletionsCapability()) {
      throw new Error('Completions are not supported');
    }

    const { result } = await this.sendRequest<
      AxMCPCompletionRequest,
      AxMCPCompletionResult
    >('completion/complete', { ref, argument, context });

    return result;
  }

  async setLoggingLevel(level: AxMCPLoggingLevel): Promise<void> {
    if (!this.hasLoggingCapability()) {
      throw new Error('Logging is not supported');
    }
    await this.sendRequest<{ level: AxMCPLoggingLevel }>('logging/setLevel', {
      level,
    });
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

  private async handleInboundMessage(
    message: Readonly<AxMCPJSONRPCMessage>
  ): Promise<void> {
    if ('method' in message && 'id' in message) {
      await this.handleServerRequest(message);
      return;
    }
    if ('method' in message) {
      await this.handleServerNotification(message);
    }
  }

  private async handleServerRequest(
    request: Readonly<AxMCPJSONRPCRequest>
  ): Promise<void> {
    const sendResponse = this.transport.sendResponse?.bind(this.transport);
    if (!sendResponse) return;

    try {
      if (request.method === 'ping') {
        await sendResponse({ jsonrpc: '2.0', id: request.id, result: {} });
        return;
      }
      if (request.method === 'roots/list' && this.options.roots) {
        const result: AxMCPListRootsResult = {
          roots: [...this.options.roots],
        };
        await sendResponse({ jsonrpc: '2.0', id: request.id, result });
        return;
      }
      await sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: JSON_RPC_METHOD_NOT_FOUND,
          message: `Unsupported server request: ${request.method}`,
        },
      });
    } catch (error) {
      await sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: JSON_RPC_INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleServerNotification(
    notification: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    await this.options.onNotification?.(notification);
    switch (notification.method) {
      case 'notifications/tools/list_changed':
        await this.options.onToolsChanged?.();
        break;
      case 'notifications/prompts/list_changed':
        await this.options.onPromptsChanged?.();
        break;
      case 'notifications/resources/list_changed':
        await this.options.onResourcesChanged?.();
        break;
      case 'notifications/resources/updated': {
        const uri =
          notification.params &&
          typeof notification.params === 'object' &&
          'uri' in notification.params
            ? String((notification.params as { uri: unknown }).uri)
            : undefined;
        if (uri) await this.options.onResourceUpdated?.(uri);
        break;
      }
      case 'notifications/message':
        await this.options.onLoggingMessage?.(notification.params ?? {});
        break;
    }
  }

  private async sendRequest<T = unknown, R = unknown>(
    method: string,
    params?: T
  ): Promise<{ id: string; result: R }> {
    const requestId = randomUUID();
    const request: AxMCPJSONRPCRequest<T> = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      ...(params === undefined ? {} : { params }),
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
    params?: Record<string, unknown>
  ): Promise<void> {
    const notification: AxMCPJSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params }),
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
