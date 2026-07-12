import type { AxMCPClient } from './client.js';
import type {
  AxMCPContent,
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
  AxMCPMeta,
  AxMCPTool,
  AxMCPToolCallResult,
} from './types.js';

export const AX_MCP_APPS_PROTOCOL_VERSION = '2026-01-26';
export const AX_MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

export type AxMCPAppVisibility = 'model' | 'app';
export type AxMCPAppDisplayMode = 'inline' | 'fullscreen' | 'pip';

export interface AxMCPAppToolMeta {
  resourceUri?: string;
  visibility?: readonly AxMCPAppVisibility[];
}

export interface AxMCPAppResourceCSP {
  connectDomains?: readonly string[];
  resourceDomains?: readonly string[];
  frameDomains?: readonly string[];
  baseUriDomains?: readonly string[];
}

export interface AxMCPAppPermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface AxMCPAppResourceMeta {
  csp?: AxMCPAppResourceCSP;
  permissions?: AxMCPAppPermissions;
  domain?: string;
  prefersBorder?: boolean;
}

export interface AxMCPAppResource {
  uri: string;
  mimeType: typeof AX_MCP_APP_RESOURCE_MIME_TYPE;
  html: string;
  meta: AxMCPAppResourceMeta;
  sandbox: 'allow-scripts allow-same-origin';
  contentSecurityPolicy: string;
  permissionPolicy: string;
}

export interface AxMCPAppContextUpdate {
  content?: readonly AxMCPContent[];
  structuredContent?: Readonly<Record<string, unknown>>;
  /** Apps are remote, untrusted UI principals. */
  untrusted: true;
  source: Readonly<{ kind: 'mcp-app'; namespace: string; tool: string }>;
}

export interface AxMCPAppBridgeOptions {
  client: AxMCPClient;
  tool: string | AxMCPTool;
  sendToView?: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>;
  hostCapabilities?: Readonly<Record<string, unknown>>;
  hostContext?: Readonly<Record<string, unknown>>;
  authorize?: (
    action: Readonly<{
      method: string;
      params: unknown;
      namespace: string;
      tool: string;
    }>
  ) => boolean | Promise<boolean>;
  openLink?: (url: string) => void | Promise<void>;
  sendMessage?: (
    message: Readonly<Record<string, unknown>>
  ) => void | Promise<void>;
  updateModelContext?: (
    update: Readonly<AxMCPAppContextUpdate>
  ) => void | Promise<void>;
  requestDisplayMode?: (
    mode: AxMCPAppDisplayMode
  ) => AxMCPAppDisplayMode | Promise<AxMCPAppDisplayMode>;
  log?: (params: unknown) => void | Promise<void>;
  sizeChanged?: (size: Readonly<{ width: number; height: number }>) => void;
}

export function axMCPAppToolMeta(tool: Readonly<AxMCPTool>): AxMCPAppToolMeta {
  const nested = tool._meta?.ui;
  const meta =
    nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)
      : undefined;
  const visibility = Array.isArray(meta?.visibility)
    ? meta.visibility.filter(
        (value): value is AxMCPAppVisibility =>
          value === 'model' || value === 'app'
      )
    : undefined;
  const resourceUri =
    typeof meta?.resourceUri === 'string'
      ? meta.resourceUri
      : typeof tool._meta?.['ui/resourceUri'] === 'string'
        ? tool._meta['ui/resourceUri']
        : undefined;
  return { resourceUri, visibility };
}

export function axMCPToolVisibleTo(
  tool: Readonly<AxMCPTool>,
  principal: AxMCPAppVisibility
): boolean {
  return (axMCPAppToolMeta(tool).visibility ?? ['model', 'app']).includes(
    principal
  );
}

function sourceList(values: readonly string[] | undefined): string {
  if (!values?.length) return '';
  return values
    .map((value) => {
      if (
        /[\s;'"`]/.test(value) ||
        !/^(?:https|wss):\/\/(?:\*\.)?[a-z0-9.-]+(?::\d+)?$/i.test(value)
      ) {
        throw new Error(`Unsafe MCP App CSP source: ${value}`);
      }
      return value;
    })
    .join(' ');
}

function appResourceMeta(meta: AxMCPMeta | undefined): AxMCPAppResourceMeta {
  const ui = meta?.ui;
  return ui && typeof ui === 'object'
    ? (structuredClone(ui) as AxMCPAppResourceMeta)
    : {};
}

function csp(meta: Readonly<AxMCPAppResourceMeta>): string {
  const resources = sourceList(meta.csp?.resourceDomains);
  const connect = sourceList(meta.csp?.connectDomains);
  const frames = sourceList(meta.csp?.frameDomains);
  const bases = sourceList(meta.csp?.baseUriDomains);
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'${resources ? ` ${resources}` : ''}`,
    `style-src 'self' 'unsafe-inline'${resources ? ` ${resources}` : ''}`,
    `connect-src ${connect ? `'self' ${connect}` : "'none'"}`,
    `img-src 'self' data:${resources ? ` ${resources}` : ''}`,
    `font-src 'self'${resources ? ` ${resources}` : ''}`,
    `media-src 'self' data:${resources ? ` ${resources}` : ''}`,
    `frame-src ${frames || "'none'"}`,
    "object-src 'none'",
    `base-uri ${bases || "'self'"}`,
  ].join('; ');
}

