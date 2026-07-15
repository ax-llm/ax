import type { AxAIService } from '../ai/types.js';
import type { AxSignature } from '../dsp/sig.js';
import type { AxProgramForwardOptions, AxProgrammable } from '../dsp/types.js';
import { validateValue } from '../dsp/util.js';
import {
  type AxEventContext,
  type AxEventContinuation,
  type AxEventContinuationPlan,
  type AxEventCorrelationKey,
  type AxEventIngress,
  type AxEventInputBuilder,
  type AxEventInputDefinition,
  AxEventInputError,
  type AxEventInputPlan,
  type AxEventInvalidator,
  type AxEventMatcher,
  type AxEventPath,
  type AxEventPathSegment,
  type AxEventProgramStateAdapter,
  type AxEventRoute,
  type AxEventRouteAction,
  type AxEventScalar,
  type AxEventSink,
  type AxEventTarget,
} from './types.js';

const unsafeSegments = new Set(['__proto__', 'constructor', 'prototype']);

function checkedSegments(
  segments: readonly AxEventPathSegment[]
): readonly AxEventPathSegment[] {
  for (const segment of segments) {
    if (
      (typeof segment === 'string' &&
        (!segment.length || unsafeSegments.has(segment))) ||
      (typeof segment === 'number' &&
        (!Number.isSafeInteger(segment) || segment < 0))
    ) {
      throw new AxEventInputError(
        `Unsafe event path segment: ${String(segment)}`
      );
    }
  }
  return Object.freeze([...segments]);
}

function path<T>(value: Readonly<AxEventPath<T>>): Readonly<AxEventPath<T>> {
  return Object.freeze({
    ...value,
    ...(value.segments ? { segments: checkedSegments(value.segments) } : {}),
  });
}

export const eventPath = Object.freeze({
  data: (...segments: AxEventPathSegment[]) => path({ root: 'data', segments }),
  id: () => path<string>({ root: 'envelope', segments: ['id'] }),
  source: () => path<string>({ root: 'envelope', segments: ['source'] }),
  type: () => path<string>({ root: 'envelope', segments: ['type'] }),
  subject: () =>
    path<string | undefined>({ root: 'envelope', segments: ['subject'] }),
  time: () =>
    path<string | undefined>({ root: 'envelope', segments: ['time'] }),
  extension: (name: string) => path({ root: 'extensions', segments: [name] }),
  identity: (name: 'tenantId' | 'accountId' | 'userId' | 'sessionId') =>
    path<string | undefined>({ root: 'identity', segments: [name] }),
  trust: () => path({ root: 'trust' }),
  correlation: (kind: string) => {
    if (!kind.trim())
      throw new AxEventInputError('Correlation kind must be non-empty');
    return path<string | undefined>({
      root: 'correlation',
      correlationKind: kind,
    });
  },
  continuation: (...segments: AxEventPathSegment[]) =>
    path({ root: 'continuation', segments }),
  constant: <T>(value: T) => path<T>({ root: 'constant', value }),
});

