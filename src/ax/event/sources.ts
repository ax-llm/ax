import {
  type AxEventClock,
  type AxEventEnvelope,
  type AxEventIdentity,
  type AxEventIngress,
  type AxEventPublishReceipt,
  type AxEventSource,
  type AxEventSourceContext,
  type AxEventSourceHandle,
  type AxEventTrust,
  type AxEventValue,
  AxSystemEventClock,
} from './types.js';
import { axEventId } from './util.js';

export class AxPushEventSource implements AxEventSource {
  private context?: Readonly<AxEventSourceContext>;

  constructor(
    readonly id: string,
    readonly requiresDurable = false
  ) {}

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

  publish(
    ingress: Readonly<AxEventIngress>,
    signal?: AbortSignal
  ): Promise<AxEventPublishReceipt> {
    if (!this.context)
      throw new Error(`Event source ${this.id} is not started`);
    return this.context.publish(ingress, signal);
  }
}

export interface AxTimerEventSourceOptions<T extends AxEventValue> {
  id: string;
  intervalMs: number;
  source?: string;
  type: string;
  subject?: string;
  data?: T | (() => T | Promise<T>);
  identity?: Readonly<AxEventIdentity>;
  trust?: AxEventTrust;
  fireImmediately?: boolean;
  clock?: AxEventClock;
}

export class AxTimerEventSource<T extends AxEventValue = AxEventValue>
  implements AxEventSource
{
  readonly id: string;
  readonly requiresDurable = false;
  private readonly clock: AxEventClock;

  constructor(
    private readonly options: Readonly<AxTimerEventSourceOptions<T>>
  ) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error('AxTimerEventSource intervalMs must be positive');
    }
    this.id = options.id;
    this.clock = options.clock ?? new AxSystemEventClock();
  }

  start(context: Readonly<AxEventSourceContext>): AxEventSourceHandle {
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    void this.loop(context, signal).catch((error) => {
      if (!signal.aborted) context.reportError(error);
    });
    return { close: () => controller.abort(`Timer source ${this.id} closed`) };
  }

  private async loop(
    context: Readonly<AxEventSourceContext>,
    signal: AbortSignal
  ): Promise<void> {
    if (this.options.fireImmediately) await this.fire(context, signal);
    while (!signal.aborted) {
      await this.clock.sleep(this.options.intervalMs, signal);
      if (!signal.aborted) await this.fire(context, signal);
    }
  }

  private async fire(
    context: Readonly<AxEventSourceContext>,
    signal: AbortSignal
  ): Promise<void> {
    const data =
      typeof this.options.data === 'function'
        ? await (this.options.data as () => T | Promise<T>)()
        : this.options.data;
    const event: AxEventEnvelope<T> = {
      specversion: '1.0',
      id: axEventId(this.id),
      source: this.options.source ?? `ax://timer/${this.id}`,
      type: this.options.type,
      time: new Date(this.clock.now()).toISOString(),
      ...(this.options.subject ? { subject: this.options.subject } : {}),
      ...(data !== undefined ? { data } : {}),
    };
    await context.publish(
      {
        event,
        identity: this.options.identity,
        trust: this.options.trust ?? 'trusted',
      },
      signal
    );
  }
}
