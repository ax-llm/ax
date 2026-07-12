import type { AxMCPClient, AxMCPClientEvent } from '../mcp/client.js';
import { eventRoute } from './runtime.js';
import type {
  AxEventIdentity,
  AxEventIngress,
  AxEventRoute,
  AxEventSource,
  AxEventSourceContext,
  AxEventSourceHandle,
  AxEventTrust,
  AxEventValue,
} from './types.js';
import { axEventId } from './util.js';

export interface AxMCPEventSourceIdentity {
  identity?: Readonly<AxEventIdentity>;
  trust?: AxEventTrust;
}

export interface AxMCPEventSourceOptions {
  id?: string;
  client: AxMCPClient;
  resources?: readonly string[];
  identity?: Readonly<AxEventIdentity>;
  trust?: AxEventTrust;
  resolveIdentity?: (
    event: Readonly<AxMCPClientEvent>
  ) =>
    | Readonly<AxMCPEventSourceIdentity>
    | Promise<Readonly<AxMCPEventSourceIdentity>>;
  requiresDurable?: boolean;
  unsubscribeOnClose?: boolean;
  reconnectDelayMs?: number;
}

/** Adapts MCP notifications and task snapshots into the generic event inbox. */
export class AxMCPEventSource implements AxEventSource {
  readonly id: string;
  readonly requiresDurable: boolean;

  constructor(private readonly options: Readonly<AxMCPEventSourceOptions>) {
    this.id = options.id ?? `mcp:${options.client.getNamespace()}`;
    this.requiresDurable = options.requiresDurable ?? true;
  }

  async start(
    context: Readonly<AxEventSourceContext>
  ): Promise<AxEventSourceHandle> {
    let pending = Promise.resolve();
    const unsubscribeEvents = this.options.client.subscribeEvents((event) => {
      pending = pending
        .then(async () => {
          const ingress = await this.toIngress(event);
          await context.publish(ingress, context.signal);
        })
        .catch((error) => context.reportError(error));
      return pending;
    });
    const previouslySubscribed = new Set(
      this.options.client.getResourceSubscriptions()
    );
    try {
      await this.options.client.init();
      for (const uri of this.options.resources ?? []) {
        await this.options.client.subscribeResource(uri);
      }
      const listening = await this.options.client.startListening({
        signal: context.signal,
        retryDelayMs: this.options.reconnectDelayMs,
        onError: (error) => context.reportError(error),
      });
      return {
        close: async () => {
          unsubscribeEvents();
          await listening.close();
          await pending;
          if (this.options.unsubscribeOnClose !== false) {
            for (const uri of this.options.resources ?? []) {
              if (!previouslySubscribed.has(uri)) {
                await this.options.client.unsubscribeResource(uri);
              }
            }
          }
        },
      };
    } catch (error) {
      unsubscribeEvents();
      throw error;
    }
  }

  private async toIngress(
    clientEvent: Readonly<AxMCPClientEvent>
  ): Promise<AxEventIngress> {
    const namespace = this.options.client.getNamespace();
    const resolved = this.options.resolveIdentity
      ? await this.options.resolveIdentity(clientEvent)
      : { identity: this.options.identity, trust: this.options.trust };
    const normalized = normalizeMCPEvent(clientEvent, namespace);
    return {
      event: {
        specversion: '1.0',
        id: axEventId(`mcp-${namespace}`),
        source: `mcp://${namespace}`,
        type: normalized.type,
        ...(normalized.subject ? { subject: normalized.subject } : {}),
        time: new Date().toISOString(),
        data: normalized.data,
      },
      identity: resolved.identity ?? {},
      trust: resolved.trust ?? 'untrusted',
      correlation: normalized.correlation,
      partitionKey: normalized.partitionKey,
    };
  }
}

export interface AxMCPDefaultEventRoutesOptions {
  client: AxMCPClient;
  onCatalogInvalidated?: (
    catalog: 'tools' | 'prompts' | 'resources',
    revision: number
  ) => void | Promise<void>;
  onObserve?: (ingress: Readonly<AxEventIngress>) => void | Promise<void>;
}

/** Safe MCP defaults. Resource updates intentionally have no implicit wake route. */
export function axMCPEventRoutes(
  options: Readonly<AxMCPDefaultEventRoutesOptions>
): readonly AxEventRoute[] {
  const namespace = options.client.getNamespace();
  const source = `mcp://${namespace}`;
  return [
    eventRoute({
      id: `mcp-${namespace}-catalog`,
      match: { sources: [source], types: ['mcp.catalog.changed'] },
      action: 'invalidate',
      invalidator: {
        invalidate: async ({ event }) => {
          const data = event.data as {
            catalog: 'tools' | 'prompts' | 'resources';
            revision: number;
          };
          await options.onCatalogInvalidated?.(data.catalog, data.revision);
        },
      },
    }),
    eventRoute({
      id: `mcp-${namespace}-observe`,
      match: {
        sources: [source],
        types: ['mcp.progress', 'mcp.logging'],
      },
      action: 'observe',
      observe: options.onObserve,
    }),
    eventRoute({
      id: `mcp-${namespace}-task-resume`,
      match: (ingress) => {
        if (ingress.event.source !== source) return false;
        if (ingress.event.type !== 'mcp.task.status') return false;
        const status = (ingress.event.data as { status?: string })?.status;
        return (
          status === 'input_required' ||
          status === 'completed' ||
          status === 'failed' ||
          status === 'cancelled'
        );
      },
      action: 'resume',
      correlation: (ingress) => ingress.correlation?.[0],
    }),
  ];
}

function normalizeMCPEvent(
  event: Readonly<AxMCPClientEvent>,
  namespace: string
): {
  type: string;
  subject?: string;
  partitionKey: string;
  data: AxEventValue;
  correlation?: readonly { kind: string; value: string }[];
} {
  switch (event.type) {
    case 'catalog_changed':
      return {
        type: 'mcp.catalog.changed',
        subject: event.catalog,
        partitionKey: `${namespace}:catalog:${event.catalog}`,
        data: toEventValue({
          namespace,
          catalog: event.catalog,
          revision: event.revision,
        }),
      };
    case 'resource_updated':
      return {
        type: 'mcp.resource.updated',
        subject: event.uri,
        partitionKey: `${namespace}:resource:${event.uri}`,
        data: toEventValue({ namespace, uri: event.uri }),
      };
    case 'logging':
      return {
        type: 'mcp.logging',
        partitionKey: `${namespace}:logging`,
        data: toEventValue({ namespace, ...event.params }),
      };
    case 'progress':
      return {
        type: 'mcp.progress',
        partitionKey: `${namespace}:progress`,
        data: toEventValue({ namespace, ...event.params }),
      };
    case 'task_status': {
      const taskKey = `${namespace}:${event.task.taskId}`;
      return {
        type: 'mcp.task.status',
        subject: taskKey,
        partitionKey: `${namespace}:task:${event.task.taskId}`,
        data: toEventValue({ namespace, ...event.task }),
        correlation: [{ kind: 'mcp.task', value: taskKey }],
      };
    }
    case 'notification':
      return {
        type: 'mcp.notification',
        subject: event.notification.method,
        partitionKey: `${namespace}:notification:${event.notification.method}`,
        data: toEventValue({
          namespace,
          method: event.notification.method,
          params: event.notification.params ?? null,
        }),
      };
  }
}

function toEventValue(value: unknown): AxEventValue {
  return JSON.parse(JSON.stringify(value ?? null)) as AxEventValue;
}