export function resolveEventPath(
  selector: Readonly<AxEventPath>,
  ingress: Readonly<AxEventIngress>,
  continuation?: Readonly<AxEventContinuation>
): unknown {
  let value: unknown;
  switch (selector.root) {
    case 'constant':
      value = selector.value;
      break;
    case 'correlation':
      value = ingress.correlation?.find(
        (candidate) => candidate.kind === selector.correlationKind
      )?.value;
      break;
    case 'data':
      value = ingress.event.data;
      break;
    case 'envelope':
      value = ingress.event;
      break;
    case 'extensions':
      value = ingress.event.extensions;
      break;
    case 'identity':
      value = ingress.identity;
      break;
    case 'trust':
      value = ingress.trust ?? 'untrusted';
      break;
    case 'continuation':
      value = continuation?.metadata;
      break;
  }
  for (const segment of selector.segments ?? []) {
    if (value === null || typeof value !== 'object') return undefined;
    if (!Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}

class AxEventInputBuilderImpl<IN> implements AxEventInputBuilder<IN> {
  private projection?: Readonly<AxEventPath>;
  private readonly mappings = new Map<string, Readonly<AxEventPath>>();

  project(selector: Readonly<AxEventPath>): AxEventInputBuilder<IN> {
    if (this.projection) {
      throw new AxEventInputError(
        'An event input plan may project only one path'
      );
    }
    this.projection = selector;
    return this;
  }

  field<K extends Extract<keyof IN, string>>(
    field: K,
    selector: Readonly<AxEventPath>
  ): AxEventInputBuilder<IN> {
    if (!field || unsafeSegments.has(field)) {
      throw new AxEventInputError(`Unsafe target field: ${field}`);
    }
    if (this.mappings.has(field)) {
      throw new AxEventInputError(
        `Event input field ${field} is mapped more than once`
      );
    }
    this.mappings.set(field, selector);
    return this;
  }

  build(): Readonly<AxEventInputPlan<IN>> {
    return Object.freeze({
      ...(this.projection ? { project: this.projection } : {}),
      fields: Object.freeze(
        [...this.mappings].map(([field, selector]) =>
          Object.freeze({ field, path: selector })
        )
      ),
    });
  }
}

export function eventInput<
  IN = Record<string, unknown>,
>(): AxEventInputBuilder<IN> {
  return new AxEventInputBuilderImpl<IN>();
}

function isInputBuilder<IN>(
  value: unknown
): value is Readonly<AxEventInputBuilder<IN>> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as AxEventInputBuilder<IN>).build === 'function'
  );
}

export function normalizeEventInputDefinition<IN>(
  definition: AxEventInputDefinition<IN>
): Readonly<AxEventInputPlan<IN>> {
  const value =
    typeof definition === 'function'
      ? definition(eventInput<IN>())
      : definition;
  const plan = isInputBuilder<IN>(value) ? value.build() : value;
  if (!plan || !Array.isArray(plan.fields)) {
    throw new AxEventInputError('Event input mapping did not produce a plan');
  }
  return Object.freeze({
    ...(plan.project ? { project: plan.project } : {}),
    fields: Object.freeze(
      plan.fields.map((field) => Object.freeze({ ...field }))
    ),
  });
}

export function validateEventInputPlan(
  plan: Readonly<AxEventInputPlan>,
  signature: Readonly<AxSignature>,
  label: string
): void {
  const inputFields = signature.getInputFields();
  const declared = new Set(inputFields.map((field) => field.name));
  const mapped = new Set<string>();
  for (const mapping of plan.fields) {
    if (!declared.has(mapping.field)) {
      throw new AxEventInputError(
        `${label} maps unknown signature input ${mapping.field}`
      );
    }
    if (mapped.has(mapping.field)) {
      throw new AxEventInputError(
        `${label} maps signature input ${mapping.field} more than once`
      );
    }
    mapped.add(mapping.field);
  }
  if (!plan.project) {
    const missing = inputFields
      .filter((field) => !field.isOptional && !mapped.has(field.name))
      .map((field) => field.name);
    if (missing.length) {
      throw new AxEventInputError(
        `${label} does not map required signature inputs: ${missing.join(', ')}`
      );
    }
  }
}

function cloneInputValue(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Canonicalize any event mapping result to the target program signature.
 * Undeclared fields are deliberately discarded before model invocation.
 */
export function normalizeEventInputValue<IN>(
  value: unknown,
  signature: Readonly<AxSignature>
): IN {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AxEventInputError('Mapped event input must be an object');
  }
  const source = value as Record<string, unknown>;
  const output = Object.create(null) as Record<string, unknown>;
  for (const field of signature.getInputFields()) {
    const raw = Object.hasOwn(source, field.name)
      ? source[field.name]
      : undefined;
    if (raw === undefined) {
      if (field.isOptional) continue;
      throw new AxEventInputError(
        `Required signature input ${field.name} was not present`
      );
    }
    const cloned = cloneInputValue(raw);
    try {
      validateValue(field, cloned as never);
    } catch (error) {
      throw new AxEventInputError(
        `Signature input ${field.name} failed validation`,
        { cause: error }
      );
    }
    Object.defineProperty(output, field.name, {
      enumerable: true,
      configurable: false,
      writable: true,
      value: cloned,
    });
  }
  return output as IN;
}

