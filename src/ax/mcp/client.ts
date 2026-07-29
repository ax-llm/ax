import type { Tracer } from '@opentelemetry/api';
import { context, propagation, SpanStatusCode } from '@opentelemetry/api';
import type {
  AxFunction,
  AxFunctionJSONSchema,
  AxLoggerData,
  AxLoggerFunction,
} from '../ai/types.js';
import { randomUUID } from '../util/crypto.js';
import { AX_MCP_ERROR_CODES, AxMCPProtocolError } from './errors.js';
import type { AxMCPExtensionCapability } from './extensions.js';
import {
  AX_MCP_META_KEYS,
  axMCPBuildRequestMeta,
  axMCPServerInfoFromMeta,
} from './meta.js';
import { axMCPFulfillInputRequests } from './mrtr.js';
import type {
  AxMCPEra,
  AxMCPListeningHandle,
  AxMCPRequestOptions,
  AxMCPTransport,
} from './transport.js';
import {
  AX_MCP_MODERN_PROTOCOL_VERSION,
  AX_MCP_PROTOCOL_VERSION,
  AX_MCP_SUPPORTED_PROTOCOL_VERSIONS,
  type AxMCPBatchRequest,
  type AxMCPBatchResponse,
  type AxMCPBlobResourceContents,
  type AxMCPCacheableResult,
  type AxMCPClientCapabilities,
  type AxMCPCompletionArgument,
  type AxMCPCompletionReference,
  type AxMCPCompletionRequest,
  type AxMCPCompletionResult,
  type AxMCPContent,
  type AxMCPCreateTaskResult,
  type AxMCPDiscoverResult,
  type AxMCPElicitationCreateParams,
  type AxMCPElicitationCreateResult,
  type AxMCPImplementationInfo,
  type AxMCPInitializeParams,
  type AxMCPInitializeResult,
  type AxMCPInputRequiredResult,
  type AxMCPInputResponseRequestParams,
  type AxMCPJSONRPCMessage,
  type AxMCPJSONRPCNotification,
  type AxMCPJSONRPCRequest,
  type AxMCPListRootsResult,
  type AxMCPLoggingLevel,
  type AxMCPMeta,
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
  type AxMCPSubscriptionFilter,
  type AxMCPSubscriptionsAcknowledgedParams,
  type AxMCPSubscriptionsListenParams,
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

export interface AxMCPCatalogSnapshot {
  namespace: string;
  protocolVersion?: string;
  revision: number;
  serverInfo?: AxMCPImplementationInfo;
  serverCapabilities: AxMCPServerCapabilities;
  tools: readonly AxMCPTool[];
  prompts: readonly AxMCPPrompt[];
  resources: readonly AxMCPResource[];
  resourceTemplates: readonly AxMCPResourceTemplate[];
  subscriptions: readonly string[];
  cache: Readonly<Partial<Record<AxMCPCatalogCacheName, AxMCPCacheInfo>>>;
}

export type AxMCPCatalogCacheName =
  | 'tools'
  | 'prompts'
  | 'resources'
  | 'resourceTemplates';

export interface AxMCPCacheInfo {
  ttlMs?: number;
  cacheScope?: 'private' | 'public';
  fetchedAt: number;
  expiresAt?: number;
}

export type AxMCPClientEvent =
  | {
      type: 'catalog_changed';
      catalog: 'tools' | 'prompts' | 'resources';
      revision: number;
    }
  | { type: 'resource_updated'; uri: string }
  | {
      type: 'logging';
      params: Readonly<Record<string, unknown>>;
    }
  | {
      type: 'progress';
      params: Readonly<AxMCPProgressNotificationParams>;
    }
  | { type: 'task_status'; task: Readonly<AxMCPTask> }
  | { type: 'lifecycle'; state: 'reconnected' }
  | { type: 'notification'; notification: Readonly<AxMCPJSONRPCNotification> };

export interface AxMCPClientListeningOptions {
  signal?: AbortSignal;
  retryDelayMs?: number;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface AxMCPEraStore {
  get(key: string): AxMCPEra | undefined | Promise<AxMCPEra | undefined>;
  set(key: string, era: AxMCPEra): void | Promise<void>;
}

export interface AxMCPClientOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Logger function for debug output */
  logger?: AxLoggerFunction;
  /** MCP protocol version to request during initialize. Defaults to latest. */
  protocolVersion?: string;
  /** Protocol era selection. Auto-detection is the default. */
  era?: 'auto' | AxMCPEra;
  /** Optional persistence for origin-scoped automatic era detection. */
  eraStore?: AxMCPEraStore;
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
  /** Maximum MCP 2026-07-28 multi round-trip input rounds. Defaults to 5. */
  maxInputRounds?: number;
  /** Enables TTL-aware caching for modern resources/read results. */
  readCache?: boolean;
  /** Maximum pages accepted from any single catalog listing. */
  maxPaginationPages?: number;
  /** Reinitialize expired HTTP sessions for safe requests. Defaults to safe. */
  sessionRecovery?: 'safe' | 'none';
  /** Optional protocol tracer; request spans contain sanitized MCP metadata. */
  tracer?: Tracer;
  /** Default modern per-request logging level. */
  logLevel?: AxMCPLoggingLevel;
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
const MANUAL_RESOURCE_SUBSCRIPTION_OWNER = 'manual';
const MCP_ERA_CACHE = new Map<string, AxMCPEra>();

export class AxMCPClient {
  private functions: AxFunction[] = [];
  private tools: AxMCPTool[] = [];
  private prompts: AxMCPPrompt[] = [];
  private resources: AxMCPResource[] = [];
  private resourceTemplates: AxMCPResourceTemplate[] = [];
  private promptFunctions: AxFunction[] = [];
  private resourceFunctions: AxFunction[] = [];
  private activeRequests: Map<
    string,
    { reject: (reason: unknown) => void; controller: AbortController }
  > = new Map();
  private serverCapabilities: AxMCPServerCapabilities = {};
  private negotiatedProtocolVersion?: string;
  private era?: AxMCPEra;
  private discoverResult?: AxMCPDiscoverResult;
  private logLevel?: AxMCPLoggingLevel;
  private serverInfo?: AxMCPImplementationInfo;
  private serverInstructions?: string;
  private logger: AxLoggerFunction;
  private initPromise?: Promise<void>;
  private initialized = false;
  private refreshPromise?: Promise<void>;
  private readonly catalogCache: Partial<
    Record<AxMCPCatalogCacheName, AxMCPCacheInfo>
  > = {};
  private readonly resourceReadCache = new Map<
    string,
    { result: AxMCPResourceReadResult; cache: AxMCPCacheInfo }
  >();
  private catalogRevision = 0;
  private negotiatedExtensions: Record<string, AxMCPExtensionCapability> = {};
  private activeToolCalls = 0;
  private readonly toolCallQueue: Array<{
    limit: number;
    start: () => void;
  }> = [];
  private readonly tasks = new Map<string, AxMCPTask>();
  private readonly resourceSubscriptionOwners = new Map<string, Set<string>>();
  private resourceSubscriptionTransition = Promise.resolve();
  private activeModernListening?: AxMCPListeningHandle;
  private modernListenRestartRequested = false;
  private activeSubscriptionId?: string;
  private modernListenReadyResolve?: () => void;
  private readonly taskStatusListeners = new Set<
    (task: Readonly<AxMCPTask>) => void | Promise<void>
  >();
  private readonly eventListeners = new Set<
    (event: Readonly<AxMCPClientEvent>) => void | Promise<void>
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
    if (
      options.maxInputRounds !== undefined &&
      (!Number.isInteger(options.maxInputRounds) || options.maxInputRounds < 1)
    ) {
      throw new Error('MCP maxInputRounds must be a positive integer');
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
    this.logLevel = options.logLevel;
    this.transport.setMessageHandler?.((message) => {
      return this.handleInboundMessage(message);
    });
    this.transport.setLifecycleHandler?.((state) => {
      return this.handleTransportLifecycle(state);
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

    const configuredEra = this.options.era ?? 'auto';
    if (configuredEra !== 'auto') {
      await this.initializeForEra(configuredEra);
      await this.rememberEra(configuredEra);
      return;
    }

    const knownEra = await this.knownEra();
    if (knownEra) {
      await this.initializeForEra(knownEra);
      await this.rememberEra(knownEra);
      return;
    }

    this.applyEra('modern');
    try {
      const discovery = await this.requestDiscovery();
      if (!this.isDiscoverResult(discovery)) {
        throw new Error('Invalid MCP server/discover result');
      }
      this.applyModernDiscovery(discovery);
    } catch (error) {
      if (
        error instanceof AxMCPProtocolError &&
        error.code === AX_MCP_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION
      ) {
        throw error;
      }
      await this.initializeLegacy();
      await this.rememberEra('legacy');
      return;
    }
    await this.rememberEra('modern');
    await this.refresh();
  }

  private async initializeForEra(era: AxMCPEra): Promise<void> {
    if (era === 'legacy') {
      await this.initializeLegacy();
      return;
    }
    this.applyEra('modern');
    const discovery = await this.requestDiscovery();
    if (!this.isDiscoverResult(discovery)) {
      throw new Error('Invalid MCP server/discover result');
    }
    this.applyModernDiscovery(discovery);
    await this.refresh();
  }

  private async initializeLegacy(): Promise<void> {
    this.applyEra('legacy');

    const protocolVersion =
      this.options.protocolVersion ?? AX_MCP_PROTOCOL_VERSION;
    const { result: res } = await this.sendRequest<
      AxMCPInitializeParams,
      AxMCPInitializeResult
    >('initialize', {
      protocolVersion,
      capabilities: this.buildClientCapabilities(),
      clientInfo: this.clientInfo(),
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
    this.negotiateExtensions();
    this.serverInfo = res.serverInfo;
    this.serverInstructions = res.instructions;

    await this.sendNotification('notifications/initialized');
    await this.refresh();
  }

  private clientInfo(): AxMCPImplementationInfo {
    return {
      name: 'AxMCPClient',
      title: 'Ax MCP Client',
      version: '1.0.0',
      ...this.options.clientInfo,
    };
  }

  private negotiateExtensions(): void {
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
  }

  private applyEra(era: AxMCPEra): void {
    this.era = era;
    this.transport.setEra?.(era);
    if (era === 'modern') {
      this.negotiatedProtocolVersion = AX_MCP_MODERN_PROTOCOL_VERSION;
      this.transport.setProtocolVersion?.(AX_MCP_MODERN_PROTOCOL_VERSION);
    } else {
      this.negotiatedProtocolVersion = undefined;
    }
  }

  private async knownEra(): Promise<AxMCPEra | undefined> {
    if (this.transport.eraHint) return this.transport.eraHint;
    const key = this.transport.eraCacheKey;
    if (!key) return;
    const cached = MCP_ERA_CACHE.get(key);
    if (cached) return cached;
    const stored = await this.options.eraStore?.get(key);
    if (stored === 'modern' || stored === 'legacy') {
      MCP_ERA_CACHE.set(key, stored);
      return stored;
    }
    return;
  }

  private async rememberEra(era: AxMCPEra): Promise<void> {
    const key = this.transport.eraCacheKey;
    if (!key) return;
    MCP_ERA_CACHE.set(key, era);
    await this.options.eraStore?.set(key, era);
  }

  private async requestDiscovery(): Promise<AxMCPDiscoverResult> {
    const { result } = await this.sendRequest<
      Record<string, never>,
      AxMCPDiscoverResult
    >('server/discover', {});
    return result;
  }

  private isDiscoverResult(value: unknown): value is AxMCPDiscoverResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const result = value as Partial<AxMCPDiscoverResult>;
    return (
      result.resultType === 'complete' &&
      Array.isArray(result.supportedVersions) &&
      result.supportedVersions.every(
        (version) => typeof version === 'string'
      ) &&
      Boolean(
        result.capabilities &&
          typeof result.capabilities === 'object' &&
          !Array.isArray(result.capabilities)
      ) &&
      Number.isInteger(result.ttlMs) &&
      Number(result.ttlMs) >= 0 &&
      (result.cacheScope === 'private' || result.cacheScope === 'public')
    );
  }

  private applyModernDiscovery(result: AxMCPDiscoverResult): void {
    this.discoverResult = structuredClone(result);
    this.serverCapabilities = structuredClone(result.capabilities);
    this.serverInstructions = result.instructions;
    this.serverInfo = axMCPServerInfoFromMeta(result._meta) ?? this.serverInfo;
    this.negotiateExtensions();
  }

  getEra(): AxMCPEra | undefined {
    return this.era;
  }

  async discover(): Promise<AxMCPDiscoverResult> {
    await this.init();
    if (this.era !== 'modern') {
      throw new Error('server/discover is only available for modern MCP');
    }
    const result = await this.requestDiscovery();
    if (!this.isDiscoverResult(result)) {
      throw new Error('Invalid MCP server/discover result');
    }
    this.applyModernDiscovery(result);
    return structuredClone(result);
  }

  async refresh(options: Readonly<{ force?: boolean }> = {}): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      if (await this.refreshCatalog(options.force ?? true)) {
        this.catalogRevision++;
      }
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refreshCatalog(force: boolean): Promise<boolean> {
    let changed = false;

    if (
      this.hasToolsCapability() &&
      (force || !this.isCatalogCacheFresh('tools'))
    ) {
      this.functions = [];
      this.tools = [];
      await this.discoverFunctions();
      changed = true;
    }

    if (
      this.hasPromptsCapability() &&
      (force || !this.isCatalogCacheFresh('prompts'))
    ) {
      this.prompts = [];
      this.promptFunctions = [];
      await this.discoverPromptFunctions();
      changed = true;
    }

    if (
      this.hasResourcesCapability() &&
      (force ||
        !this.isCatalogCacheFresh('resources') ||
        !this.isCatalogCacheFresh('resourceTemplates'))
    ) {
      this.resources = [];
      this.resourceTemplates = [];
      this.resourceFunctions = [];
      await this.discoverResourceFunctions();
      changed = true;
    }
    return changed;
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

  async inspectCatalog(
    options: Readonly<{ refresh?: boolean }> = {}
  ): Promise<AxMCPCatalogSnapshot> {
    await this.init();
    if (options.refresh) await this.refresh();
    return structuredClone({
      namespace: this.getNamespace(),
      protocolVersion: this.negotiatedProtocolVersion,
      revision: this.catalogRevision,
      serverInfo: this.serverInfo,
      serverCapabilities: this.serverCapabilities,
      tools: this.tools,
      prompts: this.prompts,
      resources: this.resources,
      resourceTemplates: this.resourceTemplates,
      subscriptions: this.getResourceSubscriptions(),
      cache: this.catalogCache,
    });
  }

  async close(): Promise<void> {
    try {
      await this.transport.terminateSession?.();
    } finally {
      await this.transport.close?.();
      this.resourceSubscriptionOwners.clear();
      this.resourceReadCache.clear();
      this.activeModernListening = undefined;
      this.activeSubscriptionId = undefined;
      this.modernListenReadyResolve = undefined;
      this.modernListenRestartRequested = false;
      this.initialized = false;
      this.negotiatedProtocolVersion = undefined;
      this.era = undefined;
      this.discoverResult = undefined;
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
    const pages: AxMCPCacheableResult[] = [];
    let page = 0;
    do {
      this.assertPaginationPage('tools/list', ++page, cursor, seen);
      const result = await this.listTools(cursor);
      pages.push(result);
      this.tools.push(...result.tools);
      this.functions.push(...result.tools.map((fn) => this.toolToFunction(fn)));
      cursor = result.nextCursor;
    } while (cursor);
    this.recordCatalogCache('tools', pages);
  }

  private async discoverPromptFunctions(): Promise<void> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    const pages: AxMCPCacheableResult[] = [];
    let page = 0;
    do {
      this.assertPaginationPage('prompts/list', ++page, cursor, seen);
      const result = await this.listPrompts(cursor);
      pages.push(result);
      for (const prompt of result.prompts ?? []) {
        this.prompts.push(prompt);
        this.promptFunctions.push(this.promptToFunction(prompt));
      }
      cursor = result.nextCursor;
    } while (cursor);
    this.recordCatalogCache('prompts', pages);
  }

  private async discoverResourceFunctions(): Promise<void> {
    let cursor: string | undefined;
    let seen = new Set<string>();
    const resourcePages: AxMCPCacheableResult[] = [];
    let page = 0;
    do {
      this.assertPaginationPage('resources/list', ++page, cursor, seen);
      const result = await this.listResources(cursor);
      resourcePages.push(result);
      for (const resource of result.resources ?? []) {
        this.resources.push(resource);
        this.resourceFunctions.push(this.resourceToFunction(resource));
      }
      cursor = result.nextCursor;
    } while (cursor);
    this.recordCatalogCache('resources', resourcePages);

    cursor = undefined;
    seen = new Set<string>();
    const templatePages: AxMCPCacheableResult[] = [];
    page = 0;
    do {
      this.assertPaginationPage(
        'resources/templates/list',
        ++page,
        cursor,
        seen
      );
      const result = await this.listResourceTemplates(cursor);
      templatePages.push(result);
      for (const template of result.resourceTemplates ?? []) {
        this.resourceTemplates.push(template);
        this.resourceFunctions.push(this.resourceTemplateToFunction(template));
      }
      cursor = result.nextCursor;
    } while (cursor);
    this.recordCatalogCache('resourceTemplates', templatePages);
  }

  private recordCatalogCache(
    name: AxMCPCatalogCacheName,
    pages: readonly AxMCPCacheableResult[]
  ): void {
    this.catalogCache[name] = this.cacheInfo(pages);
  }

  private cacheInfo(results: readonly AxMCPCacheableResult[]): AxMCPCacheInfo {
    const fetchedAt = Date.now();
    const ttlValues = results.map((result) => result.ttlMs);
    const ttlMs = ttlValues.every(
      (value): value is number => typeof value === 'number' && value >= 0
    )
      ? Math.min(...ttlValues)
      : undefined;
    const scopes = results
      .map((result) => result.cacheScope)
      .filter((scope): scope is 'private' | 'public' => scope !== undefined);
    const cacheScope = scopes.includes('private')
      ? 'private'
      : scopes.length === results.length && scopes.length > 0
        ? 'public'
        : undefined;
    return {
      ttlMs,
      cacheScope,
      fetchedAt,
      ...(ttlMs === undefined ? {} : { expiresAt: fetchedAt + ttlMs }),
    };
  }

  private isCatalogCacheFresh(name: AxMCPCatalogCacheName): boolean {
    const expiresAt = this.catalogCache[name]?.expiresAt;
    return expiresAt !== undefined && Date.now() < expiresAt;
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
      () =>
        this.requestWithInputRounds<AxMCPToolCallParams, AxMCPToolCallResult>(
          'tools/call',
          { name, arguments: args },
          options
        )
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

  subscribeEvents(
    listener: (event: Readonly<AxMCPClientEvent>) => void | Promise<void>
  ): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async startListening(
    options: Readonly<AxMCPClientListeningOptions> = {}
  ): Promise<AxMCPListeningHandle> {
    await this.init();
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    let active: AxMCPListeningHandle | undefined;
    let readyResolved = false;
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = () => {
        readyResolved = true;
        resolve();
      };
    });
    const done = (async () => {
      if (this.era === 'modern' && !this.transport.openRequestStream) {
        throw new Error(
          'The configured MCP transport does not support subscriptions/listen request streams'
        );
      }
      if (this.era !== 'modern' && !this.transport.startListening) {
        resolveReady();
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
      while (!signal.aborted) {
        try {
          if (this.era === 'modern') {
            const id = randomUUID();
            this.activeSubscriptionId = id;
            this.modernListenReadyResolve = resolveReady;
            const params =
              this.buildModernRequestParams<AxMCPSubscriptionsListenParams>(
                { notifications: this.modernSubscriptionFilter() },
                undefined,
                {}
              );
            active = await this.transport.openRequestStream!(
              {
                jsonrpc: '2.0',
                id,
                method: 'subscriptions/listen',
                params,
              },
              { signal }
            );
            this.activeModernListening = active;
          } else {
            active = await this.transport.startListening!({ signal });
            await active.ready;
            resolveReady();
          }
          await active.done;
          if (this.activeModernListening === active) {
            this.activeModernListening = undefined;
          }
          if (signal.aborted) return;
          if (this.modernListenRestartRequested) {
            this.modernListenRestartRequested = false;
            continue;
          }
          throw new Error('MCP listening transport ended unexpectedly');
        } catch (error) {
          if (this.activeModernListening === active) {
            this.activeModernListening = undefined;
          }
          if (signal.aborted) return;
          if (this.modernListenRestartRequested) {
            this.modernListenRestartRequested = false;
            continue;
          }
          await options.onError?.(error);
          if (this.era === 'legacy') {
            try {
              await this.recoverSession();
            } catch (recoveryError) {
              await options.onError?.(recoveryError);
            }
          }
          await this.emitEvent({
            type: 'lifecycle',
            state: 'reconnected',
          });
          await this.listeningDelay(options.retryDelayMs ?? 1_000, signal);
        }
      }
    })();
    return {
      ready,
      done,
      close: async () => {
        controller.abort('MCP client listener closed');
        await active?.close();
        await done;
        if (!readyResolved) this.modernListenReadyResolve = undefined;
      },
    };
  }

  private modernSubscriptionFilter(): AxMCPSubscriptionFilter {
    const eventInterest = this.eventListeners.size > 0;
    return {
      ...(this.hasSubCapability(this.serverCapabilities.tools, 'listChanged') &&
      (eventInterest || this.options.onToolsChanged)
        ? { toolsListChanged: true }
        : {}),
      ...(this.hasSubCapability(
        this.serverCapabilities.prompts,
        'listChanged'
      ) &&
      (eventInterest || this.options.onPromptsChanged)
        ? { promptsListChanged: true }
        : {}),
      ...(this.hasSubCapability(
        this.serverCapabilities.resources,
        'listChanged'
      ) &&
      (eventInterest || this.options.onResourcesChanged)
        ? { resourcesListChanged: true }
        : {}),
      ...(this.hasResourcesCapability() &&
      this.resourceSubscriptionOwners.size > 0
        ? { resourceSubscriptions: this.getResourceSubscriptions() as string[] }
        : {}),
    };
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
    args?: Record<string, string>,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPPromptGetResult> {
    if (!this.hasPromptsCapability()) {
      throw new Error('Prompts are not supported');
    }

    return this.requestWithInputRounds<
      {
        name: string;
        arguments?: Record<string, string>;
      } & AxMCPInputResponseRequestParams,
      AxMCPPromptGetResult
    >('prompts/get', { name, arguments: args }, options);
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

  async readResource(
    uri: string,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<AxMCPResourceReadResult> {
    if (!this.hasResourcesCapability()) {
      throw new Error('Resources are not supported');
    }

    if (this.era === 'modern' && this.options.readCache) {
      const cached = this.resourceReadCache.get(uri);
      if (
        cached?.cache.expiresAt !== undefined &&
        Date.now() < cached.cache.expiresAt
      ) {
        return structuredClone(cached.result);
      }
      this.resourceReadCache.delete(uri);
    }

    const result = await this.requestWithInputRounds<
      { uri: string } & AxMCPInputResponseRequestParams,
      AxMCPResourceReadResult
    >('resources/read', { uri }, options);
    if (this.era === 'modern' && this.options.readCache) {
      const cache = this.cacheInfo([result]);
      if (cache.expiresAt !== undefined) {
        this.resourceReadCache.set(uri, {
          result: structuredClone(result),
          cache,
        });
      }
    }
    return result;
  }

  async subscribeResource(uri: string): Promise<void> {
    await this.acquireResourceSubscription(
      uri,
      MANUAL_RESOURCE_SUBSCRIPTION_OWNER
    );
  }

  async unsubscribeResource(uri: string): Promise<void> {
    await this.releaseResourceSubscription(
      uri,
      MANUAL_RESOURCE_SUBSCRIPTION_OWNER
    );
  }

  /** Acquires one logical owner for a resource subscription. */
  async acquireResourceSubscription(uri: string, owner: string): Promise<void> {
    this.assertResourceSubscriptionCapability();
    if (!uri) throw new Error('Resource subscription URI cannot be empty');
    if (!owner) throw new Error('Resource subscription owner cannot be empty');
    await this.withResourceSubscriptionTransition(async () => {
      const owners = this.resourceSubscriptionOwners.get(uri);
      if (owners?.has(owner)) return;
      if (this.era !== 'modern' && (!owners || owners.size === 0)) {
        await this.sendRequest<{ uri: string }>('resources/subscribe', { uri });
      }
      const nextOwners = owners ?? new Set<string>();
      nextOwners.add(owner);
      this.resourceSubscriptionOwners.set(uri, nextOwners);
      if (this.era === 'modern') await this.restartModernListener();
    });
  }

  /** Releases one logical owner without disturbing other subscribers. */
  async releaseResourceSubscription(uri: string, owner: string): Promise<void> {
    this.assertResourceSubscriptionCapability();
    await this.withResourceSubscriptionTransition(async () => {
      const owners = this.resourceSubscriptionOwners.get(uri);
      if (!owners?.has(owner)) return;
      if (owners.size === 1) {
        if (this.era !== 'modern') {
          await this.sendRequest<{ uri: string }>('resources/unsubscribe', {
            uri,
          });
        }
        this.resourceSubscriptionOwners.delete(uri);
        if (this.era === 'modern') await this.restartModernListener();
        return;
      }
      owners.delete(owner);
      if (this.era === 'modern') await this.restartModernListener();
    });
  }

  getResourceSubscriptions(): readonly string[] {
    return [...this.resourceSubscriptionOwners.keys()].sort();
  }

  private async restoreResourceSubscriptions(): Promise<void> {
    if (this.era === 'modern') return;
    await this.withResourceSubscriptionTransition(async () => {
      for (const uri of this.getResourceSubscriptions()) {
        await this.sendRequest<{ uri: string }>('resources/subscribe', { uri });
      }
    });
  }

  private async handleTransportLifecycle(state: 'reconnected'): Promise<void> {
    if (state === 'reconnected' && this.era === 'legacy') {
      await this.restoreResourceSubscriptions();
    }
    await this.emitEvent({ type: 'lifecycle', state });
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
    this.logLevel = level;
    if (this.era === 'modern') return;
    await this.sendRequest<{ level: AxMCPLoggingLevel }>('logging/setLevel', {
      level,
    });
  }

  cancelRequest(id: string): void {
    if (this.activeRequests.has(id)) {
      const entry = this.activeRequests.get(id);
      if (entry) {
        entry.controller.abort(`Request ${id} cancelled`);
        if (this.era !== 'modern') {
          void this.sendNotification('notifications/cancelled', {
            requestId: id,
            reason: 'Client cancelled request',
          });
        }
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
    const normalized = this.stripSubscriptionId(notification);
    if (
      this.era === 'modern' &&
      normalized.subscriptionId !== undefined &&
      normalized.subscriptionId !== this.activeSubscriptionId
    ) {
      return;
    }
    const current = normalized.notification;
    await this.options.onNotification?.(current);
    switch (current.method) {
      case 'notifications/subscriptions/acknowledged': {
        const params = current.params as
          | AxMCPSubscriptionsAcknowledgedParams
          | undefined;
        if (
          normalized.subscriptionId === this.activeSubscriptionId &&
          params?.notifications
        ) {
          this.modernListenReadyResolve?.();
        }
        break;
      }
      case 'notifications/tools/list_changed':
        await this.refresh();
        await this.options.onToolsChanged?.();
        await this.emitEvent({
          type: 'catalog_changed',
          catalog: 'tools',
          revision: this.catalogRevision,
        });
        break;
      case 'notifications/prompts/list_changed':
        await this.refresh();
        await this.options.onPromptsChanged?.();
        await this.emitEvent({
          type: 'catalog_changed',
          catalog: 'prompts',
          revision: this.catalogRevision,
        });
        break;
      case 'notifications/resources/list_changed':
        await this.refresh();
        await this.options.onResourcesChanged?.();
        await this.emitEvent({
          type: 'catalog_changed',
          catalog: 'resources',
          revision: this.catalogRevision,
        });
        break;
      case 'notifications/resources/updated': {
        const uri =
          current.params &&
          typeof current.params === 'object' &&
          'uri' in current.params
            ? String((current.params as { uri: unknown }).uri)
            : undefined;
        if (uri) {
          this.resourceReadCache.delete(uri);
          await this.options.onResourceUpdated?.(uri);
          await this.emitEvent({ type: 'resource_updated', uri });
        }
        break;
      }
      case 'notifications/message':
        await this.options.onLoggingMessage?.(current.params ?? {});
        await this.emitEvent({
          type: 'logging',
          params: current.params ?? {},
        });
        break;
      case 'notifications/progress':
        await this.options.onProgress?.(
          current.params as unknown as AxMCPProgressNotificationParams
        );
        await this.emitEvent({
          type: 'progress',
          params: current.params as unknown as AxMCPProgressNotificationParams,
        });
        break;
      case 'notifications/tasks/status': {
        const params = current.params as
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
      default:
        await this.emitEvent({ type: 'notification', notification: current });
    }
  }

  private stripSubscriptionId(
    notification: Readonly<AxMCPJSONRPCNotification>
  ): {
    notification: AxMCPJSONRPCNotification;
    subscriptionId?: string;
  } {
    const params =
      notification.params && typeof notification.params === 'object'
        ? (notification.params as Record<string, unknown>)
        : undefined;
    const meta =
      params?._meta &&
      typeof params._meta === 'object' &&
      !Array.isArray(params._meta)
        ? (params._meta as Record<string, unknown>)
        : undefined;
    const rawSubscriptionId = meta?.[AX_MCP_META_KEYS.SUBSCRIPTION_ID];
    const subscriptionId =
      typeof rawSubscriptionId === 'string' ||
      typeof rawSubscriptionId === 'number'
        ? String(rawSubscriptionId)
        : undefined;
    if (!meta || !Object.hasOwn(meta, AX_MCP_META_KEYS.SUBSCRIPTION_ID)) {
      return { notification: { ...notification }, subscriptionId };
    }
    const nextMeta = { ...meta };
    delete nextMeta[AX_MCP_META_KEYS.SUBSCRIPTION_ID];
    const nextParams = { ...params };
    if (Object.keys(nextMeta).length > 0) nextParams._meta = nextMeta;
    else delete nextParams._meta;
    return {
      notification: { ...notification, params: nextParams },
      subscriptionId,
    };
  }

  private async recordTask(task: Readonly<AxMCPTask>): Promise<void> {
    const snapshot = structuredClone(task);
    this.tasks.set(snapshot.taskId, snapshot);
    await this.options.onTaskStatus?.(snapshot);
    await Promise.all(
      [...this.taskStatusListeners].map((listener) => listener(snapshot))
    );
    await this.emitEvent({ type: 'task_status', task: snapshot });
  }

  private async emitEvent(event: Readonly<AxMCPClientEvent>): Promise<void> {
    await Promise.all(
      [...this.eventListeners].map((listener) => listener(event))
    );
  }

  private listeningDelay(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
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

  private async requestWithInputRounds<
    P extends object,
    R extends { resultType?: string },
  >(
    method: 'tools/call' | 'prompts/get' | 'resources/read',
    baseParams: Readonly<P>,
    options?: Readonly<AxMCPRequestOptions>
  ): Promise<R> {
    const maxInputRounds = this.options.maxInputRounds ?? 5;
    let params: P & AxMCPInputResponseRequestParams = { ...baseParams };

    for (let round = 0; ; round++) {
      const { result } = await this.sendRequest<
        P & AxMCPInputResponseRequestParams,
        R | AxMCPInputRequiredResult
      >(method, params, options);
      if (result.resultType !== 'input_required') {
        return result as R;
      }
      const inputRequired = result as AxMCPInputRequiredResult;
      if (this.era !== 'modern') {
        throw new Error(
          `MCP protocol violation: legacy server returned input_required for ${method}`
        );
      }
      if (round >= maxInputRounds) {
        throw new Error(
          `MCP ${method} exceeded ${maxInputRounds} input rounds`
        );
      }

      const hasInputRequests = Object.hasOwn(inputRequired, 'inputRequests');
      const hasRequestState = Object.hasOwn(inputRequired, 'requestState');
      if (!hasInputRequests && !hasRequestState) {
        throw new Error(
          `MCP protocol violation: input_required result for ${method} omitted both inputRequests and requestState`
        );
      }
      if (hasRequestState && typeof inputRequired.requestState !== 'string') {
        throw new Error(
          `MCP protocol violation: input_required requestState for ${method} must be a string`
        );
      }

      const inputResponses = inputRequired.inputRequests
        ? await axMCPFulfillInputRequests(inputRequired.inputRequests, {
            roots: this.options.roots,
            sampling: this.options.sampling
              ? (samplingParams) =>
                  this.options.sampling!(samplingParams, {
                    client: this,
                    namespace: this.getNamespace(),
                  })
              : undefined,
            elicitation: this.options.elicitation
              ? (elicitationParams) =>
                  this.options.elicitation!(elicitationParams, {
                    client: this,
                    namespace: this.getNamespace(),
                  })
              : undefined,
          })
        : undefined;

      params = {
        ...baseParams,
        ...(inputResponses ? { inputResponses } : {}),
        ...(hasRequestState
          ? { requestState: inputRequired.requestState }
          : {}),
      } as P & AxMCPInputResponseRequestParams;
    }
  }

  private async sendRequest<T = unknown, R = unknown>(
    method: string,
    params?: T,
    options?: Readonly<AxMCPRequestOptions>,
    allowVersionRetry = true
  ): Promise<{ id: string; result: R }> {
    const requestId = randomUUID();
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
    const traceHeaders: Record<string, string> = {};
    if (this.options.tracer) {
      propagation.inject(context.active(), traceHeaders);
    }
    const requestParams =
      this.era === 'modern'
        ? this.buildModernRequestParams(params, options, traceHeaders)
        : params;
    const request: AxMCPJSONRPCRequest<unknown> = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      ...(requestParams === undefined ? {} : { params: requestParams }),
    };
    const controller = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const requestOptions: AxMCPRequestOptions = { ...options, signal };

    const responsePromise = new Promise<{ result: R }>((resolve, reject) => {
      this.activeRequests.set(requestId, { reject, controller });
      const sendPromise = this.transport.send(request, requestOptions);
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
              error: { code: number; message: string; data?: unknown };
            };
            protocolSpan?.setAttribute(
              'rpc.jsonrpc.error_code',
              errorObj.error.code
            );
            reject(
              new AxMCPProtocolError(
                errorObj.error.code,
                errorObj.error.message,
                errorObj.error.data
              )
            );
          } else if (
            res !== null &&
            typeof res === 'object' &&
            'result' in res
          ) {
            const result = (res as { result: R }).result;
            if (
              this.era === 'modern' &&
              result &&
              typeof result === 'object' &&
              '_meta' in result
            ) {
              this.serverInfo =
                axMCPServerInfoFromMeta(
                  (result as { _meta?: AxMCPMeta })._meta
                ) ?? this.serverInfo;
            }
            resolve({ result });
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
        this.era === 'modern' &&
        allowVersionRetry &&
        error instanceof AxMCPProtocolError &&
        error.code === AX_MCP_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION
      ) {
        const version = this.mutualVersion(error.data);
        if (version) {
          this.negotiatedProtocolVersion = version;
          this.transport.setProtocolVersion?.(version);
          return this.sendRequest<T, R>(method, params, options, false);
        }
      }
      if (
        this.era === 'legacy' &&
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

  private buildModernRequestParams<T>(
    params: T | undefined,
    options: Readonly<AxMCPRequestOptions> | undefined,
    traceHeaders: Readonly<Record<string, string>>
  ): Record<string, unknown> {
    const base =
      params && typeof params === 'object' && !Array.isArray(params)
        ? { ...(params as Record<string, unknown>) }
        : {};
    const existingMeta =
      base._meta && typeof base._meta === 'object' && !Array.isArray(base._meta)
        ? (base._meta as AxMCPMeta)
        : undefined;
    return {
      ...base,
      _meta: axMCPBuildRequestMeta({
        protocolVersion:
          this.negotiatedProtocolVersion ?? AX_MCP_MODERN_PROTOCOL_VERSION,
        clientCapabilities: this.buildClientCapabilities(),
        clientInfo: this.clientInfo(),
        logLevel: options?.logLevel ?? this.logLevel,
        traceparent: traceHeaders.traceparent,
        tracestate: traceHeaders.tracestate,
        existing: existingMeta,
      }),
    };
  }

  private mutualVersion(data: unknown): string | undefined {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const supported = (data as { supported?: unknown }).supported;
    if (!Array.isArray(supported)) return;
    const clientVersions =
      this.options.supportedProtocolVersions ??
      AX_MCP_SUPPORTED_PROTOCOL_VERSIONS;
    return clientVersions.find((version) => supported.includes(version));
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
      const subscriptions = this.getResourceSubscriptions();
      this.initialized = false;
      await this.initialize();
      this.initialized = true;
      for (const uri of subscriptions) {
        await this.sendRequest<{ uri: string }>('resources/subscribe', { uri });
      }
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
    if (
      this.era === 'modern' &&
      (method === 'notifications/initialized' ||
        method === 'notifications/roots/list_changed' ||
        method === 'notifications/cancelled')
    ) {
      return;
    }
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

  private assertResourceSubscriptionCapability(): void {
    if (
      !this.hasResourcesCapability() ||
      (this.era !== 'modern' &&
        !this.hasSubCapability(this.serverCapabilities.resources, 'subscribe'))
    ) {
      throw new Error('Resource subscriptions are not supported');
    }
  }

  private async restartModernListener(): Promise<void> {
    if (this.era !== 'modern' || !this.activeModernListening) return;
    this.modernListenRestartRequested = true;
    await this.activeModernListening.close();
  }

  private async withResourceSubscriptionTransition<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.resourceSubscriptionTransition;
    let release!: () => void;
    this.resourceSubscriptionTransition = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
