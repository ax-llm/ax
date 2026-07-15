import type {
  AxEventEnvelope,
  AxEventIdentity,
  AxEventIngress,
  AxEventMatcher,
  AxEventScalar,
  AxEventValue,
} from './types.js';

let fallbackId = 0;

export function axEventId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return `${prefix}-${randomUUID ? randomUUID() : `${Date.now()}-${++fallbackId}`}`;
}

export function axEventIdentityScope(
  identity: Readonly<AxEventIdentity> | undefined
): string {
  if (!identity) return 'anonymous';
  const values = [
    identity.tenantId ?? '',
    identity.accountId ?? '',
    identity.userId ?? '',
    identity.sessionId ?? '',
  ];
  return values.some(Boolean)
    ? values.map(encodeURIComponent).join('/')
    : 'anonymous';
}

export function axEventScopedDedupeKey(
  ingress: Readonly<AxEventIngress>
): string {
  return `${axEventIdentityScope(ingress.identity)}\n${ingress.event.source}\n${ingress.event.id}`;
}

export function axEventScopedCorrelationKey(
  identityScope: string,
  kind: string,
  value: string
): string {
  return `${identityScope}\n${kind}\n${value}`;
}

function assertPersistable(
  value: unknown,
  path: string,
  seen: Set<object>
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Event value at ${path} must be a finite number`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`Event value at ${path} is not persistable`);
  }
  if (seen.has(value)) throw new Error(`Event value at ${path} is cyclic`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertPersistable(item, `${path}[${index}]`, seen)
    );
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`Event value at ${path} must be a plain object`);
    }
    for (const [key, item] of Object.entries(value)) {
      assertPersistable(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function axValidateEventEnvelope(
  envelope: Readonly<AxEventEnvelope<unknown>>
): asserts envelope is Readonly<AxEventEnvelope<AxEventValue>> {
  if (envelope.specversion !== '1.0') {
    throw new Error('AxEventEnvelope.specversion must be "1.0"');
  }
  for (const field of ['id', 'source', 'type'] as const) {
    if (!envelope[field]?.trim()) {
      throw new Error(`AxEventEnvelope.${field} must be a non-empty string`);
    }
  }
  if (envelope.time && !Number.isFinite(Date.parse(envelope.time))) {
    throw new Error('AxEventEnvelope.time must be an ISO-8601 timestamp');
  }
  if (envelope.data !== undefined) {
    assertPersistable(envelope.data, 'data', new Set());
  }
  if (envelope.extensions !== undefined) {
    assertPersistable(envelope.extensions, 'extensions', new Set());
  }
}

export function axEventSizeBytes(ingress: Readonly<AxEventIngress>): number {
  const json = JSON.stringify(ingress);
  return new TextEncoder().encode(json).byteLength;
}

function matchesList(
  value: string | undefined,
  list: readonly string[] | undefined
) {
  return !list || (value !== undefined && list.includes(value));
}

export function axEventMatches(
  ingress: Readonly<AxEventIngress>,
  matcher: Readonly<AxEventMatcher>
): boolean {
  const event = ingress.event;
  if (!matchesList(event.source, matcher.sources)) return false;
  if (!matchesList(event.type, matcher.types)) return false;
  if (!matchesList(event.subject, matcher.subjects)) return false;
  for (const [key, expected] of Object.entries(matcher.extensions ?? {})) {
    const actual: AxEventScalar | undefined = event.extensions?.[key];
    if (actual !== expected) return false;
  }
  return true;
}

export function axEventErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