function permissions(meta: Readonly<AxMCPAppResourceMeta>): string {
  return [
    meta.permissions?.camera ? 'camera' : undefined,
    meta.permissions?.microphone ? 'microphone' : undefined,
    meta.permissions?.geolocation ? 'geolocation' : undefined,
    meta.permissions?.clipboardWrite ? 'clipboard-write' : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join('; ');
}

function decodeBlob(value: string): string {
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
    );
  } catch {
    throw new Error('MCP App resource blob is not valid base64 HTML');
  }
}

/**
 * Protocol and policy core for an MCP Apps host. Rendering remains host-owned;
 * this bridge supplies the validated sandbox payload and JSON-RPC dispatch.
 */
export class AxMCPAppBridge {
  private readonly tool: AxMCPTool;
  private initialized = false;
  private nextRequestId = 1;

  constructor(private readonly options: Readonly<AxMCPAppBridgeOptions>) {
    const tool =
      typeof options.tool === 'string'
        ? options.client.getTools().find((item) => item.name === options.tool)
        : options.tool;
    if (!tool)
      throw new Error(`MCP App tool not found: ${String(options.tool)}`);
    this.tool = tool;
  }

  async loadResource(): Promise<AxMCPAppResource> {
    const uri = axMCPAppToolMeta(this.tool).resourceUri;
    if (!uri || !uri.startsWith('ui://')) {
      throw new Error(
        `MCP App tool ${this.tool.name} has no valid ui:// resource`
      );
    }
    const result = await this.options.client.readResource(uri);
    const content = result.contents.find((item) => item.uri === uri);
    if (!content) throw new Error(`MCP App resource ${uri} was not returned`);
    if (content.mimeType !== AX_MCP_APP_RESOURCE_MIME_TYPE) {
      throw new Error(
        `MCP App resource ${uri} has invalid MIME type ${content.mimeType ?? '<missing>'}`
      );
    }
    const html = 'text' in content ? content.text : decodeBlob(content.blob);
    if (!/<(?:!doctype\s+html|html)(?:\s|>)/i.test(html)) {
      throw new Error(`MCP App resource ${uri} is not an HTML document`);
    }
    const meta = appResourceMeta(content._meta);
    return {
      uri,
      mimeType: AX_MCP_APP_RESOURCE_MIME_TYPE,
      html,
      meta,
      sandbox: 'allow-scripts allow-same-origin',
      contentSecurityPolicy: csp(meta),
      permissionPolicy: permissions(meta),
    };
  }

  async handleViewMessage(
    message: Readonly<AxMCPJSONRPCMessage>
  ): Promise<AxMCPJSONRPCResponse | undefined> {
    if (!('method' in message)) return undefined;
    if ('id' in message)
      return this.handleRequest(message as AxMCPJSONRPCRequest);
    if (message.method === 'ui/notifications/initialized') {
      this.initialized = true;
      return undefined;
    }
    if (!this.initialized) {
      throw new Error('MCP App sent a notification before initialization');
    }
    if (message.method === 'notifications/message') {
      await this.options.log?.(message.params);
    } else if (message.method === 'ui/notifications/size-changed') {
      const size = message.params as { width?: unknown; height?: unknown };
      if (typeof size.width === 'number' && typeof size.height === 'number') {
        this.options.sizeChanged?.({ width: size.width, height: size.height });
      }
    } else if (message.method.startsWith('ui/notifications/sandbox-')) {
      throw new Error(`Reserved MCP App sandbox message: ${message.method}`);
    }
    return undefined;
  }

  async notifyToolInput(
    arguments_: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await this.sendNotification('ui/notifications/tool-input', {
      arguments: arguments_,
    });
  }

  async notifyToolInputPartial(
    arguments_: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await this.sendNotification('ui/notifications/tool-input-partial', {
      arguments: arguments_,
    });
  }

