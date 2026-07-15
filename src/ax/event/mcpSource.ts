import type {
  AxMCPCatalogSnapshot,
  AxMCPClient,
  AxMCPClientEvent,
} from '../mcp/client.js';
import type { AxMCPResource } from '../mcp/types.js';
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

export type AxMCPResourceSubscriptionPolicy =
  | 'none'
  | 'all'
  | readonly string[]
  | {
      select: (
        resource: Readonly<AxMCPResource>,
        catalog: Readonly<AxMCPCatalogSnapshot>
      ) => boolean;
    };

export interface AxMCPEventSourceOptions {
  id?: string;
  client: AxMCPClient;
  resourceSubscriptions?: AxMCPResourceSubscriptionPolicy;
  /** @deprecated Use resourceSubscriptions with an explicit URI array. */
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
  private readonly subscriptionOwner: string;
  private readonly selectedSubscriptions = new Set<string>();

  constructor(private readonly options: Readonly<AxMCPEventSourceOptions>) {
    if (
      options.resourceSubscriptions !== undefined &&
      options.resources !== undefined
    ) {
      throw new Error(
        'Specify either resourceSubscriptions or the deprecated resources alias, not both'
      );
    }
    this.id = options.id ?? `mcp:${options.client.getNamespace()}`;
    this.requiresDurable = options.requiresDurable ?? true;
    this.subscriptionOwner = axEventId(`mcp-source-${this.id}`);
  }

  async start(
    context: Readonly<AxEventSourceContext>
  ): Promise<AxEventSourceHandle> {
    let pending = Promise.resolve();
    const unsubscribeEvents = this.options.client.subscribeEvents((event) => {
      pending = pending
        .then(async () => {
          if (
            (event.type === 'catalog_changed' &&
              event.catalog === 'resources') ||
            (event.type === 'lifecycle' && event.state === 'reconnected')
          ) {
            try {
              await this.reconcileSubscriptions(context);
            } catch (error) {
              context.reportError(error);
            }
          }
          const ingress = await this.toIngress(event);
          await context.publish(ingress, context.signal);
        })
        .catch((error) => context.reportError(error));
      return pending;
    });
    try {
      await this.options.client.init();
      await this.reconcileSubscriptions(context);
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
            await this.releaseSubscriptions(context);
          }
        },
      };
    } catch (error) {
      unsubscribeEvents();
      await this.releaseSubscriptions(context);
      throw error;
    }
  }

  private getSubscriptionPolicy(): AxMCPResourceSubscriptionPolicy {
    return (
      this.options.resourceSubscriptions ?? this.options.resources ?? 'none'
    );
  }

  private async reconcileSubscriptions(
    context: Readonly<AxEventSourceContext>
  ): Promise<void> {
    const policy = this.getSubscriptionPolicy();
    const catalog = await this.options.client.inspectCatalog();
    if (policy !== 'none' && !supportsResourceSubscriptions(catalog)) {
      throw new Error(
        `MCP server ${catalog.namespace} does not advertise resource subscriptions`
      );
    }

    let desired: readonly string[];
    try {
      desired = selectResourceSubscriptions(policy, catalog);
    } catch (error) {
      context.reportError(error);
      return;
    }

    const desiredSet = new Set(desired);
    const errors: unknown[] = [];
    for (const uri of [...this.selectedSubscriptions]
      .filter((uri) => !desiredSet.has(uri))
      .sort()) {
      try {
        await this.options.client.releaseResourceSubscription(
          uri,
          this.subscriptionOwner
        );
        this.selectedSubscriptions.delete(uri);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const uri of [...desiredSet]
      .filter((uri) => !this.selectedSubscriptions.has(uri))
      .sort()) {
      try {
        await this.options.client.acquireResourceSubscription(
          uri,
          this.subscriptionOwner
        );
        this.selectedSubscriptions.add(uri);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      context.reportError(
        new AggregateError(
          errors,
          `Failed to reconcile ${errors.length} MCP resource subscription transition(s)`
        )
      );
    }
  }

  private async releaseSubscriptions(
    context: Readonly<AxEventSourceContext>
  ): Promise<void> {
    const errors: unknown[] = [];
    for (const uri of [...this.selectedSubscriptions].sort()) {
      try {
        await this.options.client.releaseResourceSubscription(
          uri,
          this.subscriptionOwner
        );
        this.selectedSubscriptions.delete(uri);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const error of errors) context.reportError(error);
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
    case 'lifecycle':
      return {
        type: 'mcp.lifecycle',
        subject: event.state,
        partitionKey: `${namespace}:lifecycle`,
        data: toEventValue({ namespace, state: event.state }),
      };
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

export function selectResourceSubscriptions(
  policy: AxMCPResourceSubscriptionPolicy,
  catalog: Readonly<AxMCPCatalogSnapshot>
): readonly string[] {
  const selected =
    policy === 'none'
      ? []
      : policy === 'all'
        ? catalog.resources.map((resource) => resource.uri)
        : isExplicitResourceList(policy)
          ? policy
          : catalog.resources
              .filter((resource) => policy.select(resource, catalog))
              .map((resource) => resource.uri);
  return [...new Set(selected)].sort();
}

function supportsResourceSubscriptions(
  catalog: Readonly<AxMCPCatalogSnapshot>
): boolean {
  const capability = catalog.serverCapabilities.resources;
  return Boolean(capability?.subscribe);
}

function isExplicitResourceList(
  policy: AxMCPResourceSubscriptionPolicy
): policy is readonly string[] {
  return Array.isArray(policy);
}

function toEventValue(value: unknown): AxEventValue {
  return JSON.parse(JSON.stringify(value ?? null)) as AxEventValue;
}
