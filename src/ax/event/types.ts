import type { AxAIService } from '../ai/types.js';
import type {
  AxGenDeltaOut,
  AxProgramForwardOptions,
  AxProgrammable,
} from '../dsp/types.js';

export type AxEventTrust = 'trusted' | 'authenticated' | 'untrusted';

export type AxEventScalar = string | number | boolean | null;
export type AxEventValue =
  | AxEventScalar
  | readonly AxEventValue[]
  | { readonly [key: string]: AxEventValue };

export interface AxEventEnvelope<T = AxEventValue> {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  subject?: string;
  time?: string;
  datacontenttype?: string;
  dataschema?: string;
  data?: T;
  extensions?: Readonly<Record<string, AxEventScalar>>;
}

export interface AxEventIdentity {
  tenantId?: string;
  accountId?: string;
  userId?: string;
  sessionId?: string;
}

export interface AxEventCorrelationKey {
  kind: string;
  value: string;
}

export interface AxEventIngress<T = AxEventValue> {
  event: Readonly<AxEventEnvelope<T>>;
  identity?: Readonly<AxEventIdentity>;
  trust?: AxEventTrust;
  correlation?: readonly Readonly<AxEventCorrelationKey>[];
  partitionKey?: string;
}

export interface AxEventPublishReceipt {
  eventId: string;
  accepted: boolean;
  duplicate: boolean;
  durability: 'volatile' | 'persistent';
  deliveryIds: readonly string[];
}

export interface AxEventClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export class AxSystemEventClock implements AxEventClock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, Math.max(0, ms));
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(signal.reason);
        },
        { once: true }
      );
    });
  }
}

/** Deterministic clock for conformance tests, replay, and host schedulers. */
export class AxManualEventClock implements AxEventClock {
  private sleepers: Array<{
    at: number;
    resolve: () => void;
    reject: (reason: unknown) => void;
  }> = [];

  constructor(private value = 0) {}

  now(): number {
    return this.value;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sleeper = { at: this.value + ms, resolve, reject };
      this.sleepers.push(sleeper);
      signal?.addEventListener(
        'abort',
        () => {
          this.sleepers = this.sleepers.filter((value) => value !== sleeper);
          reject(signal.reason);
        },
        { once: true }
      );
    });
  }

  advanceBy(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(
        'AxManualEventClock advanceBy requires a non-negative value'
      );
    }
    this.value += ms;
    const ready = this.sleepers.filter((sleeper) => sleeper.at <= this.value);
    this.sleepers = this.sleepers.filter((sleeper) => sleeper.at > this.value);
    for (const sleeper of ready) sleeper.resolve();
  }

  set(time: number): void {
    if (time < this.value)
      throw new Error('AxManualEventClock cannot move backwards');
    this.advanceBy(time - this.value);
  }
}

export class AxEventBackpressureError extends Error {
  constructor(message = 'AxEventRuntime inbox capacity was exhausted') {
    super(message);
    this.name = 'AxEventBackpressureError';
  }
}

export class AxEventContinuationNotFoundError extends Error {
  constructor(readonly correlation: Readonly<AxEventCorrelationKey>) {
    super(
      `No active event continuation owns ${correlation.kind}:${correlation.value}`
    );
    this.name = 'AxEventContinuationNotFoundError';
  }
}

export class AxEventOutcomeUnknownError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AxEventOutcomeUnknownError';
  }
}

export type AxEventRouteAction = 'observe' | 'invalidate' | 'resume' | 'wake';

export interface AxEventMatcher {
  sources?: readonly string[];
  types?: readonly string[];
  subjects?: readonly string[];
  extensions?: Readonly<Record<string, AxEventScalar>>;
}

export interface AxEventContinuationRegistration {
  correlation: readonly Readonly<AxEventCorrelationKey>[];
  expiresAt?: number;
  metadata?: Readonly<Record<string, AxEventValue>>;
}

export interface AxEventContinuation {
  id: string;
  targetId: string;
  routeId: string;
  instanceKey: string;
  identityScope: string;
  correlation: readonly Readonly<AxEventCorrelationKey>[];
  createdAt: number;
  expiresAt?: number;
  stateVersion?: number;
  metadata?: Readonly<Record<string, AxEventValue>>;
}

export interface AxEventContext {
  readonly runtimeId: string;
  readonly runId: string;
  readonly deliveryId: string;
  readonly routeId: string;
  readonly targetId?: string;
  readonly instanceKey: string;
  readonly ingress: Readonly<AxEventIngress>;
  readonly identity: Readonly<AxEventIdentity>;
  readonly trust: AxEventTrust;
  readonly attempt: number;
  readonly idempotencyKey: string;
  readonly abortSignal: AbortSignal;
  readonly continuation?: Readonly<AxEventContinuation>;
  registerContinuation(
    registration: Readonly<AxEventContinuationRegistration>
  ): string;
}