export function mapEventInput<IN>(
  plan: Readonly<AxEventInputPlan<IN>>,
  signature: Readonly<AxSignature>,
  ingress: Readonly<AxEventIngress>,
  continuation?: Readonly<AxEventContinuation>
): IN {
  validateEventInputPlan(plan, signature, 'Event input plan');
  let projection: Record<string, unknown> | undefined;
  if (plan.project) {
    const resolved = resolveEventPath(plan.project, ingress, continuation);
    if (
      resolved === null ||
      typeof resolved !== 'object' ||
      Array.isArray(resolved)
    ) {
      throw new AxEventInputError('Projected event input must be an object');
    }
    projection = resolved as Record<string, unknown>;
  }
  const explicit = new Map(
    plan.fields.map((value) => [value.field, value.path])
  );
  const output = Object.create(null) as Record<string, unknown>;
  for (const field of signature.getInputFields()) {
    const selector = explicit.get(field.name);
    let value = selector
      ? resolveEventPath(selector, ingress, continuation)
      : undefined;
    if (!selector && projection && Object.hasOwn(projection, field.name)) {
      value = projection[field.name];
    }
    if (value === undefined) continue;
    Object.defineProperty(output, field.name, {
      enumerable: true,
      configurable: false,
      writable: true,
      value,
    });
  }
  return normalizeEventInputValue<IN>(output, signature);
}

export function selectEventInputPlan<IN>(
  target: Readonly<AxEventTarget<IN, unknown>>,
  continuation?: Readonly<AxEventContinuation>
): Readonly<AxEventInputPlan<IN>> | undefined {
  return continuation
    ? (target.resumeInput ?? target.input)
    : (target.wakeInput ?? target.input);
}

function targetSignature<IN, OUT>(
  target: Readonly<AxEventTarget<IN, OUT>>
): Readonly<AxSignature> | undefined {
  return target.program?.getSignature() ?? target.inputSignature;
}

export function validateEventTarget<IN, OUT>(
  target: Readonly<AxEventTarget<IN, OUT>>
): AxEventTarget<IN, OUT> {
  if (!target.id.trim()) throw new Error('AxEventTarget.id must be non-empty');
  if (Boolean(target.program) === Boolean(target.createProgram)) {
    throw new Error(
      `AxEventTarget ${target.id} must provide exactly one of program or createProgram`
    );
  }
  const plans = [target.input, target.wakeInput, target.resumeInput].filter(
    (value): value is Readonly<AxEventInputPlan<IN>> => Boolean(value)
  );
  if (target.mapInput && plans.length) {
    throw new Error(
      `AxEventTarget ${target.id} cannot combine mapInput with declarative input plans`
    );
  }
  if (!target.mapInput && !plans.length) {
    throw new Error(`AxEventTarget ${target.id} requires an input mapping`);
  }
  const signature = plans.length ? targetSignature(target) : undefined;
  if (plans.length && !signature) {
    throw new Error(
      `AxEventTarget ${target.id} createProgram requires inputSignature for declarative input plans`
    );
  }
  if (
    target.program &&
    target.inputSignature &&
    target.program.getSignature().toString() !==
      target.inputSignature.toString()
  ) {
    throw new Error(
      `AxEventTarget ${target.id} inputSignature does not match program`
    );
  }
  if (signature) {
    if (target.input)
      validateEventInputPlan(target.input, signature, `${target.id}.input`);
    if (target.wakeInput)
      validateEventInputPlan(
        target.wakeInput,
        signature,
        `${target.id}.wakeInput`
      );
    if (target.resumeInput)
      validateEventInputPlan(
        target.resumeInput,
        signature,
        `${target.id}.resumeInput`
      );
  }
  for (const continuation of target.waitFor ?? []) {
    if (!continuation.kind.trim()) {
      throw new Error(
        `AxEventTarget ${target.id} waitFor kind must be non-empty`
      );
    }
    if (
      continuation.expiresInMs !== undefined &&
      (!Number.isFinite(continuation.expiresInMs) ||
        continuation.expiresInMs <= 0)
    ) {
      throw new Error(
        `AxEventTarget ${target.id} waitFor expiresInMs must be positive`
      );
    }
  }
  return {
    ...target,
    ...(target.waitFor ? { waitFor: [...target.waitFor] } : {}),
  };
}