  async notifyToolResult(result: Readonly<AxMCPToolCallResult>): Promise<void> {
    await this.sendNotification('ui/notifications/tool-result', result);
  }

  async notifyToolCancelled(reason: string): Promise<void> {
    await this.sendNotification('ui/notifications/tool-cancelled', { reason });
  }

  async notifyHostContextChanged(
    context: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await this.sendNotification(
      'ui/notifications/host-context-changed',
      context
    );
  }

  async teardown(reason: string): Promise<void> {
    await this.options.sendToView?.({
      jsonrpc: '2.0',
      id: this.nextRequestId++,
      method: 'ui/resource-teardown',
      params: { reason },
    });
    this.initialized = false;
  }

  private async handleRequest(
    request: Readonly<AxMCPJSONRPCRequest>
  ): Promise<AxMCPJSONRPCResponse> {
    try {
      if (request.method === 'ui/initialize') {
        return this.success(request.id, {
          protocolVersion: AX_MCP_APPS_PROTOCOL_VERSION,
          hostCapabilities: this.options.hostCapabilities ?? {
            serverTools: { listChanged: true },
            serverResources: { listChanged: true },
            logging: {},
            sandbox: {},
          },
          hostContext: this.options.hostContext ?? {},
        });
      }
      if (!this.initialized) throw new Error('MCP App is not initialized');
      await this.authorize(request.method, request.params);
      if (request.method === 'ping') return this.success(request.id, {});
      if (request.method === 'tools/call') {
        const params = request.params as {
          name?: unknown;
          arguments?: unknown;
        };
        if (typeof params.name !== 'string')
          throw new Error('Missing tool name');
        const tool = this.options.client
          .getTools()
          .find((item) => item.name === params.name);
        if (!tool || !axMCPToolVisibleTo(tool, 'app')) {
          throw new Error(`MCP App cannot call tool ${params.name}`);
        }
        return this.success(
          request.id,
          await this.options.client.callTool(params.name, params.arguments)
        );
      }
      if (request.method === 'resources/read') {
        const uri = (request.params as { uri?: unknown }).uri;
        if (typeof uri !== 'string') throw new Error('Missing resource URI');
        return this.success(
          request.id,
          await this.options.client.readResource(uri)
        );
      }
      if (request.method === 'ui/open-link') {
        const url = (request.params as { url?: unknown }).url;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
          throw new Error('MCP App link must be HTTP(S)');
        }
        if (!this.options.openLink) throw new Error('Link opening is disabled');
        await this.options.openLink(url);
        return this.success(request.id, {});
      }
      if (request.method === 'ui/message') {
        if (!this.options.sendMessage)
          throw new Error('App messages are disabled');
        await this.options.sendMessage(
          request.params as Readonly<Record<string, unknown>>
        );
        return this.success(request.id, {});
      }
      if (request.method === 'ui/update-model-context') {
        if (!this.options.updateModelContext) {
          throw new Error('App model-context updates are disabled');
        }
        const params = request.params as {
          content?: readonly AxMCPContent[];
          structuredContent?: Readonly<Record<string, unknown>>;
        };
        await this.options.updateModelContext({
          ...params,
          untrusted: true,
          source: {
            kind: 'mcp-app',
            namespace: this.options.client.getNamespace(),
            tool: this.tool.name,
          },
        });
        return this.success(request.id, {});
      }
      if (request.method === 'ui/request-display-mode') {
        const mode = (request.params as { mode?: unknown }).mode;
        if (mode !== 'inline' && mode !== 'fullscreen' && mode !== 'pip') {
          throw new Error('Invalid MCP App display mode');
        }
        const actual = this.options.requestDisplayMode
          ? await this.options.requestDisplayMode(mode)
          : 'inline';
        return this.success(request.id, { mode: actual });
      }
      throw new Error(`Unsupported MCP App request: ${request.method}`);
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async authorize(method: string, params: unknown): Promise<void> {
    const allowed = await this.options.authorize?.({
      method,
      params,
      namespace: this.options.client.getNamespace(),
      tool: this.tool.name,
    });
    if (allowed === false) throw new Error(`MCP App request denied: ${method}`);
  }

  private success(id: string | number, result: unknown): AxMCPJSONRPCResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private async sendNotification(
    method: string,
    params: unknown
  ): Promise<void> {
    if (!this.initialized) throw new Error('MCP App is not initialized');
    await this.options.sendToView?.({
      jsonrpc: '2.0',
      method,
      params: params as Record<string, unknown>,
    });
  }
}