export type AxEventInheritance = 'all' | 'none';

export interface AxProgramStateEnvelope {
  schemaVersion: number;
  programVersion: string;
  revision: number;
  state: unknown;
  updatedAt: number;
}

export interface AxProgramStateStore {
  load(key: string): Promise<Readonly<AxProgramStateEnvelope> | undefined>;
  compareAndSet(
    key: string,
    expectedRevision: number | undefined,
    state: Readonly<Omit<AxProgramStateEnvelope, 'revision'>>
  ): Promise<Readonly<AxProgramStateEnvelope>>;
  delete(key: string): Promise<void>;
}

export interface AxEventProgramStateAdapter<P = AxProgrammable<any, any>> {
  schemaVersion: number;
  programVersion: string;
  restore(program: P, state: unknown): void | Promise<void>;
  capture(program: P): unknown | Promise<unknown>;
  migrateState?(
    args: Readonly<{
      state: unknown;
      fromSchemaVersion: number;
      fromProgramVersion: string;
      toSchemaVersion: number;
      toProgramVersion: string;
    }>
  ): unknown | Promise<unknown>;
}

export interface AxEventTargetInputContext {
  eventContext: Readonly<AxEventContext>;
  continuation?: Readonly<AxEventContinuation>;
}

export interface AxEventTarget<IN = any, OUT = any> {
  id: string;
  ai: Readonly<AxAIService>;
  program?: AxProgrammable<IN, OUT>;
  createProgram?: (
    instance: Readonly<{
      targetId: string;
      instanceKey: string;
      identity: Readonly<AxEventIdentity>;
    }>
  ) => AxProgrammable<IN, OUT> | Promise<AxProgrammable<IN, OUT>>;
  mapInput: (
    ingress: Readonly<AxEventIngress>,
    context: Readonly<AxEventTargetInputContext>
  ) => IN | Promise<IN>;
  forwardOptions?: Readonly<AxProgramForwardOptions<string>>;
  execution?: 'forward' | 'streaming';
  state?: AxEventProgramStateAdapter<AxProgrammable<IN, OUT>>;
  sinks?: readonly AxEventSink<OUT>[];
  retrySafety?: 'idempotent' | 'unknown';
}