export function verifyEventTargetProgram<IN, OUT>(
  target: Readonly<AxEventTarget<IN, OUT>>,
  program: Readonly<AxProgrammable<IN, OUT>>
): void {
  if (
    target.inputSignature &&
    target.inputSignature.toString() !== program.getSignature().toString()
  ) {
    throw new AxEventInputError(
      `Created program signature does not match ${target.id}.inputSignature`
    );
  }
}

type TargetFactoryInstance = Readonly<{
  targetId: string;
  instanceKey: string;
  identity: Readonly<import('./types.js').AxEventIdentity>;
}>;

export class AxEventTargetBuilder<IN = Record<string, unknown>, OUT = unknown> {
  private readonly value: Partial<AxEventTarget<any, any>> & { id: string };

  constructor(id: string) {
    this.value = { id, sinks: [], waitFor: [] };
  }

  program<NextInput, NextOutput>(
    program: AxProgrammable<NextInput, NextOutput>
  ): AxEventTargetBuilder<NextInput, NextOutput> {
    this.value.program = program;
    return this as unknown as AxEventTargetBuilder<NextInput, NextOutput>;
  }

  createProgram<NextInput, NextOutput>(
    signature: Readonly<AxSignature>,
    factory: (
      instance: TargetFactoryInstance
    ) =>
      | AxProgrammable<NextInput, NextOutput>
      | Promise<AxProgrammable<NextInput, NextOutput>>
  ): AxEventTargetBuilder<NextInput, NextOutput> {
    this.value.inputSignature = signature;
    this.value.createProgram = factory;
    return this as unknown as AxEventTargetBuilder<NextInput, NextOutput>;
  }

  ai(ai: Readonly<AxAIService>): this {
    this.value.ai = ai;
    return this;
  }

  input(definition: AxEventInputDefinition<IN>): this {
    this.value.input = normalizeEventInputDefinition(definition);
    return this;
  }

  wakeInput(definition: AxEventInputDefinition<IN>): this {
    this.value.wakeInput = normalizeEventInputDefinition(definition);
    return this;
  }

  resumeInput(definition: AxEventInputDefinition<IN>): this {
    this.value.resumeInput = normalizeEventInputDefinition(definition);
    return this;
  }

  waitFor(
    kind: string,
    value: Readonly<AxEventPath>,
    options: Readonly<{
      expiresInMs?: number;
      metadata?: Readonly<Record<string, Readonly<AxEventPath>>>;
    }> = {}
  ): this {
    const plans = this.value.waitFor as AxEventContinuationPlan[];
    plans.push({ kind, value, ...options });
    return this;
  }

  forwardOptions(options: Readonly<AxProgramForwardOptions<string>>): this {
    this.value.forwardOptions = options;
    return this;
  }

  execution(execution: 'forward' | 'streaming'): this {
    this.value.execution = execution;
    return this;
  }

  state(state: AxEventProgramStateAdapter<AxProgrammable<IN, OUT>>): this {
    this.value.state = state;
    return this;
  }

  sink(sink: AxEventSink<OUT>): this {
    (this.value.sinks as AxEventSink<OUT>[]).push(sink);
    return this;
  }

