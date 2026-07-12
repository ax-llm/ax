import type { Tracer } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import type {
  AxFunction,
  AxFunctionJSONSchema,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { randomUUID } from '../util/crypto.js';
import type { AxMCPExtensionCapability } from './extensions.js';
import type { AxMCPRequestOptions, AxMCPTransport } from './transport.js';
import {
  AX_MCP_PROTOCOL_VERSION,
  AX_MCP_SUPPORTED_PROTOCOL_VERSIONS,
  type AxMCPBatchRequest,
  type AxMCPBatchResponse,
  type AxMCPBlobResourceContents,
  type AxMCPClientCapabilities,
  type AxMCPCompletionArgument,
  type AxMCPCompletionReference,
  type AxMCPCompletionRequest,
  type AxMCPCompletionResult,
  type AxMCPContent,
  type AxMCPCreateTaskResult,
  type AxMCPElicitationCreateParams,
  type AxMCPElicitationCreateResult,
  type AxMCPImplementationInfo,
  type AxMCPInitializeParams,
  type AxMCPInitializeResult,
  type AxMCPJSONRPCMessage,
  type AxMCPJSONRPCNotification,
  type AxMCPJSONRPCRequest,
  type AxMCPListRootsResult,
  type AxMCPLoggingLevel,
  type AxMCPProgressNotificationParams,
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
  type AxMCPSamplingCreateMessageParams,
  type AxMCPSamplingCreateMessageResult,
  type AxMCPServerCapabilities,
  type AxMCPTask,
  type AxMCPTaskMetadata,
  type AxMCPTasksListResult,
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
  /** Optional MCP extensions advertised during initialize. */
  extensions?: Record<string, AxMCPExtensionCapability>;
  /** Optional roots support. When set, Ax advertises and answers roots/list. */
  roots?: readonly AxMCPRoot[];
  /** Stable namespace used when this client is attached to Ax programs. */
  namespace?: string;
  /** Maximum concurrent tool or task-augmented tool calls for this server. */
  maxConcurrency?: number;
  /** Maximum pages accepted from any single catalog listing. */
  maxPaginationPages?: number;
  /** Reinitialize expired HTTP sessions for safe requests. Defaults to safe. */
  sessionRecovery?: 'safe' | 'none';
  /** Optional protocol tracer; request spans contain sanitized MCP metadata. */
  tracer?: Tracer;
  /** Host policy hook invoked before an MCP tool is called. */
  authorizeToolCall?: (
    call: Readonly<{
      client: AxMCPClient;
      namespace: string;
      tool: AxMCPTool;
      arguments: unknown;
    }>
  ) => boolean | undefined | Promise<boolean | undefined>;
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
  /** Handles server-initiated sampling/createMessage requests. */
  sampling?: (
    params: Readonly<AxMCPSamplingCreateMessageParams>,
    context: Readonly<{ client: AxMCPClient; namespace: string }>
  ) =>
    | AxMCPSamplingCreateMessageResult
    | Promise<AxMCPSamplingCreateMessageResult>;
  /** Handles server-initiated elicitation/create requests. */
  elicitation?: (
    params: Readonly<AxMCPElicitationCreateParams>,
    context: Readonly<{ client: AxMCPClient; namespace: string }>
  ) => AxMCPElicitationCreateResult | Promise<AxMCPElicitationCreateResult>;
  onProgress?: (
    params: Readonly<AxMCPProgressNotificationParams>
  ) => void | Promise<void>;
  onTaskStatus?: (task: Readonly<AxMCPTask>) => void | Promise<void>;
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
  private tools: AxMCPTool[] = [];
  private prompts: AxMCPPrompt[] = [];
  private resources: AxMCPResource[] = [];
  private resourceTemplates: AxMCPResourceTemplate[] = [];
  private promptFunctions: AxFunction[] = [];
  private resourceFunctions: AxFunction[] = [];
  private activeRequests: Map<string, { reject: (reason: unknown) => void }> =
    new Map();
  private serverCapabilities: AxMCPServerCapabilities = {};
  private negotiatedProtocolVersion?: string;
  private serverInfo?: AxMCPImplementationInfo;
  private serverInstructions?: string;
  private logger: AxLoggerFunction;
  private initPromise?: Promise<void>;
  private initialized = false;
  private refreshPromise?: Promise<void>;
  private catalogRevision = 0;
  private negotiatedExtensions: Record<string, AxMCPExtensionCapability> = {};
  private activeToolCalls = 0;
  private readonly toolCallQueue: Array<{
    limit: number;
    start: () => void;
  }> = [];
  private readonly tasks = new Map<string, AxMCPTask>();
  private readonly resourceSubscriptions = new Set<string>();
  private readonly taskStatusListeners = new Set<
    (task: Readonly<AxMCPTask>) => void | Promise<void>
  >();
  private sessionRecoveryPromise?: Promise<void>;

  constructor(
    private readonly transport: AxMCPTransport,
    private readonly options: Readonly<AxMCPClientOptions> = {}
  ) {
    if (
      options.maxConcurrency !== undefined &&
      (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1)
    ) {
      throw new Error('MCP maxConcurrency must be a positive integer');
    }
    if (
      options.maxPaginationPages !== undefined &&
      (!Number.isInteger(options.maxPaginationPages) ||
        options.maxPaginationPages < 1)
    ) {
      throw new Error('MCP maxPaginationPages must be a positive integer');
    }
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
      return this.handleInboundMessage(message);
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize();
    try {
      await this.initPromise;
      this.initialized = true;
    } finally {
      this.initPromise = undefined;
    }
  }

  private async initialize(): Promise<void> {
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
    const clientExtensions = this.buildClientCapabilities().extensions ?? {};
    const serverExtensions = this.serverCapabilities.extensions ?? {};
    this.negotiatedExtensions = Object.fromEntries(
      Object.entries(clientExtensions)
        .filter(([name]) => Object.hasOwn(serverExtensions, name))
        .map(([name, capability]) => [
          name,
          { ...capability, ...serverExtensions[name] },
        ])
    );
    this.serverInfo = res.serverInfo;
    this.serverInstructions = res.instructions;

    await this.sendNotification('notifications/initialized');
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refreshCatalog();
    try {
      await this.refreshPromise;
      this.catalogRevision++;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshCatalog(): Promise<void> {
    this.functions = [];
    this.tools = [];
    this.prompts = [];
    this.resources = [];
    this.resourceTemplates = [];
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

  getEvaluationMode(): 'live' | 'record' | 'replay' | 'sandbox' {
    return this.transport.evaluationMode ?? 'live';
  }

  async batch(
    requests: readonly Readonly<AxMCPBatchRequest>[],
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<readonly AxMCPBatchResponse[]> {
    if (this.negotiatedProtocolVersion !== '2025-03-26') {
      throw new Error(
        `JSON-RPC batching is only available for MCP 2025-03-26, not ${this.negotiatedProtocolVersion ?? 'before initialization'}`
      );
    }
    if (requests.length === 0) throw new Error('MCP batch cannot be empty');
    if (!this.transport.sendBatch) {
      throw new Error('The configured MCP transport does not support batching');
    }
    const messages = requests.map((request) => ({
      jsonrpc: '2.0' as const,
      id: randomUUID(),
      method: request.method,
      ...(request.params === undefined ? {} : { params: request.params }),
    }));
    const responses = await this.transport.sendBatch(messages, options);
    if (responses.length !== messages.length) {
      throw new Error(
        `MCP batch response count mismatch: expected ${messages.length}, received ${responses.length}`
      );
    }
    return messages.map((message, index) => {
      const response = responses[index]!;
      if (response.id !== message.id) {
        throw new Error(
          `MCP batch response ID mismatch: expected ${message.id}, received ${String(response.id)}`
        );
      }
      return { request: requests[index]!, response };
    });
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

  getNegotiatedExtensions(): Readonly<
    Record<string, AxMCPExtensionCapability>
  > {
    return structuredClone(this.negotiatedExtensions);
  }

  hasExtension(name: string): boolean {
    return Object.hasOwn(this.negotiatedExtensions, name);
  }

  getNamespace(): string {
    const candidate = this.options.namespace ?? this.serverInfo?.name ?? 'mcp';
    const normalized = candidate
      .trim()
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || 'mcp';
  }

  getTools(): readonly AxMCPTool[] {
    return this.tools;
  }

  getPrompts(): readonly AxMCPPrompt[] {
    return this.prompts;
  }

  getResources(): readonly AxMCPResource[] {
    return this.resources;
  }

  getResourceTemplates(): readonly AxMCPResourceTemplate[] {
    return this.resourceTemplates;
  }

  getCatalogRevision(): number {
    return this.catalogRevision;
  }

  async close(): Promise<void> {
    try {
      await this.transport.terminateSession?.();
    } finally {
      await this.transport.close?.();
      this.initialized = false;
      this.negotiatedProtocolVersion = undefined;
    }
  }

  private buildClientCapabilities(): AxMCPClientCapabilities {
    const capabilities: AxMCPClientCapabilities = {
      ...(this.options.capabilities ?? {}),
      ...(this.options.extensions
        ? {
            extensions: {
              ...(this.options.capabilities?.extensions ?? {}),
              ...this.options.extensions,
            },
          }
        : {}),
    };
    if (this.options.roots && !capabilities.roots) {
      capabilities.roots = { listChanged: true };
    }
    if (this.options.sampling && !capabilities.sampling) {
      capabilities.sampling = { context: {}, tools: {} };
    }
    if (this.options.elicitation && !capabilities.elicitation) {
      capabilities.elicitation = { form: {}, url: {} };
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
    const seen = new Set<string>();
    let page = 0;
    do {
      this.assertPaginationPage('tools/list', ++page, cursor, seen);
      const result = await this.listTools(cursor);
      this.tools.push(...result.tools);
      this.functions.push(...result.tools.map((fn) => this.toolToFunction(fn)));
      cursor = result.nextCursor;
    } while (cursor);
  }

  private async discoverPromptFunctions(): Promise<void> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    let page = 0;
    do {
      this.assertPaginationPage('prompts/list', ++page, cursor, seen);
      const result = await this.listPrompts(cursor);
      for (const prompt of result.prompts ?? []) {
        this.prompts.push(prompt);
        this.promptFunctions.push(this.promptToFunction(prompt));
      }
      cursor = result.nextCursor;
    } while (cursor);
  }

  private async discoverResourceFunctions(): Promise<void> {
    let cursor: string | undefined;
    let seen = new Set<string>();
    let page = 0;
    do {
      this.assertPaginationPage('resources/list', ++page, cursor, seen);
      const result = await this.listResources(cursor);
      for (const resource of result.resources ?? []) {
        this.resources.push(resource);
        this.resourceFunctions.push(this.resourceToFunction(resource));
      }
      cursor = result.nextCursor;
    } while (cursor);

    cursor = undefined;
    seen = new Set<string>();
    page = 0;
    do {
      this.assertPaginationPage(
        'resources/templates/list',
        ++page,
        cursor,
        seen
      );
      const result = await this.listResourceTemplates(cursor);
      for (const template of result.resourceTemplates ?? []) {
        this.resourceTemplates.push(template);
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

  hasTasksCapability(): boolean {
    return this.isCapabilityEnabled(
      this.serverCapabilities.tasks as CapabilityValue
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

  async callTool(
    name: string,
    args?: unknown,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPToolCallResult> {
    if (!this.hasToolsCapability()) {
      throw new Error('Tools are not supported');
    }

    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`MCP tool not found: ${name}`);
    const authorization = await this.options.authorizeToolCall?.({
      client: this,
      namespace: this.getNamespace(),
      tool,
      arguments: args,
    });
    if (authorization === false) {
      throw new Error(`MCP tool call denied by host policy: ${name}`);
    }

    return this.withToolCallSlot(
      options?.signal,
      this.toolConcurrencyLimit(tool),
      async () => {
        const { result } = await this.sendRequest<
          AxMCPToolCallParams,
          AxMCPToolCallResult
        >('tools/call', { name, arguments: args }, options);
        return result;
      }
    );
  }

  async callToolTask(
    name: string,
    args?: unknown,
    task: AxMCPTaskMetadata = {},
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPCreateTaskResult> {
    if (!this.hasToolsCapability() || !this.hasTasksCapability()) {
      throw new Error('Task-augmented tool calls are not supported');
    }
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`MCP tool not found: ${name}`);
    const authorization = await this.options.authorizeToolCall?.({
      client: this,
      namespace: this.getNamespace(),
      tool,
      arguments: args,
    });
    if (authorization === false) {
      throw new Error(`MCP tool call denied by host policy: ${name}`);
    }
    return this.withToolCallSlot(
      options?.signal,
      this.toolConcurrencyLimit(tool),
      async () => {
        const { result } = await this.sendRequest<
          AxMCPToolCallParams,
          AxMCPCreateTaskResult
        >('tools/call', { name, arguments: args, task }, options);
        await this.recordTask(result.task);
        return result;
      }
    );
  }

  async listTasks(cursor?: string): Promise<AxMCPTasksListResult> {
    if (!this.hasTasksCapability()) throw new Error('Tasks are not supported');
    const { result } = await this.sendRequest<
      { cursor?: string } | undefined,
      AxMCPTasksListResult
    >('tasks/list', cursor ? { cursor } : undefined);
    await Promise.all(result.tasks.map((task) => this.recordTask(task)));
    return result;
  }

  async getTask(taskId: string): Promise<AxMCPTask> {
    if (!this.hasTasksCapability()) throw new Error('Tasks are not supported');
    const { result } = await this.sendRequest<{ taskId: string }, AxMCPTask>(
      'tasks/get',
      { taskId }
    );
    await this.recordTask(result);
    return result;
  }

  async getTaskResult<T = AxMCPToolCallResult>(taskId: string): Promise<T> {
    if (!this.hasTasksCapability()) throw new Error('Tasks are not supported');
    const { result } = await this.sendRequest<{ taskId: string }, T>(
      'tasks/result',
      { taskId }
    );
    return result;
  }

  async cancelTask(taskId: string): Promise<AxMCPTask> {
    if (!this.hasTasksCapability()) throw new Error('Tasks are not supported');
    const { result } = await this.sendRequest<{ taskId: string }, AxMCPTask>(
      'tasks/cancel',
      { taskId }
    );
    await this.recordTask(result);
    return result;
  }

  getKnownTasks(): readonly AxMCPTask[] {
    return [...this.tasks.values()].map((task) => structuredClone(task));
  }

  subscribeTaskStatus(
    listener: (task: Readonly<AxMCPTask>) => void | Promise<void>
  ): () => void {
    this.taskStatusListeners.add(listener);
    return () => this.taskStatusListeners.delete(listener);
  }

  async waitForTask<T = AxMCPToolCallResult>(
    taskId: string,
    options: Readonly<{
      signal?: AbortSignal;
      timeoutMs?: number;
      defaultPollIntervalMs?: number;
    }> = {}
  ): Promise<T> {
    const startedAt = Date.now();
    for (;;) {
      if (options.signal?.aborted) {
        throw new Error(
          `MCP task wait aborted: ${String(options.signal.reason ?? '')}`
        );
      }
      if (
        options.timeoutMs !== undefined &&
        Date.now() - startedAt >= options.timeoutMs
      ) {
        throw new Error(`MCP task wait timed out after ${options.timeoutMs}ms`);
      }
      const task = await this.getTask(taskId);
      if (task.status === 'completed') return this.getTaskResult<T>(taskId);
      if (task.status === 'failed' || task.status === 'cancelled') {
        throw new Error(
          `MCP task ${taskId} ${task.status}: ${task.statusMessage ?? 'no status message'}`
        );
      }
      if (task.status === 'input_required') {
        throw new Error(
          `MCP task ${taskId} requires input: ${task.statusMessage ?? 'no status message'}`
        );
      }
      await this.delayWithSignal(
        task.pollInterval ?? options.defaultPollIntervalMs ?? 1000,
        options.signal
      );
    }
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
    if (this.resourceSubscriptions.has(uri)) return;

    await this.sendRequest<{ uri: string }>('resources/subscribe', { uri });
    this.resourceSubscriptions.add(uri);
  }

  async unsubscribeResource(uri: string): Promise<void> {
    if (
      !this.hasResourcesCapability() ||
      !this.hasSubCapability(this.serverCapabilities.resources, 'subscribe')
    ) {
      throw new Error('Resource subscriptions are not supported');
    }

    await this.sendRequest<{ uri: string }>('resources/unsubscribe', { uri });
    this.resourceSubscriptions.delete(uri);
  }

  getResourceSubscriptions(): readonly string[] {
    return [...this.resourceSubscriptions].sort();
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
      if (
        request.method === 'sampling/createMessage' &&
        this.options.sampling
      ) {
        const result = await this.options.sampling(
          request.params as AxMCPSamplingCreateMessageParams,
          { client: this, namespace: this.getNamespace() }
        );
        await sendResponse({ jsonrpc: '2.0', id: request.id, result });
        return;
      }
      if (request.method === 'elicitation/create' && this.options.elicitation) {
        const result = await this.options.elicitation(
          request.params as AxMCPElicitationCreateParams,
          { client: this, namespace: this.getNamespace() }
        );
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
        await this.refresh();
        await this.options.onToolsChanged?.();
        break;
      case 'notifications/prompts/list_changed':
        await this.refresh();
        await this.options.onPromptsChanged?.();
        break;
      case 'notifications/resources/list_changed':
        await this.refresh();
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
      case 'notifications/progress':
        await this.options.onProgress?.(
          notification.params as unknown as AxMCPProgressNotificationParams
        );
        break;
      case 'notifications/tasks/status': {
        const params = notification.params as
          | AxMCPTask
          | { task?: AxMCPTask }
          | undefined;
        const task =
          params && typeof params === 'object' && 'task' in params
            ? params.task
            : (params as AxMCPTask | undefined);
        if (task?.taskId) await this.recordTask(task);
        break;
      }
    }
  }

  private async recordTask(task: Readonly<AxMCPTask>): Promise<void> {
    const snapshot = structuredClone(task);
    this.tasks.set(snapshot.taskId, snapshot);
    await this.options.onTaskStatus?.(snapshot);
    await Promise.all(
      [...this.taskStatusListeners].map((listener) => listener(snapshot))
    );
  }

  private assertPaginationPage(
    method: string,
    page: number,
    cursor: string | undefined,
    seen: Set<string>
  ): void {
    const maxPages = this.options.maxPaginationPages ?? 1000;
    if (page > maxPages) {
      throw new Error(`MCP ${method} exceeded ${maxPages} pagination pages`);
    }
    if (!cursor) return;
    if (seen.has(cursor)) {
      throw new Error(`MCP ${method} repeated pagination cursor ${cursor}`);
    }
    seen.add(cursor);
  }

  private async withToolCallSlot<T>(
    signal: AbortSignal | undefined,
    limit: number,
    operation: () => Promise<T>
  ): Promise<T> {
    const release = await this.acquireToolCallSlot(limit, signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquireToolCallSlot(
    limit: number,
    signal?: AbortSignal
  ): Promise<() => void> {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('MCP tool call aborted');
    }
    if (this.toolCallQueue.length === 0 && this.activeToolCalls < limit) {
      this.activeToolCalls++;
      return () => this.releaseToolCallSlot();
    }
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', abort);
        this.activeToolCalls++;
        resolve();
      };
      const abort = () => {
        const index = this.toolCallQueue.findIndex(
          (entry) => entry.start === start
        );
        if (index >= 0) this.toolCallQueue.splice(index, 1);
        reject(signal?.reason ?? new Error('MCP tool call aborted'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.toolCallQueue.push({ limit, start });
    });
    return () => this.releaseToolCallSlot();
  }

  private releaseToolCallSlot(): void {
    this.activeToolCalls = Math.max(0, this.activeToolCalls - 1);
    const next = this.toolCallQueue[0];
    if (next && this.activeToolCalls < next.limit) {
      this.toolCallQueue.shift();
      next.start();
    }
  }

  private toolConcurrencyLimit(tool: Readonly<AxMCPTool>): number {
    if (
      tool.annotations?.destructiveHint === true ||
      tool.annotations?.idempotentHint === false
    ) {
      return 1;
    }
    return this.options.maxConcurrency ?? Number.POSITIVE_INFINITY;
  }

  private delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(
          new Error(`MCP operation aborted: ${String(signal.reason ?? '')}`)
        );
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(
          new Error(`MCP operation aborted: ${String(signal.reason ?? '')}`)
        );
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async sendRequest<T = unknown, R = unknown>(
    method: string,
    params?: T,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<{ id: string; result: R }> {
    const requestId = randomUUID();
    const request: AxMCPJSONRPCRequest<T> = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const taskId =
      params && typeof params === 'object' && 'taskId' in params
        ? String((params as { taskId: unknown }).taskId)
        : undefined;
    const protocolSpan = this.options.tracer?.startSpan(`MCP ${method}`, {
      attributes: {
        'rpc.system': 'jsonrpc',
        'rpc.method': method,
        'mcp.namespace': this.getNamespace(),
        'mcp.protocol.version':
          this.negotiatedProtocolVersion ?? this.options.protocolVersion ?? '',
        'mcp.server.name': this.serverInfo?.name ?? '',
        'mcp.request.id': requestId,
        ...(taskId ? { 'mcp.task.id': taskId } : {}),
      },
    });

    const responsePromise = new Promise<{ result: R }>((resolve, reject) => {
      this.activeRequests.set(requestId, { reject });
      const sendPromise = options
        ? this.transport.send(request, options)
        : this.transport.send(request);
      sendPromise
        .then((res: unknown) => {
          this.activeRequests.delete(requestId);
          const metadata = this.transport.takeRequestMetadata?.(requestId);
          protocolSpan?.setAttribute(
            'mcp.retry_count',
            metadata?.retryCount ?? 0
          );
          if (
            res !== null &&
            typeof res === 'object' &&
            'id' in res &&
            (res as { id: unknown }).id !== requestId
          ) {
            reject(
              new Error(
                `MCP response ID mismatch: expected ${requestId}, received ${String((res as { id: unknown }).id)}`
              )
            );
            return;
          }
          if (res !== null && typeof res === 'object' && 'error' in res) {
            const errorObj = res as {
              error: { code: number; message: string };
            };
            protocolSpan?.setAttribute(
              'rpc.jsonrpc.error_code',
              errorObj.error.code
            );
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

    try {
      const { result } = await responsePromise;
      protocolSpan?.setStatus({ code: SpanStatusCode.OK });
      protocolSpan?.end();
      return { id: requestId, result };
    } catch (error) {
      protocolSpan?.setAttribute(
        'mcp.error.type',
        error instanceof Error ? error.name : typeof error
      );
      protocolSpan?.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'MCP protocol request failed',
      });
      protocolSpan?.end();
      if (
        this.options.sessionRecovery !== 'none' &&
        method !== 'initialize' &&
        error instanceof Error &&
        error.message.includes('MCP session expired')
      ) {
        if (!this.isSafeSessionRecoveryMethod(method)) {
          throw new Error(
            `MCP session expired during ${method}; Ax will not replay an ambiguous side-effecting request`,
            { cause: error }
          );
        }
        await this.recoverSession();
        return this.sendRequest<T, R>(method, params, options);
      }
      throw error;
    }
  }

  private isSafeSessionRecoveryMethod(method: string): boolean {
    return (
      method === 'ping' ||
      method.endsWith('/list') ||
      method.endsWith('/get') ||
      method.endsWith('/read') ||
      method === 'completion/complete' ||
      method === 'tasks/result'
    );
  }

  private async recoverSession(): Promise<void> {
    if (this.sessionRecoveryPromise) return this.sessionRecoveryPromise;
    this.sessionRecoveryPromise = (async () => {
      const subscriptions = [...this.resourceSubscriptions];
      this.resourceSubscriptions.clear();
      this.initialized = false;
      await this.initialize();
      this.initialized = true;
      for (const uri of subscriptions) await this.subscribeResource(uri);
    })();
    try {
      await this.sessionRecoveryPromise;
    } finally {
      this.sessionRecoveryPromise = undefined;
    }
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