export interface AxEventSinkContext<OUT = unknown> {
  run: Readonly<AxEventRun<OUT>>;
  eventContext: Readonly<AxEventContext>;
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface AxEventSink<OUT = unknown> {
  id: string;
  write(
    output: OUT,
    context: Readonly<AxEventSinkContext<OUT>>
  ): void | Promise<void>;
  writeChunk?(
    chunk: Readonly<AxGenDeltaOut<OUT>>,
    context: Readonly<AxEventSinkContext<OUT>>
  ): void | Promise<void>;
}

export interface AxEventInvalidator {
  invalidate(
    ingress: Readonly<AxEventIngress>,
    context: Readonly<AxEventContext>
  ): void | Promise<void>;
}

export interface AxEventRoute {
  id: string;
  match:
    | Readonly<AxEventMatcher>
    | ((ingress: Readonly<AxEventIngress>) => boolean | Promise<boolean>);
  action: AxEventRouteAction;
  target?: AxEventTarget<any, any>;
  instanceKey?: (ingress: Readonly<AxEventIngress>) => string | Promise<string>;
  requireAuthenticated?: boolean;
  authorize?: (ingress: Readonly<AxEventIngress>) => boolean | Promise<boolean>;
  observe?: (
    ingress: Readonly<AxEventIngress>,
    context: Readonly<AxEventContext>
  ) => void | Promise<void>;
  invalidator?: AxEventInvalidator;
  correlation?: (
    ingress: Readonly<AxEventIngress>
  ) => Readonly<AxEventCorrelationKey> | undefined;
  /** Hold matching deliveries for this long before they become claimable. */
  debounceMs?: number;
  /** Explicitly replace an older queued delivery in the debounce window. */
  coalesce?: 'latest';
  /** Allow this route to run out of order for the same target/instance. */
  ordering?: 'strict' | 'relaxed';
}

export type AxEventDeliveryStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'waiting_event'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered'
  | 'outcome_unknown';

export interface AxEventDelivery {
  id: string;
  sequence: number;
  ingress: Readonly<AxEventIngress>;
  identityScope: string;
  routeId: string;
  action: AxEventRouteAction;
  targetId?: string;
  instanceKey: string;
  status: AxEventDeliveryStatus;
  attempt: number;
  availableAt: number;
  acceptedAt: number;
  claimedBy?: string;
  runId?: string;
  error?: string;
  sizeBytes: number;
}

export type AxEventRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_event'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown';

export interface AxEventSinkAttempt {
  sinkId: string;
  attempts: number;
  status: 'pending' | 'succeeded' | 'failed';
  error?: string;
}

export interface AxEventRun<OUT = unknown> {
  id: string;
  deliveryId: string;
  routeId: string;
  targetId?: string;
  instanceKey: string;
  status: AxEventRunStatus;
  attempt: number;
  startedAt: number;
  finishedAt?: number;
  output?: OUT;
  chunks?: readonly AxGenDeltaOut<OUT>[];
  error?: string;
  continuationIds?: readonly string[];
  sinks?: readonly AxEventSinkAttempt[];
}

export interface AxEventDeadLetter {
  id: string;
  kind: 'delivery' | 'sink';
  deliveryId: string;
  runId?: string;
  sinkId?: string;
  reason: string;
  createdAt: number;
}

export interface AxEventStoreCapabilities {
  durability: 'volatile' | 'persistent';
  coordination: 'single-worker' | 'multi-worker';
  leases: boolean;
  transactions: boolean;
  compareAndSet: boolean;
  outputPersistence: boolean;
}

export interface AxEventEnqueueRequest {
  ingress: Readonly<AxEventIngress>;
  deliveries: readonly Readonly<
    Pick<
      AxEventDelivery,
      'routeId' | 'action' | 'targetId' | 'instanceKey' | 'sizeBytes'
    > & {
      availableAt?: number;
      coalesce?: 'latest';
      ordering?: 'strict' | 'relaxed';
    }
  >[];
  acceptedAt: number;
  publishTimeoutMs: number;
}

export interface AxEventStore {
  readonly capabilities: Readonly<AxEventStoreCapabilities>;
  enqueue(
    request: Readonly<AxEventEnqueueRequest>,
    signal?: AbortSignal
  ): Promise<AxEventPublishReceipt>;
  claim(workerId: string, now: number): Promise<AxEventDelivery | undefined>;
  getDelivery(
    deliveryId: string
  ): Promise<Readonly<AxEventDelivery> | undefined>;
  saveDelivery(delivery: Readonly<AxEventDelivery>): Promise<void>;
  saveRun(run: Readonly<AxEventRun>): Promise<void>;
  getRun(runId: string): Promise<Readonly<AxEventRun> | undefined>;
  registerContinuation(
    continuation: Readonly<AxEventContinuation>
  ): Promise<void>;
  findContinuation(
    identityScope: string,
    correlation: Readonly<AxEventCorrelationKey>,
    now: number
  ): Promise<Readonly<AxEventContinuation> | undefined>;
  completeContinuation(id: string): Promise<void>;
  addDeadLetter(deadLetter: Readonly<AxEventDeadLetter>): Promise<void>;
  getDeadLetter(id: string): Promise<Readonly<AxEventDeadLetter> | undefined>;
  removeDeadLetter(id: string): Promise<void>;
  listDeadLetters(): Promise<readonly Readonly<AxEventDeadLetter>[]>;
  redriveDelivery(deliveryId: string, now: number): Promise<void>;
  nextAvailableAt(now: number): Promise<number | undefined>;
  waitForWork(signal?: AbortSignal): Promise<void>;
  isIdle(): Promise<boolean>;
  close?(): void | Promise<void>;
}

export interface AxEventSourceHandle {
  close(): void | Promise<void>;
}

export interface AxEventSourceContext {
  signal: AbortSignal;
  publish(
    ingress: Readonly<AxEventIngress>,
    signal?: AbortSignal
  ): Promise<AxEventPublishReceipt>;
  reportError(error: unknown): void;
}

export interface AxEventSource {
  id: string;
  requiresDurable?: boolean;
  start(
    context: Readonly<AxEventSourceContext>
  ): undefined | AxEventSourceHandle | Promise<AxEventSourceHandle | undefined>;
}

export interface AxEventRuntimeOptions {
  id?: string;
  routes: readonly AxEventRoute[];
  sources?: readonly AxEventSource[];
  store?: AxEventStore;
  programStateStore?: AxProgramStateStore;
  clock?: AxEventClock;
  workerId?: string;
  workerConcurrency?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  publishTimeoutMs?: number;
  allowVolatile?: boolean;
  onSourceError?: (sourceId: string, error: unknown) => void | Promise<void>;
}

export interface AxEventCloseOptions {
  drain?: boolean;
  timeoutMs?: number;
}