  retrySafety(retrySafety: 'idempotent' | 'unknown'): this {
    this.value.retrySafety = retrySafety;
    return this;
  }

  build(): AxEventTarget<IN, OUT> {
    if (!this.value.ai) {
      throw new Error(`AxEventTarget ${this.value.id} requires ai()`);
    }
    return validateEventTarget(this.value as AxEventTarget<IN, OUT>);
  }
}

function validateRoute(route: Readonly<AxEventRoute>): AxEventRoute {
  if (!route.id.trim()) throw new Error('AxEventRoute.id must be non-empty');
  if (route.action === 'wake' && !route.target) {
    throw new Error(`Wake route ${route.id} requires a target`);
  }
  if (route.action === 'invalidate' && !route.invalidator) {
    throw new Error(`Invalidate route ${route.id} requires an invalidator`);
  }
  if (
    route.debounceMs !== undefined &&
    (!Number.isFinite(route.debounceMs) || route.debounceMs < 0)
  ) {
    throw new Error(`Event route ${route.id} debounceMs must be non-negative`);
  }
  if (route.coalesce && !route.debounceMs) {
    throw new Error(`Event route ${route.id} coalescing requires debounceMs`);
  }
  if (route.target) {
    const target = validateEventTarget(route.target);
    const hasCommon = Boolean(target.input ?? target.mapInput);
    if (route.action === 'wake' && !hasCommon && !target.wakeInput) {
      throw new Error(`Wake target ${target.id} requires input or wakeInput`);
    }
    if (route.action === 'resume' && !hasCommon && !target.resumeInput) {
      throw new Error(
        `Resume target ${target.id} requires input or resumeInput`
      );
    }
  }
  return { ...route };
}

export class AxEventRouteBuilder {
  private matcher: AxEventMatcher = {};
  private predicate?: AxEventRoute['match'] & Function;
  private action?: AxEventRouteAction;
  private target?: AxEventTarget<any, any>;
  private requireAuthenticated?: boolean;
  private authorizeHandler?: AxEventRoute['authorize'];
  private observeHandler?: AxEventRoute['observe'];
  private invalidator?: AxEventInvalidator;
  private instanceKeyHandler?: AxEventRoute['instanceKey'];
  private correlationHandler?: AxEventRoute['correlation'];
  private debounceMs?: number;
  private coalesce?: 'latest';
  private orderingMode?: 'strict' | 'relaxed';

  constructor(private readonly id: string) {}

  match(match: AxEventRoute['match']): this {
    if (typeof match === 'function') {
      if (Object.keys(this.matcher).length) {
        throw new Error(
          'Predicate match cannot be combined with matcher fields'
        );
      }
      this.predicate = match as AxEventRoute['match'] & Function;
    } else {
      if (this.predicate) {
        throw new Error(
          'Matcher fields cannot be combined with predicate match'
        );
      }
      this.matcher = { ...this.matcher, ...match };
    }
    return this;
  }

  types(...types: string[]): this {
    return this.addMatcher('types', types);
  }

  sources(...sources: string[]): this {
    return this.addMatcher('sources', sources);
  }

  subjects(...subjects: string[]): this {
    return this.addMatcher('subjects', subjects);
  }

  extensions(extensions: Readonly<Record<string, AxEventScalar>>): this {
    this.assertMatcherFields();
    this.matcher = {
      ...this.matcher,
      extensions: { ...(this.matcher.extensions ?? {}), ...extensions },
    };
    return this;
  }

  authenticated(): this {
    this.requireAuthenticated = true;
    return this;
  }

  authorize(authorize: NonNullable<AxEventRoute['authorize']>): this {
    this.authorizeHandler = authorize;
    return this;
  }

