import type { AxUCPClient } from '../ucp/client.js';
import type { AxUCPOrderEvent } from '../ucp/types.js';
import type {
  AxEventIdentity,
  AxEventPublishReceipt,
  AxEventSource,
  AxEventSourceContext,
  AxEventSourceHandle,
  AxEventValue,
} from './types.js';

export interface AxUCPWebhookEventSourceOptions {
  id?: string;
  client: Pick<AxUCPClient, 'verifyOrderEvent'>;
  identity?:
    | Readonly<AxEventIdentity>
    | ((
        event: Readonly<AxUCPOrderEvent>,
        request: Request
      ) =>
        | Readonly<AxEventIdentity>
        | undefined
        | Promise<Readonly<AxEventIdentity> | undefined>);
  source?: string;
}

/**
 * Application-hosted UCP webhook ingress.
 *
 * The UCP client verifies signer profile, RFC 9421 signature, freshness, body
 * digest, and replay state before this adapter publishes anything. Application
 * identity mapping happens only after verification and remains separate from
 * the untrusted business payload.
 */
export class AxUCPWebhookEventSource implements AxEventSource {
  readonly id: string;
  readonly requiresDurable = true;
  private context?: Readonly<AxEventSourceContext>;

  constructor(
    private readonly options: Readonly<AxUCPWebhookEventSourceOptions>
  ) {
    this.id = options.id ?? 'ucp-webhooks';
  }

  start(context: Readonly<AxEventSourceContext>): AxEventSourceHandle {
    if (this.context)
      throw new Error(`Event source ${this.id} is already started`);
    this.context = context;
    return {
      close: () => {
        this.context = undefined;
      },
    };
  }

  async ingest(
    request: Request,
    signal?: AbortSignal
  ): Promise<AxEventPublishReceipt> {
    if (!this.context)
      throw new Error(`Event source ${this.id} is not started`);
    if (signal?.aborted) throw signal.reason;

    const event = await this.options.client.verifyOrderEvent(request);
    const mappedIdentity =
      typeof this.options.identity === 'function'
        ? await this.options.identity(event, request)
        : this.options.identity;
    const identity = hasVerifiedIdentity(mappedIdentity)
      ? mappedIdentity
      : undefined;
    const signer = request.headers
      .get('UCP-Agent')
      ?.match(/(?:^|;)\s*profile="([^"]+)"/)?.[1];
    const lifecycle = eventType(event);
    const eventId =
      request.headers.get('Webhook-Id') ?? event.event_id ?? event.id;

    return this.context.publish(
      {
        event: {
          specversion: '1.0',
          id: eventId,
          source: this.options.source ?? signer ?? 'ucp://business',
          type: `ucp.order.${lifecycle}`,
          subject: event.id,
          time: event.created_time,
          datacontenttype: 'application/json',
          data: event as unknown as AxEventValue,
          extensions: {
            ucpversion: '2026-04-08',
            checkoutid: event.checkout_id,
          },
        },
        identity,
        trust: identity ? 'authenticated' : 'untrusted',
        correlation: [
          { kind: 'ucp.order', value: event.id },
          { kind: 'ucp.checkout', value: event.checkout_id },
        ],
        partitionKey: event.checkout_id,
      },
      signal
    );
  }
}

function hasVerifiedIdentity(
  identity: Readonly<AxEventIdentity> | undefined
): identity is Readonly<AxEventIdentity> {
  return Boolean(identity?.tenantId || identity?.accountId || identity?.userId);
}

function eventType(event: Readonly<AxUCPOrderEvent>): string {
  const value = event.event_type ?? event.type ?? event.status ?? 'updated';
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'updated'
  );
}
