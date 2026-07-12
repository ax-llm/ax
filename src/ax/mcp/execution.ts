import type { AxChatRequest, AxFunction } from '../ai/types.js';
import type { AxUCPClient } from '../ucp/client.js';
import { axMCPToolVisibleTo } from './apps.js';
import type { AxMCPClient } from './client.js';
import type {
  AxMCPPromptGetResult,
  AxMCPResourceReadResult,
  AxMCPTool,
} from './types.js';

export type AxMCPInheritance = 'all' | 'none' | readonly string[];

export interface AxMCPContinuationState {
  clients: readonly {
    namespace: string;
    tasks: readonly {
      taskId: string;
      status: import('./types.js').AxMCPTask['status'];
    }[];
    subscriptions: readonly string[];
  }[];
}

export type AxMCPTaskSnapshot = Readonly<Record<string, readonly string[]>>;

export type AxMCPContextRequest =
  | {
      client: AxMCPClient | string;
      prompt: { name: string; arguments?: Record<string, string> };
    }
  | {
      client: AxMCPClient | string;
      resource: { uri: string };
    };

export type AxMCPResolvedContext =
  | {
      type: 'prompt';
      namespace: string;
      name: string;
      result: AxMCPPromptGetResult;
    }
  | {
      type: 'resource';
      namespace: string;
      uri: string;
      result: AxMCPResourceReadResult;
    };

export async function axResolveMCPExecutionContext(
  options: Readonly<{
    mcp?: AxMCPClient | readonly AxMCPClient[];
    ucp?: AxUCPClient | readonly AxUCPClient[];
    mcpInheritance?: AxMCPInheritance;
    _mcpExecutionContext?: AxMCPExecutionContext;
  }>,
  defaults: Readonly<{
    mcp?: AxMCPClient | readonly AxMCPClient[];
    ucp?: AxUCPClient | readonly AxUCPClient[];
    mcpInheritance?: AxMCPInheritance;
  }> = {}
): Promise<AxMCPExecutionContext | undefined> {
  const hasExplicitClients =
    options.mcp !== undefined || options.ucp !== undefined;
  if (options._mcpExecutionContext && !hasExplicitClients) {
    return options._mcpExecutionContext;
  }
  const configuredUCP = options.ucp ?? defaults.ucp;
  const ucpClients = configuredUCP
    ? Array.isArray(configuredUCP)
      ? configuredUCP
      : [configuredUCP]
    : [];
  await Promise.all(ucpClients.map((client) => client.init()));
  const configuredMCP = options.mcp ?? defaults.mcp;
  const mcpClients = configuredMCP
    ? Array.isArray(configuredMCP)
      ? configuredMCP
      : [configuredMCP]
    : [];
  const clients = [...mcpClients];
  if (clients.length === 0 && ucpClients.length === 0) return;
  const context = new AxMCPExecutionContext(
    clients,
    options.mcpInheritance ?? defaults.mcpInheritance,
    ucpClients
  );
  await context.initialize();
  return context;
}

/** Run-scoped MCP state shared by Ax programs. */
export class AxMCPExecutionContext {
  private readonly clientsByNamespace = new Map<string, AxMCPClient>();
  private readonly ucpClientsByNamespace = new Map<string, AxUCPClient>();

  constructor(
    clients: AxMCPClient | readonly AxMCPClient[],
    readonly inheritance: AxMCPInheritance = 'all',
    ucpClients: AxUCPClient | readonly AxUCPClient[] = []
  ) {
    const values = Array.isArray(clients) ? clients : [clients];
    for (const client of values) {
      const namespace = client.getNamespace();
      if (this.clientsByNamespace.has(namespace)) {
        throw new Error(`Duplicate MCP client namespace: ${namespace}`);
      }
      this.clientsByNamespace.set(namespace, client);
    }
    const ucpValues = Array.isArray(ucpClients) ? ucpClients : [ucpClients];
    for (const client of ucpValues) {
      const namespace = client.getNamespace();
      if (
        this.clientsByNamespace.has(namespace) ||
        this.ucpClientsByNamespace.has(namespace)
      ) {
        throw new Error(`Duplicate MCP/UCP client namespace: ${namespace}`);
      }
      this.ucpClientsByNamespace.set(namespace, client);
    }
  }