  instanceKey(
    selector: Readonly<AxEventPath> | NonNullable<AxEventRoute['instanceKey']>
  ): this {
    this.instanceKeyHandler =
      typeof selector === 'function'
        ? selector
        : (ingress) => {
            const value = resolveEventPath(selector, ingress);
            if (typeof value !== 'string' || !value.trim()) {
              throw new AxEventInputError(
                `Route ${this.id} instanceKey path did not resolve to a string`
              );
            }
            return value;
          };
    return this;
  }

  correlate(kind: string, selector: Readonly<AxEventPath>): this {
    if (!kind.trim()) throw new Error('Correlation kind must be non-empty');
    this.correlationHandler = (ingress) => {
      const value = resolveEventPath(selector, ingress);
      if (
        (typeof value !== 'string' && typeof value !== 'number') ||
        !String(value).trim()
      ) {
        throw new AxEventInputError(
          `Route ${this.id} correlation path did not resolve to a scalar`
        );
      }
      return { kind, value: String(value) };
    };
    return this;
  }

  correlation(
    correlation: (
      ingress: Readonly<AxEventIngress>
    ) => Readonly<AxEventCorrelationKey> | undefined
  ): this {
    this.correlationHandler = correlation;
    return this;
  }

  wake(target: AxEventTarget<any, any>): this {
    return this.setAction('wake', target);
  }

  resume(target: AxEventTarget<any, any>): this {
    return this.setAction('resume', target);
  }

  observe(
    observe?: (
      ingress: Readonly<AxEventIngress>,
      context: Readonly<AxEventContext>
    ) => void | Promise<void>
  ): this {
    this.setAction('observe');
    this.observeHandler = observe;
    return this;
  }

  invalidate(invalidator: AxEventInvalidator): this {
    this.setAction('invalidate');
    this.invalidator = invalidator;
    return this;
  }

  debounce(ms: number, options: Readonly<{ coalesce?: 'latest' }> = {}): this {
    this.debounceMs = ms;
    this.coalesce = options.coalesce;
    return this;
  }

  ordering(ordering: 'strict' | 'relaxed'): this {
    this.orderingMode = ordering;
    return this;
  }

  build(): AxEventRoute {
    if (!this.action)
      throw new Error(`AxEventRoute ${this.id} requires an action`);
    return validateRoute({
      id: this.id,
      match: this.predicate ?? this.matcher,
      action: this.action,
      ...(this.target ? { target: this.target } : {}),
      ...(this.instanceKeyHandler
        ? { instanceKey: this.instanceKeyHandler }
        : {}),
      ...(this.requireAuthenticated ? { requireAuthenticated: true } : {}),
      ...(this.authorizeHandler ? { authorize: this.authorizeHandler } : {}),
      ...(this.observeHandler ? { observe: this.observeHandler } : {}),
      ...(this.invalidator ? { invalidator: this.invalidator } : {}),
      ...(this.correlationHandler
        ? { correlation: this.correlationHandler }
        : {}),
      ...(this.debounceMs !== undefined ? { debounceMs: this.debounceMs } : {}),
      ...(this.coalesce ? { coalesce: this.coalesce } : {}),
      ...(this.orderingMode ? { ordering: this.orderingMode } : {}),
    });
  }

  private assertMatcherFields(): void {
    if (this.predicate) {
      throw new Error('Matcher fields cannot be combined with predicate match');
    }
  }

  private addMatcher(
    key: 'types' | 'sources' | 'subjects',
    values: readonly string[]
  ): this {
    this.assertMatcherFields();
    if (!values.length || values.some((value) => !value.trim())) {
      throw new Error(
        `Event route ${this.id} ${key} must be non-empty strings`
      );
    }
    this.matcher = { ...this.matcher, [key]: [...values] };
    return this;
  }

  private setAction(
    action: AxEventRouteAction,
    target?: AxEventTarget<any, any>
  ): this {
    if (this.action) {
      throw new Error(
        `AxEventRoute ${this.id} already selected ${this.action}`
      );
    }
    this.action = action;
    this.target = target;
    return this;
  }
}

export { validateRoute as validateEventRoute };