  get clients(): readonly AxMCPClient[] {
    return [...this.clientsByNamespace.values()];
  }

  get ucpClients(): readonly AxUCPClient[] {
    return [...this.ucpClientsByNamespace.values()];
  }

  /** Derive the client view that a nested user program is allowed to receive. */
  forChild(
    inheritance: AxMCPInheritance = this.inheritance
  ): AxMCPExecutionContext | undefined {
    if (inheritance === 'none') return;
    if (inheritance === 'all') return this;
    const mcpClients: AxMCPClient[] = [];
    const ucpClients: AxUCPClient[] = [];
    for (const namespace of inheritance) {
      const mcp = this.clientsByNamespace.get(namespace);
      const ucp = this.ucpClientsByNamespace.get(namespace);
      if (!mcp && !ucp) {
        throw new Error(`Unknown inherited MCP client namespace: ${namespace}`);
      }
      if (mcp) mcpClients.push(mcp);
      if (ucp) ucpClients.push(ucp);
    }
    return new AxMCPExecutionContext(mcpClients, inheritance, ucpClients);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ...this.clients.map((client) => client.init()),
      ...this.ucpClients.map((client) => client.init()),
    ]);
    this.assertUniqueToolNames();
  }

  getClient(client: AxMCPClient | string): AxMCPClient {
    if (typeof client !== 'string') return client;
    const resolved = this.clientsByNamespace.get(client);
    if (!resolved) throw new Error(`Unknown MCP client namespace: ${client}`);
    return resolved;
  }

  getUCPClient(client: AxUCPClient | string): AxUCPClient {
    if (typeof client !== 'string') return client;
    const resolved = this.ucpClientsByNamespace.get(client);
    if (!resolved) throw new Error(`Unknown UCP client namespace: ${client}`);
    return resolved;
  }

  /** Bind raw MCP tools without using the lossy client.toFunction() adapter. */
  getToolBindings(): AxFunction[] {
    return [
      ...this.clients.flatMap((client) =>
        client
          .getTools()
          .filter((tool) => axMCPToolVisibleTo(tool, 'model'))
          .map((tool) => this.bindTool(client, tool))
      ),
      ...this.ucpClients.flatMap((client) => client.getOperationBindings()),
    ];
  }

  getCatalogRevision(): string {
    return [
      ...this.clients.map(
        (client) => `${client.getNamespace()}:${client.getCatalogRevision()}`
      ),
      ...this.ucpClients.map(
        (client) =>
          `${client.getNamespace()}:${client.getProfile().version}:${client.getOperationNames().join(',')}`
      ),
    ]
      .sort()
      .join('|');
  }

  getContinuationState(): AxMCPContinuationState {
    return {
      clients: this.clients.map((client) => ({
        namespace: client.getNamespace(),
        tasks: client.getKnownTasks().map((task) => ({
          taskId: task.taskId,
          status: task.status,
        })),
        subscriptions: client.getResourceSubscriptions(),
      })),
    };
  }

  getTaskSnapshot(): AxMCPTaskSnapshot {
    return Object.fromEntries(
      this.clients.map((client) => [
        client.getNamespace(),
        client.getKnownTasks().map((task) => task.taskId),
      ])
    );
  }

  async cancelTasksCreatedSince(snapshot: AxMCPTaskSnapshot): Promise<void> {
    await Promise.all(
      this.clients.flatMap((client) => {
        const previous = new Set(snapshot[client.getNamespace()] ?? []);
        return client
          .getKnownTasks()
          .filter(
            (task) =>
              !previous.has(task.taskId) &&
              (task.status === 'working' || task.status === 'input_required')
          )
          .map(async (task) => {
            try {
              await client.cancelTask(task.taskId);
            } catch {
              // Preserve the original branch/flow failure.
            }
          });
      })
    );
  }

  async restoreContinuationState(
    state: Readonly<AxMCPContinuationState> | undefined
  ): Promise<void> {
    if (!state) return;
    await this.initialize();
    for (const saved of state.clients) {
      const client = this.clientsByNamespace.get(saved.namespace);
      if (!client) {
        throw new Error(
          `Restored MCP state requires unbound namespace ${saved.namespace}`
        );
      }
      for (const task of saved.tasks) {
        try {
          await client.getTask(task.taskId);
        } catch (error) {
          throw new Error(
            `Failed to revalidate restored MCP task ${saved.namespace}:${task.taskId}`,
            { cause: error }
          );
        }
      }
      for (const uri of saved.subscriptions) {
        try {
          await client.subscribeResource(uri);
        } catch (error) {
          throw new Error(
            `Failed to restore MCP subscription ${saved.namespace}:${uri}`,
            { cause: error }
          );
        }
      }
    }
  }

  async resolveContext(
    requests: readonly AxMCPContextRequest[] = []
  ): Promise<AxMCPResolvedContext[]> {
    return Promise.all(
      requests.map(async (request): Promise<AxMCPResolvedContext> => {
        const client = this.getClient(request.client);
        const namespace = client.getNamespace();
        if ('prompt' in request) {
          return {
            type: 'prompt',
            namespace,
            name: request.prompt.name,
            result: await client.getPrompt(
              request.prompt.name,
              request.prompt.arguments
            ),
          };
        }
        return {
          type: 'resource',
          namespace,
          uri: request.resource.uri,
          result: await client.readResource(request.resource.uri),
        };
      })
    );
  }

  async resolveContextPrompt(
    requests: readonly AxMCPContextRequest[] = []
  ): Promise<AxChatRequest['chatPrompt']> {
    const resolved = await this.resolveContext(requests);
    const prompt: AxChatRequest['chatPrompt'] = [];
    for (const item of resolved) {
      const header =
        item.type === 'prompt'
          ? `<mcp_context source="${item.namespace}" kind="prompt" name="${item.name}" trust="untrusted">`
          : `<mcp_context source="${item.namespace}" kind="resource" uri="${item.uri}" trust="untrusted">`;
      if (item.type === 'prompt') {
        for (const message of item.result.messages) {
          if (message.role === 'assistant') {
            prompt.push({
              role: 'assistant',
              content: `${header}\n${this.contentToText(message.content)}\n</mcp_context>`,
            });
          } else {
            prompt.push({
              role: 'user',
              content: [
                { type: 'text', text: header },
                ...this.contentToUserParts(message.content),
                { type: 'text', text: '</mcp_context>' },
              ],
            });
          }
        }
        continue;
      }
      const parts: Exclude<
        Extract<
          AxChatRequest['chatPrompt'][number],
          { role: 'user' }
        >['content'],
        string
      > = [{ type: 'text', text: header }];
      for (const content of item.result.contents) {
        if ('text' in content) {
          parts.push({ type: 'text', text: content.text });
        } else {
          parts.push({
            type: 'file',
            data: content.blob,
            filename: content.uri,
            mimeType: content.mimeType ?? 'application/octet-stream',
          });
        }
      }
      parts.push({ type: 'text', text: '</mcp_context>' });
      prompt.push({ role: 'user', content: parts });
    }
    return prompt;
  }

  private bindTool(client: AxMCPClient, tool: AxMCPTool): AxFunction {
    return {
      name: tool.name,
      namespace: client.getNamespace(),
      componentId: `mcp:${client.getNamespace()}:${tool.name}`,
      description: tool.description ?? tool.title ?? tool.name,
      parameters: tool.inputSchema as AxFunction['parameters'],
      returns: tool.outputSchema as AxFunction['returns'],
      protocol: {
        kind: 'mcp',
        namespace: client.getNamespace(),
        name: tool.name,
        annotations: tool.annotations as Record<string, unknown> | undefined,
        meta: tool._meta,
      },
      func: async (args, extra): Promise<unknown> => {
        if (tool.execution?.taskSupport === 'required') {
          const result = await client.callToolTask(
            tool.name,
            args ?? {},
            {},
            {
              signal: extra?.abortSignal,
            }
          );
          extra?.eventContext?.registerContinuation({
            correlation: [
              {
                kind: 'mcp.task',
                value: `${client.getNamespace()}:${result.task.taskId}`,
              },
            ],
            metadata: {
              namespace: client.getNamespace(),
              taskId: result.task.taskId,
              tool: tool.name,
            },
          });
          return result;
        }
        return client.callTool(tool.name, args ?? {}, {
          signal: extra?.abortSignal,
        });
      },
    };
  }

  private contentToText(content: import('./types.js').AxMCPContent): string {
    if (content.type === 'text') return content.text;
    if (content.type === 'image') return `[Image: ${content.mimeType}]`;
    if (content.type === 'audio') return `[Audio: ${content.mimeType}]`;
    if (content.type === 'resource_link') return `[Resource: ${content.uri}]`;
    return 'text' in content.resource
      ? content.resource.text
      : `[Binary resource: ${content.resource.uri}]`;
  }

  private contentToUserParts(
    content: import('./types.js').AxMCPContent
  ): Exclude<
    Extract<AxChatRequest['chatPrompt'][number], { role: 'user' }>['content'],
    string
  > {
    if (content.type === 'text') return [{ type: 'text', text: content.text }];
    if (content.type === 'image') {
      return [
        {
          type: 'image',
          image: content.data,
          mimeType: content.mimeType,
          altText: `[MCP image from remote server: ${content.mimeType}]`,
        },
      ];
    }
    if (content.type === 'audio') {
      return [
        {
          type: 'audio',
          data: content.data,
          mimeType: content.mimeType,
          transcription: `[MCP audio from remote server: ${content.mimeType}]`,
        },
      ];
    }
    if (content.type === 'resource_link') {
      return [
        {
          type: 'url',
          url: content.uri,
          title: content.name ?? content.title,
          description: content.description,
        },
      ];
    }
    const resource = content.resource;
    if ('text' in resource) return [{ type: 'text', text: resource.text }];
    return [
      {
        type: 'file',
        data: resource.blob,
        filename: resource.uri,
        mimeType: resource.mimeType ?? 'application/octet-stream',
      },
    ];
  }

  private assertUniqueToolNames(): void {
    const names = new Map<string, string>();
    for (const client of this.clients) {
      for (const tool of client.getTools()) {
        const previous = names.get(tool.name);
        if (previous) {
          throw new Error(
            `Duplicate MCP tool name ${tool.name} from ${previous} and ${client.getNamespace()}`
          );
        }
        names.set(tool.name, client.getNamespace());
      }
    }
  }
}

/** Remove parent attachment options and pass only the permitted live context. */
export function axMCPChildExecutionOptions<
  T extends Readonly<{
    mcp?: unknown;
    ucp?: unknown;
    mcpContext?: unknown;
    _mcpExecutionContext?: AxMCPExecutionContext;
    eventContext?: unknown;
    eventInheritance?: 'all' | 'none';
  }>,
>(options: T): T {
  const {
    mcp: _mcp,
    ucp: _ucp,
    mcpContext: _context,
    eventContext: _eventContext,
    ...rest
  } = options;
  const child = options._mcpExecutionContext?.forChild();
  return {
    ...rest,
    ...(child ? { _mcpExecutionContext: child } : {}),
    ...(options.eventInheritance !== 'none' && options.eventContext
      ? { eventContext: options.eventContext }
      : {}),
  } as unknown as T;
}
