from __future__ import annotations
import os

import base64
import hashlib
import ipaddress
import json
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from .signature import AxSignature
from .tool import Tool
# AXIR_CORE_IMPORTS


_CORE_COVERAGE_SEEN: set[str] = set()


def _core_coverage_mark(name):
    path = os.environ.get("AXIR_COVERAGE_FILE")
    if not path or name in _CORE_COVERAGE_SEEN:
        return
    _CORE_COVERAGE_SEEN.add(name)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(name + "\n")


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_is_none(value):
    return value is None
def _core_is_not_none(value):
    return value is not None
def _core_type_is(value, expected):
    return {
        "object": isinstance(value, dict),
        "array": isinstance(value, (list, tuple)),
        "list": isinstance(value, (list, tuple)),
        "string": isinstance(value, str),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "bool": isinstance(value, bool),
        "boolean": isinstance(value, bool),
    }.get(expected, False)


def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_not(value): return not bool(value)
def _core_eq(left, right): return left == right
def _core_lt(left, right): return left < right
def _core_lte(left, right): return left <= right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_add(left, right): return left + right
def _core_mul(left, right): return left * right
def _core_len(value): return len(value or [])
def _core_contains(container, item): return False if container is None else item in container
def _core_truthy(value): return bool(value)
def _core_none(): return None
def _core_json_stringify(value): return json.dumps(value, separators=(",", ":"), sort_keys=True)
def _core_json_parse(value): return json.loads(value)
def _core_math_abs(value): return abs(value)


def _core_map_merge(left, right):
    merged = dict(left or {})
    merged.update(right or {})
    return merged


def _core_map_contains(values, key): return isinstance(values, dict) and key in values
def _core_map_delete(target, key):
    if isinstance(target, dict): target.pop(key, None)
    return target
def _core_map_keys(values): return list(values.keys()) if isinstance(values, dict) else []
def _core_string_lower(value): return str(value).lower()
def _core_string_starts_with(value, prefix): return str(value).startswith(str(prefix))
def _core_string_ends_with(value, suffix): return str(value).endswith(str(suffix))
def _core_regex_match(pattern, value): return isinstance(value, str) and re.search(pattern, value) is not None
def _core_validation_error(message): return AxMCPError(str(message))


def _core_string_format(template, *args):
    rendered = str(template)
    for value in args:
        rendered = rendered.replace("{}", str(value), 1)
    return rendered


# AXIR_CORE_MCP_FUNCTIONS


AX_MCP_PROTOCOL_VERSION = "2025-11-25"
AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
    "2026-07-28",
    AX_MCP_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
]


class AxMCPError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None, data: Any = None):
        super().__init__(message)
        self.code = code
        self.data = data


@dataclass
class AxMCPTokenSet:
    accessToken: str
    refreshToken: str | None = None
    expiresAt: int | None = None
    issuer: str | None = None


@dataclass
class AxMCPOAuthOptions:
    clientId: str | None = None
    clientSecret: str | None = None
    redirectUri: str | None = None
    scopes: list[str] | None = None
    onAuthCode: Callable[[str], dict[str, str]] | None = None
    tokenStore: Any = None
    ssrfProtection: dict[str, Any] | None = None
    requireIss: bool = False


@dataclass
class AxMCPContinuationState:
    namespaces: list[str]
    tasks: list[dict[str, Any]]
    subscriptions: list[dict[str, Any]]
    catalogFingerprint: str


@dataclass(frozen=True)
class AxEventEnvelope:
    id: str
    source: str
    type: str
    data: Any = None
    subject: str | None = None
    specversion: str = "1.0"
    extensions: dict[str, Any] = field(default_factory=dict)
    correlation: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        value = {
            "specversion": self.specversion,
            "id": self.id,
            "source": self.source,
            "type": self.type,
        }
        if self.subject is not None:
            value["subject"] = self.subject
        if self.data is not None:
            value["data"] = self.data
        if self.extensions:
            value["extensions"] = dict(self.extensions)
        if self.correlation:
            value["correlation"] = list(self.correlation)
        return value


@dataclass(frozen=True)
class AxEventPath:
    root: str
    segments: tuple[str | int, ...] = ()
    correlationKind: str | None = None
    value: Any = None

    def __post_init__(self):
        for segment in self.segments:
            if (isinstance(segment, str) and (not segment or segment in {"__proto__", "constructor", "prototype"})) or (isinstance(segment, int) and segment < 0):
                raise AxEventInputError(f"Unsafe event path segment: {segment}")

    def to_dict(self):
        value = {"root": self.root, "segments": list(self.segments)}
        if self.correlationKind is not None: value["correlationKind"] = self.correlationKind
        if self.root == "constant": value["value"] = self.value
        return value


class event_path:
    @staticmethod
    def data(*segments): return AxEventPath("data", tuple(segments))
    @staticmethod
    def envelope(*segments): return AxEventPath("envelope", tuple(segments))
    @staticmethod
    def extension(name): return AxEventPath("extensions", (name,))
    @staticmethod
    def identity(*segments): return AxEventPath("identity", tuple(segments))
    @staticmethod
    def trust(): return AxEventPath("trust")
    @staticmethod
    def correlation(kind): return AxEventPath("correlation", correlationKind=kind)
    @staticmethod
    def continuation(*segments): return AxEventPath("continuation", tuple(segments))
    @staticmethod
    def constant(value): return AxEventPath("constant", value=value)
    @staticmethod
    def subject(): return AxEventPath("envelope", ("subject",))


@dataclass(frozen=True)
class AxEventInputPlan:
    project: AxEventPath | None = None
    fields: tuple[tuple[str, AxEventPath], ...] = ()

    def to_dict(self):
        return {"project": self.project.to_dict() if self.project else None,
                "fields": [{"field": name, "path": path.to_dict()} for name, path in self.fields]}


class AxEventInputBuilder:
    def __init__(self): self._project = None; self._fields = []
    def project(self, path):
        if self._project is not None: raise AxEventInputError("An event input plan may project only one path")
        self._project = path; return self
    def field(self, name, path):
        if not name or name in {"__proto__", "constructor", "prototype"}: raise AxEventInputError(f"Unsafe target field: {name}")
        if any(existing == name for existing, _ in self._fields): raise AxEventInputError(f"Event input field {name} is mapped more than once")
        self._fields.append((name, path)); return self
    def build(self): return AxEventInputPlan(self._project, tuple(self._fields))


def event_input(): return AxEventInputBuilder()


@dataclass(frozen=True)
class AxEventRoute:
    id: str
    action: str
    match: dict[str, Any]
    targetId: str | None = None
    requireAuthenticated: bool = False
    ordering: str = "strict"
    debounceMs: int = 0
    instanceKey: AxEventPath | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "action": self.action,
            "match": self.match,
            "targetId": self.targetId,
            "requireAuthenticated": self.requireAuthenticated,
            "ordering": self.ordering,
            "debounceMs": self.debounceMs,
            "instanceKey": self.instanceKey.to_dict() if self.instanceKey else None,
        }


@dataclass(frozen=True)
class AxEventCommand:
    routeId: str
    action: str
    instanceKey: str
    idempotencyKey: str
    targetId: str | None = None


@dataclass(frozen=True)
class AxEventPublishReceipt:
    eventId: str
    accepted: bool
    duplicate: bool
    durability: str
    deliveryIds: list[str]


@dataclass
class AxEventRun:
    id: str
    deliveryId: str
    routeId: str
    targetId: str | None
    instanceKey: str
    status: str = "queued"
    attempt: int = 0
    output: Any = None
    error: str | None = None
    continuationIds: list[str] = field(default_factory=list)


@dataclass
class AxEventDeadLetter:
    id: str
    deliveryId: str
    reason: str
    runId: str | None = None
    sinkId: str | None = None


@dataclass
class AxEventContinuation:
    id: str
    targetId: str
    instanceKey: str
    identityScope: str
    correlation: list[dict[str, str]]
    metadata: dict[str, Any] = field(default_factory=dict)
    completed: bool = False
    expiresAt: float | None = None


class AxEventCancellationToken:
    def __init__(self): self.cancelled = False; self.reason = None
    def cancel(self, reason="cancelled"): self.cancelled = True; self.reason = reason


@dataclass
class AxEventTarget:
    id: str
    invoke: Callable[[Any, dict[str, Any]], Any]
    mapInput: Callable[[AxEventEnvelope, AxEventContinuation | None], Any] | None = None
    sinks: list[Any] = field(default_factory=list)
    retrySafety: str = "unknown"
    waitFor: list[dict[str, Any]] = field(default_factory=list)
    captureState: Callable[[], Any] | None = None
    restoreState: Callable[[Any], None] | None = None
    signature: AxSignature | None = None
    input: AxEventInputPlan | None = None
    wakeInput: AxEventInputPlan | None = None
    resumeInput: AxEventInputPlan | None = None


class AxEventInputError(ValueError): pass


def _event_plan(value):
    if callable(value): value = value(event_input())
    if isinstance(value, AxEventInputBuilder): value = value.build()
    if not isinstance(value, AxEventInputPlan): raise AxEventInputError("Event input mapping did not produce a plan")
    return value


def _event_validate_signature_value(field, value):
    kind = field.type.name
    values = value if field.type.is_array else [value]
    if field.type.is_array and not isinstance(value, list): raise AxEventInputError(f"Signature input {field.name} failed validation")
    for item in values:
        valid = (kind in {"string", "url", "date", "datetime", "code", "file", "image", "audio", "class"} and isinstance(item, str)) or (kind == "number" and isinstance(item, (int, float)) and not isinstance(item, bool)) or (kind == "boolean" and isinstance(item, bool)) or (kind in {"object", "json", "dateRange", "datetimeRange"} and isinstance(item, (dict, list)))
        if not valid: raise AxEventInputError(f"Signature input {field.name} failed validation")


def _event_map_target_input(target, event, continuation, action, identity_scope, trust):
    plan = (target.resumeInput if action == "resume" else target.wakeInput) or target.input
    if plan is None:
        mapped = target.mapInput(event, continuation) if target.mapInput else event.data
    else:
        if target.signature is None: raise AxEventInputError(f"Target {target.id} requires a signature for declarative input mapping")
        ingress = {"event": event.to_dict(), "identity": {"scope": identity_scope}, "trust": trust, "correlation": event.correlation}
        fields = [{"name": field.name, "optional": field.is_optional} for field in target.signature.get_input_fields()]
        result = event_map_input(ingress, plan.to_dict(), fields, vars(continuation) if continuation else None)
        if not result.get("ok"): raise AxEventInputError(str(result.get("error") or "Event input mapping failed"))
        mapped = result["value"]
    if target.signature is not None:
        signature_fields = target.signature.get_input_fields()
        descriptors = [{"name": field.name, "optional": field.is_optional} for field in signature_fields]
        normalized = event_normalize_input(mapped, descriptors)
        if not normalized.get("ok"):
            raise AxEventInputError(str(normalized.get("error") or "Event input normalization failed"))
        mapped = normalized["value"]
        for field in signature_fields:
            if field.name not in mapped:
                if not field.is_optional: raise AxEventInputError(f"Required signature input {field.name} was not present")
                continue
            _event_validate_signature_value(field, mapped[field.name])
    return mapped


class AxEventTargetBuilder:
    def __init__(self, id): self.value = {"id": id, "sinks": [], "waitFor": []}
    def signature(self, value): self.value["signature"] = value if isinstance(value, AxSignature) else AxSignature(value); return self
    def invoke(self, callback): self.value["invoke"] = callback; return self
    def program(self, program, client, signature=None):
        self.value["signature"] = signature or getattr(program, "signature", None)
        self.value["invoke"] = lambda input, _context: program.forward(client, input)
        return self
    def map_input(self, callback): self.value["mapInput"] = callback; return self
    def input(self, value): self.value["input"] = _event_plan(value); return self
    def wake_input(self, value): self.value["wakeInput"] = _event_plan(value); return self
    def resume_input(self, value): self.value["resumeInput"] = _event_plan(value); return self
    def sink(self, value): self.value["sinks"].append(value); return self
    def retry_safety(self, value): self.value["retrySafety"] = value; return self
    def wait_for(self, kind, path, **options): self.value["waitFor"].append({"kind": kind, "value": path.to_dict(), **options}); return self
    def build(self):
        if "invoke" not in self.value: raise ValueError("Event target requires an invoker or program")
        plans = [self.value.get(name) for name in ("input", "wakeInput", "resumeInput") if self.value.get(name) is not None]
        if plans and self.value.get("mapInput") is not None: raise ValueError("Declarative mappings and mapInput are mutually exclusive")
        if plans and self.value.get("signature") is None: raise ValueError("Declarative event mappings require a signature")
        return AxEventTarget(**self.value)


def event_target(id): return AxEventTargetBuilder(id)


class AxEventRouteBuilder:
    def __init__(self, id): self.id = id; self.match = {}; self.auth = False; self.instance = None; self.action = None; self.target = None
    def types(self, *values): self.match["types"] = list(values); return self
    def sources(self, *values): self.match["sources"] = list(values); return self
    def authenticated(self): self.auth = True; return self
    def instance_key(self, path): self.instance = path; return self
    def wake(self, target): self.action = "wake"; self.target = target.id if isinstance(target, AxEventTarget) else str(target); return self
    def resume(self): self.action = "resume"; return self
    def observe(self): self.action = "observe"; return self
    def invalidate(self): self.action = "invalidate"; return self
    def build(self):
        if self.action is None: raise ValueError("Event route requires one action")
        return AxEventRoute(self.id, self.action, dict(self.match), self.target, self.auth, instanceKey=self.instance)


def event_route(id): return AxEventRouteBuilder(id)


class AxEventSource:
    def start(self, publish: Callable[[dict[str, Any]], Any]) -> Any:
        raise NotImplementedError


class AxEventSink:
    def write(self, output: Any, context: dict[str, Any]) -> None:
        raise NotImplementedError


class AxEventClock:
    def now(self) -> float:
        raise NotImplementedError

    def sleep(self, seconds: float, cancellation: AxEventCancellationToken | None = None) -> bool:
        raise NotImplementedError


class AxSystemEventClock(AxEventClock):
    def now(self) -> float: return time.time() * 1000
    def sleep(self, seconds, cancellation=None):
        if cancellation is not None and cancellation.cancelled: return False
        time.sleep(max(0.0, seconds))
        return cancellation is None or not cancellation.cancelled


class AxManualEventClock(AxEventClock):
    def __init__(self, now=0): self._now = float(now); self._condition = threading.Condition(); self._sleepers = 0
    def now(self):
        with self._condition: return self._now
    def advance(self, milliseconds):
        with self._condition:
            self._now += float(milliseconds); self._condition.notify_all()
    def wait_for_sleepers(self, count=1):
        with self._condition:
            while self._sleepers < count: self._condition.wait()
    def sleep(self, seconds, cancellation=None):
        target = self.now() + max(0.0, seconds) * 1000
        with self._condition:
            self._sleepers += 1; self._condition.notify_all()
            try:
                while self._now < target:
                    if cancellation is not None and cancellation.cancelled: return False
                    self._condition.wait()
            finally:
                self._sleepers -= 1
        return cancellation is None or not cancellation.cancelled


class AxEventStore:
    def enqueue(self, event: dict[str, Any], commands: list[dict[str, Any]]) -> None:
        raise NotImplementedError


class AxInMemoryEventStore(AxEventStore):
    """Volatile single-worker store used by generated packages."""
    def __init__(self, *, maxPending=10_000, maxQueuedBytes=64 * 1024 * 1024,
                 maxEnvelopeBytes=1024 * 1024, publishTimeoutMs=5_000,
                 clock=None):
        self.deliveries: dict[str, dict[str, Any]] = {}
        self.runs: dict[str, AxEventRun] = {}
        self.deadLetters: dict[str, AxEventDeadLetter] = {}
        self.continuations: dict[str, AxEventContinuation] = {}
        self.programState: dict[str, Any] = {}
        self.maxPending = int(maxPending)
        self.maxQueuedBytes = int(maxQueuedBytes)
        self.maxEnvelopeBytes = int(maxEnvelopeBytes)
        self.publishTimeoutMs = int(publishTimeoutMs)
        self.clock = clock or AxSystemEventClock()
        self.queuedBytes = 0
        self._sequence = 0
        self._capacity = threading.Condition()

    def enqueue(self, event, commands, available_at=None):
        raw = event.to_dict() if isinstance(event, AxEventEnvelope) else event
        envelope_size = len(json.dumps(raw, separators=(",", ":"), default=str).encode("utf-8"))
        if envelope_size > self.maxEnvelopeBytes:
            raise AxEventInputError(f"Event envelope exceeds {self.maxEnvelopeBytes} bytes")
        new_commands = [command for command in commands
                        if f"{command.routeId}:{event.id}" not in self.deliveries]
        required = envelope_size * len(new_commands)
        deadline = self.clock.now() + self.publishTimeoutMs
        while new_commands:
            with self._capacity:
                pending = sum(1 for value in self.deliveries.values() if value["status"] == "queued")
                if pending + len(new_commands) <= self.maxPending and self.queuedBytes + required <= self.maxQueuedBytes:
                    break
            remaining = deadline - self.clock.now()
            if remaining <= 0: raise RuntimeError("AxEventBackpressureError: event inbox capacity timed out")
            self.clock.sleep(min(remaining, 50) / 1000)
        with self._capacity:
            for command in new_commands:
                delivery_id = f"{command.routeId}:{event.id}"
                self._sequence += 1
                self.deliveries[delivery_id] = {"event": event, "command": command,
                    "status": "queued", "availableAt": self.clock.now() if available_at is None else available_at,
                    "sequence": self._sequence, "size": envelope_size, "attempt": 0}
                self.queuedBytes += envelope_size

    def release(self, delivery):
        with self._capacity:
            self.queuedBytes = max(0, self.queuedBytes - int(delivery.get("size", 0)))
            delivery["size"] = 0
            self._capacity.notify_all()

    def requeue(self, delivery, available_at):
        raw = delivery["event"].to_dict() if isinstance(delivery["event"], AxEventEnvelope) else delivery["event"]
        size = len(json.dumps(raw, separators=(",", ":"), default=str).encode("utf-8"))
        with self._capacity:
            delivery["size"] = size; delivery["status"] = "queued"; delivery["availableAt"] = available_at
            self.queuedBytes += size; self._capacity.notify_all()


class AxPushEventSource(AxEventSource):
    def __init__(self, id="push"): self.id = id; self._publish = None
    def start(self, publish): self._publish = publish; return self
    def publish(self, event, **options):
        if self._publish is None: raise RuntimeError("AxPushEventSource is not started")
        return self._publish(event, **options)
    def close(self): self._publish = None


class AxEventRuntime:
    """Deterministic inline single-worker runtime; no background thread is hidden."""

    def __init__(self, routes: list[AxEventRoute], options: dict[str, Any] | None = None):
        self.routes = list(routes)
        self.options = dict(options or {})
        configured_targets = self.options.get("targets") or {}
        self.targets = ({target.id: target for target in configured_targets}
                        if isinstance(configured_targets, (list, tuple)) else dict(configured_targets))
        self.sources = list(self.options.get("sources") or [])
        self.clock = self.options.get("clock") or AxSystemEventClock()
        self.store = self.options.get("store") or AxInMemoryEventStore(
            maxPending=self.options.get("maxPending", 10_000),
            maxQueuedBytes=self.options.get("maxQueuedBytes", 64 * 1024 * 1024),
            maxEnvelopeBytes=self.options.get("maxEnvelopeBytes", 1024 * 1024),
            publishTimeoutMs=self.options.get("publishTimeoutMs", 5_000), clock=self.clock)
        self.max_attempts = int(self.options.get("maxAttempts", 3))
        self.retry_backoff_ms = int(self.options.get("retryBackoffMs", 1_000))
        self.started = False
        self.closed = False
        self._active: dict[str, AxEventCancellationToken] = {}
        self.descriptor = event_runtime_descriptor(
            [route.to_dict() for route in self.routes], self.options
        )

    def start(self):
        if self.closed: raise RuntimeError("AxEventRuntime is closed")
        if self.started: return self
        self.started = True
        for source in self.sources:
            source.start(self.publish)
        return self

    def plan(
        self,
        event: AxEventEnvelope | dict[str, Any],
        *,
        identity_scope: str = "anonymous",
        trust: str = "untrusted",
    ) -> list[AxEventCommand]:
        envelope = event.to_dict() if isinstance(event, AxEventEnvelope) else dict(event)
        values = event_route_commands(
            envelope,
            [route.to_dict() for route in self.routes],
            identity_scope,
            trust,
        )
        commands = [AxEventCommand(**value) for value in values]
        ingress = {"event": envelope, "identity": {"scope": identity_scope}, "trust": trust,
                   "correlation": envelope.get("correlation") or []}
        routes = {route.id: route for route in self.routes}
        for command in commands:
            route = routes[command.routeId]
            if route.instanceKey is not None:
                resolved = event_resolve_path(ingress, route.instanceKey.to_dict(), None)
                if resolved is None: raise AxEventInputError(f"Route {route.id} instance key was not present")
                object.__setattr__(command, "instanceKey", str(resolved))
        return commands

    def publish(
        self,
        event: AxEventEnvelope | dict[str, Any],
        *,
        identity_scope: str = "anonymous",
        trust: str = "untrusted",
    ) -> AxEventPublishReceipt:
        if not self.started: raise RuntimeError("AxEventRuntime must be started first")
        envelope = event if isinstance(event, AxEventEnvelope) else AxEventEnvelope(
            str(event.get("id", "")), str(event.get("source", "")), str(event.get("type", "")),
            event.get("data"), event.get("subject"), str(event.get("specversion", "1.0")),
            dict(event.get("extensions") or {}), list(event.get("correlation") or []))
        commands = self.plan(envelope, identity_scope=identity_scope, trust=trust)
        delivery_ids = [f"{command.routeId}:{envelope.id}" for command in commands]
        duplicate = bool(delivery_ids) and all(delivery_id in self.store.deliveries for delivery_id in delivery_ids)
        routes = {route.id: route for route in self.routes}
        now = self.clock.now()
        for command in commands:
            route = routes[command.routeId]
            if route.debounceMs > 0:
                for existing in self.store.deliveries.values():
                    old = existing["command"]
                    if (existing["status"] == "queued" and old.routeId == command.routeId and
                            old.targetId == command.targetId and old.instanceKey == command.instanceKey):
                        existing["status"] = "coalesced"; self.store.release(existing)
        for command in commands:
            self.store.enqueue(envelope, [command], now + routes[command.routeId].debounceMs)
        for delivery_id in delivery_ids:
            self.store.deliveries[delivery_id]["identityScope"] = identity_scope
            self.store.deliveries[delivery_id]["trust"] = trust
        if not duplicate: self.run_due()
        return AxEventPublishReceipt(envelope.id, True, duplicate, "volatile", delivery_ids)

    def next_due_at(self):
        values = [value.get("availableAt", 0) for value in self.store.deliveries.values()
                  if value["status"] == "queued"]
        return min(values) if values else None

    def run_due(self):
        processed = 0
        while True:
            due = [(key, value) for key, value in self.store.deliveries.items()
                   if value["status"] == "queued" and value.get("availableAt", 0) <= self.clock.now()
                   and self._strict_delivery_eligible(value)]
            if not due: return processed
            due.sort(key=lambda item: (item[1].get("availableAt", 0), item[1].get("sequence", 0)))
            _, delivery = due[0]
            delivery["status"] = "running"; self.store.release(delivery)
            self._dispatch(delivery["event"], delivery["command"],
                           delivery.get("identityScope", "anonymous"), delivery.get("trust", "untrusted"))
            processed += 1

    def _strict_delivery_eligible(self, candidate):
        routes = {route.id: route for route in self.routes}
        def descriptor(delivery):
            command = delivery["command"]
            route = routes.get(command.routeId)
            return {"sequence": delivery.get("sequence", 0),
                    "targetId": command.targetId or "", "instanceKey": command.instanceKey,
                    "status": delivery.get("status", "queued"),
                    "ordering": route.ordering if route is not None else "strict"}
        return bool(event_strict_delivery_eligible(
            descriptor(candidate), [descriptor(value) for value in self.store.deliveries.values()]))

    def _dispatch(self, event, command, identity_scope, trust="untrusted"):
        delivery_id = f"{command.routeId}:{event.id}"
        delivery = self.store.deliveries[delivery_id]
        continuation = None
        target_id = command.targetId
        if command.action == "resume":
            continuation = self._find_continuation(event.correlation, identity_scope)
            if continuation is None:
                self._dead_letter(delivery_id, None, "continuation_not_found")
                return
            target_id = continuation.targetId
        if command.action in ("observe", "invalidate"):
            delivery["status"] = "succeeded"
            return
        target = self.targets.get(target_id)
        if target is None:
            self._dead_letter(delivery_id, None, f"unknown_target:{target_id}")
            return
        run_id = delivery.get("runId") or f"run:{delivery_id}:{len(self.store.runs)+1}"
        run = self.store.runs.get(run_id) or AxEventRun(run_id, delivery_id, command.routeId, target.id, command.instanceKey)
        self.store.runs[run_id] = run; delivery["runId"] = run_id
        token = AxEventCancellationToken()
        self._active[run_id] = token
        state_key = f"{target.id}\n{identity_scope}\n{command.instanceKey}"
        if target.restoreState and state_key in self.store.programState:
            target.restoreState(self.store.programState[state_key])
        try:
            try:
                mapped = _event_map_target_input(target, event, continuation, command.action, identity_scope, trust)
            except Exception as error:
                raise AxEventInputError(str(error)) from error
            attempt = int(delivery.get("attempt", 0)) + 1
            delivery["attempt"] = attempt
            run.attempt = attempt; run.status = "running"
            try:
                output = target.invoke(mapped, {"runId": run_id, "deliveryId": delivery_id,
                    "instanceKey": command.instanceKey, "identityScope": identity_scope,
                    "idempotencyKey": command.idempotencyKey, "cancellation": token,
                    "continuation": continuation})
                if token.cancelled:
                    run.status = "cancelled"; delivery["status"] = "cancelled"; return
                if target.captureState: self.store.programState[state_key] = target.captureState()
                run.output = output
                registrations = self._register_declared(target, event, command, identity_scope)
                if registrations:
                    run.continuationIds = registrations; run.status = "waiting_event"; delivery["status"] = "waiting_event"
                else:
                    run.status = "succeeded"; delivery["status"] = "succeeded"
                    # The run, including output, is already in the store before sinks execute.
                    for sink in target.sinks:
                        try: sink.write(output, {"run": run, "idempotencyKey": f"{run_id}:{getattr(sink, 'id', 'sink')}"})
                        except Exception as error:
                            self._dead_letter(delivery_id, run_id, str(error), getattr(sink, "id", "sink"))
                if continuation: continuation.completed = True
                return
            except Exception as error:
                if attempt < self.max_attempts and target.retrySafety == "idempotent":
                    run.status = "queued"; self.store.requeue(delivery, self.clock.now() + self.retry_backoff_ms * (2 ** (attempt - 1))); return
                run.status = "outcome_unknown" if target.retrySafety != "idempotent" else "failed"
                run.error = str(error); delivery["status"] = run.status
                self._dead_letter(delivery_id, run_id, str(error)); return
        except AxEventInputError as error:
            run.status = "failed"; run.error = f"event_input_invalid:{error}"; delivery["status"] = "dead_lettered"
            self._dead_letter(delivery_id, run_id, run.error)
        finally:
            self._active.pop(run_id, None)

    def _register_declared(self, target, event, command, identity_scope):
        ids = []
        for declaration in target.waitFor:
            raw = declaration.get("value")
            if isinstance(raw, dict) and "root" in raw:
                value = event_resolve_path({"event": event.to_dict(), "identity": {"scope": identity_scope}, "correlation": event.correlation}, raw, None)
            else:
                value = raw(event) if callable(raw) else (event.data or {}).get(raw) if isinstance(raw, str) and isinstance(event.data, dict) else raw
            if value is None: raise AxEventInputError("continuation value is missing")
            continuation_id = f"continuation:{target.id}:{len(self.store.continuations)+1}"
            metadata = declaration.get("metadata") or {}
            if callable(metadata): metadata = metadata(event)
            expires = declaration.get("expiresInMs")
            self.store.continuations[continuation_id] = AxEventContinuation(
                continuation_id, target.id, command.instanceKey, identity_scope,
                [{"kind": str(declaration["kind"]), "value": str(value)}], dict(metadata),
                False, self.clock.now() + float(expires) if expires is not None else None)
            ids.append(continuation_id)
        return ids

    def _find_continuation(self, correlation, identity_scope):
        for continuation in self.store.continuations.values():
            if (continuation.completed or continuation.identityScope != identity_scope or
                    (continuation.expiresAt is not None and continuation.expiresAt <= self.clock.now())): continue
            for key in correlation or []:
                if key in continuation.correlation: return continuation
        return None

    def _dead_letter(self, delivery_id, run_id, reason, sink_id=None):
        value = AxEventDeadLetter(f"dead:{len(self.store.deadLetters)+1}", delivery_id, reason, run_id, sink_id)
        self.store.deadLetters[value.id] = value
        if sink_id is None and delivery_id in self.store.deliveries:
            self.store.deliveries[delivery_id]["status"] = "dead_lettered"

    def cancel_run(self, run_id, reason="cancelled"):
        token = self._active.get(run_id)
        if token is None: return False
        token.cancel(reason); return True

    def get_run(self, run_id): return self.store.runs.get(run_id)
    def list_dead_letters(self): return list(self.store.deadLetters.values())
    def redrive(self, dead_letter_id):
        dead = self.store.deadLetters.pop(dead_letter_id)
        delivery = self.store.deliveries[dead.deliveryId]
        if dead.sinkId is not None:
            run = self.store.runs.get(dead.runId)
            target = self.targets.get(run.targetId if run else None)
            sink = next((value for value in (target.sinks if target else [])
                         if getattr(value, "id", "sink") == dead.sinkId), None)
            if run is None or target is None or sink is None:
                self.store.deadLetters[dead.id] = dead
                raise RuntimeError("sink redrive state is unavailable")
            try:
                sink.write(run.output, {"run": run, "idempotencyKey": f"{run.id}:{dead.sinkId}"})
            except Exception:
                self.store.deadLetters[dead.id] = dead
                raise
            return
        delivery["attempt"] = 0
        self.store.requeue(delivery, self.clock.now())
        self.run_due()

    def close(self):
        for source in self.sources:
            close = getattr(source, "close", None)
            if callable(close): close()
        self.started = False; self.closed = True

    @staticmethod
    def normalize_mcp(namespace: str, method: str, params: Any) -> dict[str, Any]:
        return event_normalize_mcp(namespace, method, params)


class AxMCPTransport:
    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def send_notification(self, message: dict[str, Any]) -> None:
        raise NotImplementedError

    def send_with_headers(self, message: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
        return self.send(message)

    def send_response(self, message: dict[str, Any]) -> None:
        self.send_notification(message)

    def set_message_handler(self, handler: Callable[[dict[str, Any]], None]) -> None:
        self._message_handler = handler

    def set_protocol_version(self, protocol_version: str) -> None:
        self.protocol_version = protocol_version

    def set_era(self, era: str) -> None:
        return None

    @property
    def era_hint(self) -> str | None:
        return None

    @property
    def era_cache_key(self) -> str | None:
        return None

    def connect(self) -> None:
        return None

    def set_lifecycle_handler(self, handler: Callable[[str], None]) -> None:
        self._lifecycle_handler = handler

    def start_listening(self) -> None:
        return None

    def open_request_stream(self, message: dict[str, Any]) -> None:
        raise AxMCPError("Request streams are only available for modern MCP")

    def close_request_stream(self) -> None:
        return None

    def close(self) -> None:
        return None


class AxMCPScriptedTransport(AxMCPTransport):
    def __init__(self, responses: list[dict[str, Any]] | None = None):
        self.responses = list(responses or [])
        self.requests: list[dict[str, Any]] = []
        self.notifications: list[dict[str, Any]] = []
        self.sent_responses: list[dict[str, Any]] = []
        self.request_headers: list[dict[str, str]] = []
        self.request_streams: list[dict[str, Any]] = []
        self.era: str | None = None
        self.protocol_version: str | None = None
        self.session_id: str | None = None
        self._message_handler: Callable[[dict[str, Any]], None] | None = None

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        self.requests.append(json.loads(json.dumps(message)))
        method = message.get("method")
        match_index = None
        for index, response in enumerate(self.responses):
            if response.get("method", method) == method:
                match_index = index
                break
        raw = self.responses.pop(match_index) if match_index is not None else {"result": {}}
        headers = raw.get("headers") or raw.get("responseHeaders") or {}
        if headers.get("MCP-Session-Id"):
            self.session_id = headers["MCP-Session-Id"]
        if "error" in raw:
            return {"jsonrpc": "2.0", "id": message.get("id"), "error": raw["error"]}
        return {
            "jsonrpc": "2.0",
            "id": message.get("id"),
            "result": raw.get("result", {}),
        }

    def send_with_headers(self, message: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
        self.request_headers.append(dict(headers or {}))
        return self.send(message)

    def send_notification(self, message: dict[str, Any]) -> None:
        self.notifications.append(json.loads(json.dumps(message)))

    def set_era(self, era: str) -> None:
        self.era = era

    def send_response(self, message: dict[str, Any]) -> None:
        self.sent_responses.append(json.loads(json.dumps(message)))

    def emit(self, message: dict[str, Any]) -> None:
        if self._message_handler:
            self._message_handler(message)

    def open_request_stream(self, message: dict[str, Any]) -> None:
        if self.era != "modern":
            raise AxMCPError("Request streams are only available for modern MCP")
        request = json.loads(json.dumps(message))
        self.request_streams.append(request)
        self.emit({
            "jsonrpc": "2.0",
            "method": "notifications/subscriptions/acknowledged",
            "params": {
                "notifications": (request.get("params") or {}).get("notifications") or {},
                "_meta": {"io.modelcontextprotocol/subscriptionId": request.get("id")},
            },
        })


_AX_MCP_ERA_CACHE: dict[str, str] = {}


class AxMCPClient:
    def __init__(self, transport: AxMCPTransport, options: dict[str, Any] | None = None):
        self.transport = transport
        self.options = options or {}
        self.server_capabilities: dict[str, Any] = {}
        self.server_info: dict[str, Any] | None = None
        self.server_instructions: str | None = None
        self.negotiated_protocol_version: str | None = None
        self.era: str | None = None
        self.discover_result: dict[str, Any] | None = None
        self.negotiated_extensions: dict[str, Any] = {}
        self.tools: list[dict[str, Any]] = []
        self.prompts: list[dict[str, Any]] = []
        self.resources: list[dict[str, Any]] = []
        self.resource_templates: list[dict[str, Any]] = []
        self.catalog_cache: dict[str, dict[str, Any]] = {}
        self._resource_read_cache: dict[str, dict[str, Any]] = {}
        self.catalog_revision = 0
        self._subscription_owners: dict[str, set[str]] = {}
        self._active_subscription_id: str | None = None
        self._subscription_ready = threading.Event()
        self._next_id = 1
        self._notification_listeners: list[Callable[[dict[str, Any]], None]] = []
        self._lifecycle_listeners: list[Callable[[str], None]] = []
        self._initialized = False
        self.transport.set_message_handler(self._handle_inbound_message)
        self.transport.set_lifecycle_handler(self.emit_lifecycle)

    def init(self) -> None:
        if self._initialized:
            return
        self.transport.connect()
        configured = str(self.options.get("era", "auto"))
        key = self.transport.era_cache_key
        stored = None
        era_store = self.options.get("eraStore")
        if isinstance(era_store, dict) and key:
            stored = era_store.get(key)
        resolution = mcp_resolve_known_era(configured, self.transport.era_hint, _AX_MCP_ERA_CACHE.get(key or ""), stored)
        resolved = str(resolution.get("era", "modern"))
        if not resolution.get("probe"):
            if resolved == "legacy":
                self._initialize_legacy()
            else:
                self._apply_era("modern")
                self._apply_discovery(self._request_discovery())
                self.refresh()
            self._remember_era(resolved)
            self._initialized = True
            if resolved == "legacy":
                self.transport.start_listening()
            return
        self._apply_era("modern")
        try:
            self._apply_discovery(self._request_discovery())
        except AxMCPError as error:
            if error.code == -32022:
                raise
            self._initialize_legacy()
            self._remember_era("legacy")
            self._initialized = True
            self.transport.start_listening()
            return
        except Exception:
            self._initialize_legacy()
            self._remember_era("legacy")
            self._initialized = True
            self.transport.start_listening()
            return
        self._remember_era("modern")
        self.refresh()
        self._initialized = True

    def _initialize_legacy(self) -> None:
        self._apply_era("legacy")
        protocol_version = self.options.get("protocolVersion", AX_MCP_PROTOCOL_VERSION)
        result = self._request(
            "initialize",
            {
                "protocolVersion": protocol_version,
                "capabilities": self._client_capabilities(),
                "clientInfo": {
                    "name": "AxMCPClient",
                    "title": "Ax MCP Client",
                    "version": "1.0.0",
                    **(self.options.get("clientInfo") or {}),
                },
            },
        )
        supported = self.options.get("supportedProtocolVersions") or AX_MCP_SUPPORTED_PROTOCOL_VERSIONS
        negotiated = result.get("protocolVersion")
        if negotiated not in supported:
            raise AxMCPError(f"Unsupported MCP protocol version {negotiated}")
        self.negotiated_protocol_version = negotiated
        self.transport.set_protocol_version(negotiated)
        self.server_capabilities = result.get("capabilities") or {}
        self.server_info = result.get("serverInfo") or {}
        self.server_instructions = result.get("instructions")
        self._negotiate_extensions()
        self.notify("notifications/initialized")
        self.refresh()

    def _apply_era(self, era: str) -> None:
        self.era = era
        self.transport.set_era(era)
        if era == "modern":
            self.negotiated_protocol_version = "2026-07-28"
            self.transport.set_protocol_version("2026-07-28")
        else:
            self.negotiated_protocol_version = None

    def _remember_era(self, era: str) -> None:
        key = self.transport.era_cache_key
        if not key:
            return
        _AX_MCP_ERA_CACHE[key] = era
        era_store = self.options.get("eraStore")
        if isinstance(era_store, dict):
            era_store[key] = era

    def _request_discovery(self) -> dict[str, Any]:
        return self._request("server/discover", {})

    def _apply_discovery(self, result: dict[str, Any]) -> None:
        classified = mcp_classify_discovery_result(result)
        if not classified.get("valid"):
            raise AxMCPError("Invalid MCP server/discover result")
        self.discover_result = json.loads(json.dumps(result))
        self.server_capabilities = json.loads(json.dumps(classified.get("capabilities") or {}))
        self.server_instructions = result.get("instructions")
        if isinstance(classified.get("serverInfo"), dict):
            self.server_info = dict(classified["serverInfo"])
        self._negotiate_extensions()

    def _negotiate_extensions(self) -> None:
        client_ext = (self._client_capabilities().get("extensions") or {})
        server_ext = (self.server_capabilities.get("extensions") or {})
        self.negotiated_extensions = mcp_negotiate_extensions(client_ext, server_ext)

    def get_era(self) -> str | None:
        return self.era

    def discover(self) -> dict[str, Any]:
        self.init()
        if self.era != "modern":
            raise AxMCPError("server/discover is only available for modern MCP")
        result = self._request_discovery()
        self._apply_discovery(result)
        return json.loads(json.dumps(result))

    def close(self) -> None:
        self._active_subscription_id = None
        self.transport.close_request_stream()
        self._subscription_owners.clear()
        self.catalog_cache.clear()
        self._resource_read_cache.clear()
        self._initialized = False
        self.transport.close()

    def refresh(self, *, force: bool = True) -> None:
        changed = False
        if self._capability("tools") and (force or not self._catalog_cache_fresh("tools")):
            raw_tools = self._collect_catalog("tools/list", "tools")
            self.tools = []
            for tool in raw_tools:
                try:
                    mcp_param_header_bindings(tool.get("inputSchema") or {})
                    self.tools.append(tool)
                except Exception:
                    logger = self.options.get("logger")
                    if callable(logger):
                        logger(f"Warning: excluded MCP tool {tool.get('name', '')}: invalid x-mcp-header annotation")
            changed = True
        if self._capability("prompts") and (force or not self._catalog_cache_fresh("prompts")):
            self.prompts = self._collect_catalog("prompts/list", "prompts")
            changed = True
        if self._capability("resources"):
            if force or not self._catalog_cache_fresh("resources"):
                self.resources = self._collect_catalog("resources/list", "resources")
                changed = True
            if force or not self._catalog_cache_fresh("resourceTemplates"):
                self.resource_templates = self._collect_catalog("resources/templates/list", "resourceTemplates")
                changed = True
        if changed:
            self.catalog_revision += 1

    def _collect_catalog(self, method: str, field: str) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        pages: list[dict[str, Any]] = []
        cursor = None
        seen: set[str] = set()
        max_pages = int(self.options.get("maxPaginationPages", 1000))
        for _page in range(max_pages):
            result = self._request(method, {"cursor": cursor} if cursor else {})
            pages.append(result)
            values.extend(json.loads(json.dumps(result.get(field) or [])))
            cursor = result.get("nextCursor")
            if not cursor:
                cache_name = {"tools/list": "tools", "prompts/list": "prompts", "resources/list": "resources", "resources/templates/list": "resourceTemplates"}.get(method)
                if cache_name:
                    self.catalog_cache[cache_name] = mcp_fold_cache_info(pages, int(time.time() * 1000))
                return values
            if cursor in seen: raise AxMCPError(f"MCP {method} repeated pagination cursor {cursor}")
            seen.add(cursor)
        raise AxMCPError(f"MCP {method} exceeded {max_pages} pagination pages")

    def _catalog_cache_fresh(self, name: str) -> bool:
        return mcp_cache_freshness(self.catalog_cache.get(name), int(time.time() * 1000))

    def inspect_catalog(self, *, refresh: bool = False) -> dict[str, Any]:
        self.init()
        if refresh: self.refresh()
        return json.loads(json.dumps({
            "namespace": self.namespace(), "protocolVersion": self.negotiated_protocol_version,
            "revision": self.catalog_revision, "serverInfo": self.server_info,
            "serverCapabilities": self.server_capabilities, "tools": self.tools,
            "prompts": self.prompts, "resources": self.resources,
            "resourceTemplates": self.resource_templates,
            "subscriptions": sorted(self._subscription_owners),
        }))

    def ping(self) -> dict[str, Any]:
        return self._request("ping", {})

    def list_tools(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._request("tools/list", params)

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        args = arguments or {}
        headers: dict[str, str] = {}
        if self.era == "modern":
            tool = next((item for item in self.tools if item.get("name") == name), None)
            if tool:
                bindings = mcp_param_header_bindings(tool.get("inputSchema") or {})
                headers = {str(key): str(value) for key, value in mcp_param_header_values(bindings, args).items()}
        try:
            result = self._request_with_input_rounds("tools/call", {"name": name, "arguments": args}, extra_headers=headers)
        except AxMCPError as error:
            if self.era != "modern" or error.code != -32020:
                raise
            raw_tools = self._collect_catalog("tools/list", "tools")
            self.tools = []
            for tool in raw_tools:
                try:
                    mcp_param_header_bindings(tool.get("inputSchema") or {})
                    self.tools.append(tool)
                except Exception:
                    pass
            tool = next((item for item in self.tools if item.get("name") == name), None)
            bindings = mcp_param_header_bindings((tool or {}).get("inputSchema") or {})
            headers = {str(key): str(value) for key, value in mcp_param_header_values(bindings, args).items()}
            result = self._request_with_input_rounds("tools/call", {"name": name, "arguments": args}, extra_headers=headers)
        if result.get("resultType") != "task":
            return result
        if not self._has_tasks_capability():
            raise AxMCPError("MCP protocol violation: server returned a task without negotiating io.modelcontextprotocol/tasks")
        if not mcp_validate_modern_task(result):
            raise AxMCPError("MCP protocol violation: invalid CreateTaskResult")
        return self._await_modern_task(str(result["taskId"]))

    def _await_modern_task(self, task_id: str) -> dict[str, Any]:
        max_polls = int(self.options.get("maxTaskPolls", 1000))
        for _ in range(max_polls):
            task = self.get_task(task_id)
            outcome = mcp_task_terminal_outcome(task)
            kind = outcome.get("kind")
            if kind == "result":
                return json.loads(json.dumps(outcome.get("result")))
            if kind == "protocol_error":
                raise AxMCPError(str(outcome.get("message", "MCP task failed")), code=int(outcome.get("code", 0)), data=outcome.get("data"))
            if kind in {"violation", "failure", "cancelled"}:
                raise AxMCPError(str(outcome.get("message", "MCP task failed")))
        raise AxMCPError(f"MCP task {task_id} exceeded {max_polls} polls")

    def list_prompts(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("prompts/list", {"cursor": cursor} if cursor else {})

    def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request_with_input_rounds("prompts/get", {"name": name, "arguments": arguments or {}})

    def list_resources(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("resources/list", {"cursor": cursor} if cursor else {})

    def read_resource(self, uri: str) -> dict[str, Any]:
        if self.era == "modern" and self.options.get("readCache"):
            cached = self._resource_read_cache.get(uri)
            if cached and mcp_cache_freshness(cached.get("cache"), int(time.time() * 1000)):
                return json.loads(json.dumps(cached["result"]))
            self._resource_read_cache.pop(uri, None)
        result = self._request_with_input_rounds("resources/read", {"uri": uri})
        if self.era == "modern" and self.options.get("readCache"):
            cache = mcp_fold_cache_info([result], int(time.time() * 1000))
            if mcp_cache_freshness(cache, int(time.time() * 1000)):
                self._resource_read_cache[uri] = {"result": json.loads(json.dumps(result)), "cache": cache}
        return result

    def subscribe_resource(self, uri: str) -> dict[str, Any]:
        return self.acquire_resource_subscription(uri, "manual")

    def unsubscribe_resource(self, uri: str) -> dict[str, Any]:
        return self.release_resource_subscription(uri, "manual")

    def acquire_resource_subscription(self, uri: str, owner: str) -> dict[str, Any]:
        self._assert_resource_subscriptions()
        transition = mcp_resource_subscription_ownership(
            sorted(self._subscription_owners.get(uri, set())), owner, "acquire"
        )
        self._subscription_owners[uri] = set(transition["owners"])
        if self.era == "modern":
            result = {}
            if transition.get("changed") and self._active_subscription_id is not None:
                self._restart_modern_listener()
        else:
            result = self._request("resources/subscribe", {"uri": uri}) if transition["wireAction"] == "subscribe" else {}
        return result

    def release_resource_subscription(self, uri: str, owner: str) -> dict[str, Any]:
        self._assert_resource_subscriptions()
        transition = mcp_resource_subscription_ownership(
            sorted(self._subscription_owners.get(uri, set())), owner, "release"
        )
        if transition["owners"]: self._subscription_owners[uri] = set(transition["owners"])
        else: self._subscription_owners.pop(uri, None)
        if self.era == "modern":
            result = {}
            if transition.get("changed") and self._active_subscription_id is not None:
                self._restart_modern_listener()
        else:
            result = self._request("resources/unsubscribe", {"uri": uri}) if transition["wireAction"] == "unsubscribe" else {}
        return result

    def restore_resource_subscriptions(self) -> None:
        if self.era == "modern":
            if self._active_subscription_id is not None:
                self._restart_modern_listener()
            return
        for uri in sorted(self._subscription_owners):
            self._request("resources/subscribe", {"uri": uri})

    def start_listening(self) -> None:
        self.init()
        if self.era != "modern":
            self.transport.start_listening()
            return
        self.transport.close_request_stream()
        subscription_id = str(uuid.uuid4())
        self._active_subscription_id = subscription_id
        self._subscription_ready.clear()
        notifications = mcp_listen_interests(
            sorted(self._subscription_owners), self.options.get("subscriptionFilters") or {}
        )
        params = {"notifications": notifications}
        params["_meta"] = mcp_build_request_meta(
            {}, self.negotiated_protocol_version or "2026-07-28",
            self._client_capabilities(),
            {"name": "AxMCPClient", "title": "Ax MCP Client", "version": "1.0.0"},
            self.options.get("logLevel"), None, None,
        )
        self.transport.open_request_stream({
            "jsonrpc": "2.0", "id": subscription_id,
            "method": "subscriptions/listen", "params": params,
        })
        timeout = float(self.options.get("listenAckTimeout", 2))
        if not self._subscription_ready.wait(timeout):
            raise AxMCPError("subscriptions/listen acknowledgement timed out")

    def _restart_modern_listener(self) -> None:
        if self.era != "modern" or self._active_subscription_id is None:
            return
        self.start_listening()

    def _assert_resource_subscriptions(self) -> None:
        resources = self.server_capabilities.get("resources")
        if not isinstance(resources, dict) or not resources.get("subscribe"):
            raise AxMCPError("Resource subscriptions are not supported")

    def get_task(self, task_id: str) -> dict[str, Any]:
        if not self._has_tasks_capability():
            raise AxMCPError("Tasks are not supported")
        result = self._request("tasks/get", {"taskId": task_id})
        if self.era == "modern" and not mcp_validate_modern_task(result):
            raise AxMCPError("MCP protocol violation: invalid tasks/get result")
        return result

    def cancel_task(self, task_id: str) -> dict[str, Any]:
        if not self._has_tasks_capability():
            raise AxMCPError("Tasks are not supported")
        result = self._request("tasks/cancel", {"taskId": task_id})
        return {} if self.era == "modern" else result

    def list_tasks(self, cursor: str | None = None) -> dict[str, Any]:
        if self.era == "modern":
            raise AxMCPError("tasks/list is only available for legacy MCP tasks")
        if not self._has_tasks_capability():
            raise AxMCPError("Tasks are not supported")
        return self._request("tasks/list", {"cursor": cursor} if cursor else {})

    def get_task_result(self, task_id: str) -> dict[str, Any]:
        if self.era == "modern":
            raise AxMCPError("tasks/result is only available for legacy MCP tasks; modern results are embedded in tasks/get")
        if not self._has_tasks_capability():
            raise AxMCPError("Tasks are not supported")
        return self._request("tasks/result", {"taskId": task_id})

    def provide_task_input(self, task_id: str, input_responses: dict[str, Any]) -> None:
        if self.era != "modern" or not self._has_tasks_capability():
            raise AxMCPError("tasks/update is only available for modern MCP Tasks v2")
        self._request("tasks/update", {"taskId": task_id, "inputResponses": input_responses})

    def list_resource_templates(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("resources/templates/list", {"cursor": cursor} if cursor else {})

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        if self.era == "modern" and method in {"notifications/initialized", "notifications/roots/list_changed", "notifications/cancelled"}:
            return
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self.transport.send_notification(message)

    def cancel_request(self, request_id: str | int, reason: str | None = None) -> None:
        params: dict[str, Any] = {"requestId": request_id}
        if reason:
            params["reason"] = reason
        self.notify("notifications/cancelled", params)

    def to_function(self) -> list[Tool]:
        out: list[Tool] = []
        for tool in self.tools:
            out.append(self._tool_to_function(tool))
        for prompt in self.prompts:
            out.append(self._prompt_to_function(prompt))
        for resource in self.resources:
            out.append(self._resource_to_function(resource))
        for template in self.resource_templates:
            out.append(self._resource_template_to_function(template))
        return out

    def native_tools(self) -> list[Tool]:
        out: list[Tool] = []
        for tool in self.tools:
            original = tool.get("name", "")
            name = _override_name(original, self.options)
            out.append(Tool(
                name,
                _override_description(tool, self.options),
                tool.get("inputSchema") or {"type": "object", "properties": {}},
                lambda args, original=original: self.call_tool(original, args),
            ))
        return out

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Send any negotiated MCP method without converting it into a function."""
        return self._request(method, params)

    def add_notification_listener(self, listener: Callable[[dict[str, Any]], None]):
        self._notification_listeners.append(listener)
        def remove():
            if listener in self._notification_listeners:
                self._notification_listeners.remove(listener)
        return remove

    def add_lifecycle_listener(self, listener: Callable[[str], None]):
        self._lifecycle_listeners.append(listener)
        def remove():
            if listener in self._lifecycle_listeners:
                self._lifecycle_listeners.remove(listener)
        return remove

    def emit_lifecycle(self, state: str) -> None:
        if self.era == "modern" and state == "disconnected" and self._active_subscription_id is not None:
            self._restart_modern_listener()
        elif state == "reconnected":
            self.restore_resource_subscriptions()
        for listener in list(self._lifecycle_listeners):
            listener(state)

    def namespace(self) -> str:
        return str(self.options.get("namespace") or (self.server_info or {}).get("name") or "mcp")

    def _request_with_input_rounds(self, method: str, base_params: dict[str, Any], *, extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
        params = json.loads(json.dumps(base_params))
        max_rounds = self.options.get("maxInputRounds")
        round_index = 0
        while True:
            result = self._request(method, params, extra_headers=extra_headers)
            plan = mcp_mrtr_plan_round(result, self.era or "legacy", method, round_index, max_rounds)
            action = plan.get("action")
            if action == "complete":
                return result
            if action == "violation":
                raise AxMCPError(str(plan.get("message", "MCP protocol violation")))
            input_responses = None
            requests = plan.get("inputRequests")
            if plan.get("hasInputRequests") and isinstance(requests, dict):
                roots = self.options.get("roots") if "roots" in self.options else None
                fulfillment = mcp_mrtr_fulfill_roots(requests, roots)
                if not fulfillment.get("ok"):
                    raise AxMCPError(str(fulfillment.get("message", "MCP protocol violation")))
                input_responses = fulfillment.get("responses")
            request_state = plan.get("requestState") if plan.get("hasRequestState") else None
            params = mcp_mrtr_next_params(base_params, input_responses, request_state)
            round_index += 1

    def _request(self, method: str, params: dict[str, Any] | None = None, *, extra_headers: dict[str, str] | None = None, allow_version_retry: bool = True) -> dict[str, Any]:
        request_id = str(self._next_id)
        self._next_id += 1
        message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        request_params = dict(params or {})
        if self.era == "modern":
            existing = request_params.get("_meta") if isinstance(request_params.get("_meta"), dict) else {}
            request_params["_meta"] = mcp_build_request_meta(
                existing,
                self.negotiated_protocol_version or "2026-07-28",
                self._client_capabilities(),
                {"name": "AxMCPClient", "title": "Ax MCP Client", "version": "1.0.0", **(self.options.get("clientInfo") or {})},
                self.options.get("logLevel"),
                None,
                None,
            )
        if params is not None:
            message["params"] = request_params
        response = self.transport.send_with_headers(message, extra_headers or {})
        if "error" in response:
            error = response["error"] or {}
            protocol_error = AxMCPError(str(error.get("message", "MCP JSON-RPC error")), code=error.get("code"), data=error.get("data"))
            if self.era == "modern" and allow_version_retry and protocol_error.code == -32022:
                version = mcp_select_mutual_version(protocol_error.data or {}, self.options.get("supportedProtocolVersions") or AX_MCP_SUPPORTED_PROTOCOL_VERSIONS)
                if version:
                    self.negotiated_protocol_version = version
                    self.transport.set_protocol_version(version)
                    return self._request(method, params, extra_headers=extra_headers, allow_version_retry=False)
            raise protocol_error
        result = response.get("result") or {}
        if self.era == "modern" and isinstance(result, dict):
            classified = mcp_classify_discovery_result(result)
            meta = result.get("_meta") if isinstance(result.get("_meta"), dict) else {}
            server_info = classified.get("serverInfo")
            if not isinstance(server_info, dict):
                candidate = meta.get("io.modelcontextprotocol/serverInfo")
                if isinstance(candidate, dict) and isinstance(candidate.get("name"), str) and isinstance(candidate.get("version"), str):
                    server_info = candidate
            if isinstance(server_info, dict):
                self.server_info = dict(server_info)
        return result

    def _client_capabilities(self) -> dict[str, Any]:
        capabilities = dict(self.options.get("capabilities") or {})
        derived = mcp_client_capabilities(bool(self.options.get("roots")), bool(self.options.get("sampling")), bool(self.options.get("elicitation")), self.era or "legacy", self.options.get("tasksExtension") is not False)
        for key, value in derived.items():
            capabilities.setdefault(key, value)
        return capabilities

    def _capability(self, name: str) -> bool:
        value = self.server_capabilities.get(name)
        return value is not None and value is not False

    def _has_tasks_capability(self) -> bool:
        if self.era == "modern":
            return "io.modelcontextprotocol/tasks" in self.negotiated_extensions
        return self._capability("tasks")

    def _handle_inbound_message(self, message: dict[str, Any]) -> None:
        if self.era == "modern":
            filtered = mcp_notification_subscription_filter(message, self._active_subscription_id)
            if not filtered.get("deliver"):
                return
            message = filtered.get("message") or {}
            if filtered.get("acknowledged"):
                self._subscription_ready.set()
        method = message.get("method")
        if method == "roots/list" and "id" in message:
            self.transport.send_response({
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {"roots": self.options.get("roots") or []},
            })
            return
        if method in {"notifications/tools/list_changed", "notifications/prompts/list_changed", "notifications/resources/list_changed"}:
            self.refresh()
        if method == "notifications/resources/updated":
            uri = (message.get("params") or {}).get("uri")
            if uri:
                self._resource_read_cache.pop(str(uri), None)
        callback = self.options.get("onNotification")
        if callable(callback):
            callback(message)
        for listener in list(self._notification_listeners):
            listener(message)

    def _tool_to_function(self, tool: dict[str, Any]) -> Tool:
        name = _override_name(tool.get("name", ""), self.options)
        description = _override_description(tool, self.options)

        def handler(args: dict[str, Any]) -> Any:
            result = self.call_tool(tool.get("name", name), args)
            if "structuredContent" in result:
                return result["structuredContent"]
            return _content_to_value(result.get("content", []))

        return Tool(name, description, tool.get("inputSchema") or {"type": "object", "properties": {}}, handler)

    def _prompt_to_function(self, prompt: dict[str, Any]) -> Tool:
        name = _override_name("prompt_" + prompt.get("name", ""), self.options)
        description = _override_description(prompt, self.options)
        properties = {arg.get("name", "arg"): {"type": "string", "description": arg.get("description", "")} for arg in prompt.get("arguments", [])}

        def handler(args: dict[str, Any]) -> Any:
            return self.get_prompt(prompt.get("name", ""), args)

        return Tool(name, description, {"type": "object", "properties": properties}, handler)

    def _resource_to_function(self, resource: dict[str, Any]) -> Tool:
        name = _override_name("resource_" + _safe_name(resource.get("name") or resource.get("uri", "resource")), self.options)
        description = _override_description(resource, self.options)
        return Tool(name, description, {"type": "object", "properties": {}}, lambda _args: self.read_resource(resource["uri"]))

    def _resource_template_to_function(self, template: dict[str, Any]) -> Tool:
        name = _override_name("resource_template_" + _safe_name(template.get("name", "template")), self.options)
        description = _override_description(template, self.options)
        return Tool(name, description, {"type": "object", "properties": {"uri": {"type": "string"}}}, lambda args: self.read_resource(args["uri"]))


class AxMCPEventSource(AxEventSource):
    """Composable MCP notification adapter for AxEventRuntime."""
    def __init__(self, client: AxMCPClient, namespace: str | None = None, *,
                 identity_scope: str = "anonymous", trust: str = "untrusted",
                 resource_subscriptions: Any = "none", subscriptions: list[str] | None = None):
        if subscriptions is not None and resource_subscriptions != "none":
            raise ValueError("Specify either resource_subscriptions or subscriptions, not both")
        self.client = client; self.namespace = namespace or client.namespace()
        self.identity_scope = identity_scope; self.trust = trust
        self.resource_subscriptions = subscriptions if subscriptions is not None else resource_subscriptions
        self.subscriptions: list[str] = []; self.owner = f"event-source:{uuid.uuid4()}"
        self.errors: list[Exception] = []; self._publish = None; self._remove = None; self._remove_lifecycle = None

    def start(self, publish):
        self.client.init()
        self._publish = publish
        self._remove = self.client.add_notification_listener(self._on_notification)
        self._remove_lifecycle = self.client.add_lifecycle_listener(
            lambda state: self._reconcile() if state == "reconnected" else None)
        if self.client.get_era() == "modern":
            self.client.start_listening()
        self._reconcile()
        return self

    def _on_notification(self, message):
        if not self._publish or "method" not in message: return
        if message.get("method") == "notifications/resources/list_changed":
            self._reconcile()
        normalized = event_normalize_mcp(self.namespace, str(message["method"]), message.get("params") or {})
        raw_correlation = normalized.get("correlation")
        correlation = [raw_correlation] if isinstance(raw_correlation, dict) else list(raw_correlation or [])
        data = normalized.get("data")
        subject = None
        if isinstance(data, dict):
            subject = data.get("uri") or (data.get("task") or {}).get("taskId")
        self._publish(AxEventEnvelope(
            f"mcp:{self.namespace}:{uuid.uuid4()}", normalized["source"], normalized["type"],
            data, subject, correlation=correlation),
            identity_scope=self.identity_scope, trust=self.trust)

    def reconnect(self):
        self.client.restore_resource_subscriptions()
        self._reconcile()

    def _selected_uris(self, catalog):
        policy = self.resource_subscriptions
        resources = list(catalog.get("resources") or [])
        mode = "none"; explicit = []; candidates = []
        if policy == "all": mode = "all"; candidates = resources
        elif isinstance(policy, (list, tuple)): mode = "explicit"; explicit = [str(uri) for uri in policy]
        elif policy not in (None, "none"):
            selector = policy.get("select") if isinstance(policy, dict) else policy
            if not callable(selector): raise ValueError("Invalid MCP resource subscription policy")
            mode = "selector"; candidates = [resource for resource in resources if selector(resource, catalog)]
        return sorted(mcp_resource_subscription_selection(candidates, mode, explicit))

    def _reconcile(self):
        catalog = self.client.inspect_catalog()
        policy = self.resource_subscriptions
        if policy not in (None, "none"):
            capability = catalog.get("serverCapabilities", {}).get("resources")
            if not isinstance(capability, dict) or not capability.get("subscribe"):
                raise AxMCPError(f"MCP server {catalog['namespace']} does not advertise resource subscriptions")
        try: desired = self._selected_uris(catalog)
        except Exception as error:
            self.errors.append(error); return
        raw = mcp_resource_subscription_plan(desired, self.subscriptions)
        plan = dict(raw or {})
        for uri in plan.get("removals") or []:
            try: self.client.release_resource_subscription(str(uri), self.owner); self.subscriptions.remove(str(uri))
            except Exception as error: self.errors.append(error)
        for uri in plan.get("additions") or []:
            try: self.client.acquire_resource_subscription(str(uri), self.owner); self.subscriptions.append(str(uri)); self.subscriptions.sort()
            except Exception as error: self.errors.append(error)

    def close(self):
        for uri in self.subscriptions:
            try: self.client.release_resource_subscription(uri, self.owner)
            except Exception: pass
        self.subscriptions = []
        if self._remove: self._remove()
        if self._remove_lifecycle: self._remove_lifecycle()
        self._remove = None; self._remove_lifecycle = None; self._publish = None


class AxUCPBinding:
    """Host binding used by generated UCP clients for REST or MCP operations."""

    def call(self, operation: str, payload: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


class AxUCPClient:
    OPERATIONS = (
        "catalog.search", "catalog.lookup", "catalog.product",
        "cart.create", "cart.get", "cart.update", "cart.cancel",
        "checkout.create", "checkout.get", "checkout.update", "checkout.complete", "checkout.cancel",
        "fulfillment.quote", "discounts.apply", "payments.create", "payments.confirm",
        "orders.get", "identity.link", "attribution.record", "handoff.create",
    )

    def __init__(self, profile: dict[str, Any], binding: AxUCPBinding | Callable[..., Any], options: dict[str, Any] | None = None):
        self.profile = dict(profile or {})
        self.binding = binding
        self.options = dict(options or {})
        self.version = str(self.profile.get("version") or self.options.get("version") or "2026-04-08")
        supported = list(self.options.get("supportedVersions") or ["2026-04-08"])
        if self.version not in supported:
            raise ValueError(f"Unsupported UCP version {self.version}")
        self.services = dict(self.profile.get("services") or {})
        self.capabilities = dict(self.profile.get("capabilities") or {})

    def namespace(self) -> str:
        return str(self.options.get("namespace") or self.profile.get("name") or "ucp")

    def call(self, operation: str, payload: dict[str, Any] | None = None, *, idempotency_key: str | None = None) -> dict[str, Any]:
        if operation not in self.OPERATIONS:
            raise ValueError(f"Unsupported UCP operation {operation}")
        call_options = {"version": self.version, "idempotencyKey": idempotency_key or str(uuid.uuid4())}
        if hasattr(self.binding, "call"):
            value = self.binding.call(operation, dict(payload or {}), call_options)
        else:
            value = self.binding(operation, dict(payload or {}), call_options)
        if not isinstance(value, dict):
            raise TypeError("UCP binding must return an object")
        return {
            "operation": operation,
            "value": value,
            "warnings": value.get("warnings"),
            "partialSuccess": bool(value.get("partial_success") or value.get("partialSuccess")),
            "continuationUrl": value.get("continuation_url") or value.get("continuationUrl"),
            "idempotencyKey": call_options["idempotencyKey"],
        }

    def native_tools(self) -> list[Tool]:
        return [
            Tool(
                f"{self.namespace()}_{operation.replace('.', '_')}",
                f"UCP {operation} operation",
                {"type": "object", "properties": {}},
                lambda args, operation=operation: self.call(operation, args),
                namespace=f"ucp.{self.namespace()}",
            )
            for operation in self.OPERATIONS
        ]

    def catalog_search(self, payload=None): return self.call("catalog.search", payload)
    def catalog_lookup(self, payload=None): return self.call("catalog.lookup", payload)
    def catalog_product(self, payload=None): return self.call("catalog.product", payload)
    def cart_create(self, payload=None): return self.call("cart.create", payload)
    def cart_get(self, payload=None): return self.call("cart.get", payload)
    def cart_update(self, payload=None): return self.call("cart.update", payload)
    def cart_cancel(self, payload=None): return self.call("cart.cancel", payload)
    def checkout_create(self, payload=None): return self.call("checkout.create", payload)
    def checkout_get(self, payload=None): return self.call("checkout.get", payload)
    def checkout_update(self, payload=None): return self.call("checkout.update", payload)
    def checkout_complete(self, payload=None): return self.call("checkout.complete", payload)
    def checkout_cancel(self, payload=None): return self.call("checkout.cancel", payload)
    def order_get(self, payload=None): return self.call("orders.get", payload)
    def identity_link(self, payload=None): return self.call("identity.link", payload)


class AxExecutionContext:
    """Live, inheritable MCP/UCP clients shared by every generated Ax program."""

    def __init__(self, mcp=None, ucp=None, options: dict[str, Any] | None = None):
        self.mcp = list(mcp or [])
        self.ucp = list(ucp or [])
        self.options = dict(options or {})
        self._initialized: set[int] = set()
        namespaces = [client.namespace() for client in [*self.mcp, *self.ucp]]
        if len(namespaces) != len(set(namespaces)):
            raise ValueError("MCP/UCP namespace collision")

    def initialize(self):
        for client in self.mcp:
            if id(client) not in self._initialized:
                client.init()
                self._initialized.add(id(client))
        return self

    def native_tools(self) -> list[Tool]:
        self.initialize()
        tools = [tool for client in self.mcp for tool in client.native_tools()]
        tools.extend(tool for client in self.ucp for tool in client.native_tools())
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise ValueError("MCP/UCP tool collision")
        return tools

    def runtime_modules(self) -> list[dict[str, Any]]:
        modules = []
        for client in self.mcp:
            modules.append({"name": f"mcp.{client.namespace()}", "functions": client.native_tools(), "client": client})
        for client in self.ucp:
            modules.append({"name": f"ucp.{client.namespace()}", "functions": client.native_tools(), "client": client})
        return modules

    def derive(self, inheritance: Any = "all"):
        if inheritance == "none":
            return AxExecutionContext()
        if isinstance(inheritance, (list, tuple, set)):
            allowed = set(map(str, inheritance))
            return AxExecutionContext(
                [client for client in self.mcp if client.namespace() in allowed],
                [client for client in self.ucp if client.namespace() in allowed],
                self.options,
            )
        return self

    def continuation_state(self) -> dict[str, Any]:
        namespaces = [client.namespace() for client in [*self.mcp, *self.ucp]]
        fingerprint = hashlib.sha256(json.dumps(namespaces, sort_keys=True).encode()).hexdigest()
        return {"namespaces": namespaces, "tasks": [], "subscriptions": [], "catalogFingerprint": fingerprint}


def resolve_execution_context(options: dict[str, Any] | None, parent: AxExecutionContext | None = None) -> AxExecutionContext | None:
    opts = options or {}
    explicit = opts.get("executionContext") or opts.get("mcpExecutionContext")
    if isinstance(explicit, AxExecutionContext):
        return explicit.derive(opts.get("mcpInheritance", "all"))
    mcp = opts.get("mcp")
    ucp = opts.get("ucp")
    if mcp is not None or ucp is not None:
        return AxExecutionContext(mcp if isinstance(mcp, (list, tuple)) else [mcp] if mcp else [], ucp if isinstance(ucp, (list, tuple)) else [ucp] if ucp else [], opts)
    return parent.derive(opts.get("mcpInheritance", "all")) if parent else None


def _ax_mcp_encode_header_value(value: str) -> str:
    if mcp_header_value_plan(value).get("mode") == "plain":
        return value
    encoded = base64.b64encode(value.encode("utf-8")).decode("ascii")
    return f"=?base64?{encoded}?="


class AxMCPStreamableHTTPTransport(AxMCPTransport):
    def __init__(self, endpoint: str, options: dict[str, Any] | None = None):
        self.endpoint = ax_mcp_validate_endpoint(endpoint, (options or {}).get("ssrfProtection"))
        self.options = options or {}
        self.headers = dict(self.options.get("headers") or {})
        if self.options.get("authorization"):
            self.headers["Authorization"] = self.options["authorization"]
        self.protocol_version: str | None = None
        self.session_id: str | None = None
        self.era: str | None = None
        parsed_endpoint = urllib.parse.urlsplit(self.endpoint)
        self._era_cache_key = f"{parsed_endpoint.scheme}://{parsed_endpoint.netloc}"
        self.last_headers: dict[str, str] = {}
        self._message_handler: Callable[[dict[str, Any]], None] | None = None
        self._lifecycle_handler: Callable[[str], None] | None = None
        self._listen_stop = threading.Event()
        self._listen_thread: threading.Thread | None = None
        self._listen_response: Any = None
        self._last_event_id: str | None = None

    def set_headers(self, headers: dict[str, str]) -> None:
        self.headers = dict(headers)

    def set_authorization(self, authorization: str) -> None:
        self.headers["Authorization"] = authorization

    @property
    def era_cache_key(self) -> str:
        return self._era_cache_key

    def set_era(self, era: str) -> None:
        self.era = era
        if era == "modern":
            self.session_id = None
            self.protocol_version = "2026-07-28"
        elif self.protocol_version == "2026-07-28":
            self.protocol_version = None

    def set_lifecycle_handler(self, handler: Callable[[str], None]) -> None:
        self._lifecycle_handler = handler

    def start_listening(self) -> None:
        if self.era == "modern":
            raise AxMCPError("Modern MCP uses subscriptions/listen via openRequestStream, not HTTP GET")
        if self._listen_thread and self._listen_thread.is_alive(): return
        self._listen_stop.clear()
        self._listen_thread = threading.Thread(target=self._listen_loop, name="ax-mcp-sse", daemon=True)
        self._listen_thread.start()

    def open_request_stream(self, message: dict[str, Any]) -> None:
        if self.era != "modern":
            raise AxMCPError("Request streams are only available for modern MCP")
        self.close_request_stream()
        self._listen_stop.clear()
        self._listen_thread = threading.Thread(
            target=self._request_stream_once, args=(json.loads(json.dumps(message)),),
            name="ax-mcp-request-stream", daemon=True,
        )
        self._listen_thread.start()

    def _request_stream_once(self, message: dict[str, Any]) -> None:
        try:
            body = json.dumps(message).encode("utf-8")
            headers = self.build_headers(
                {"Content-Type": "application/json", "Accept": "text/event-stream"},
                True, str(message.get("method") or ""),
                message.get("params") if isinstance(message.get("params"), dict) else {}, {},
            )
            request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
            response = urllib.request.urlopen(request, timeout=float(self.options.get("listenTimeout", 300)))
            self._listen_response = response
            data: list[str] = []
            while not self._listen_stop.is_set():
                raw = response.readline()
                if not raw: break
                line = raw.decode("utf-8").rstrip("\r\n")
                if line.startswith("data:"):
                    data.append(line[5:].lstrip())
                elif line == "":
                    if data and self._message_handler:
                        self._message_handler(json.loads("\n".join(data)))
                    data = []
            response.close()
        except Exception:
            pass
        finally:
            self._listen_response = None
            if not self._listen_stop.is_set() and self._lifecycle_handler:
                self._lifecycle_handler("disconnected")

    def close_request_stream(self) -> None:
        self._listen_stop.set()
        if self._listen_response is not None:
            try: self._listen_response.close()
            except Exception: pass
        if self._listen_thread and self._listen_thread is not threading.current_thread():
            self._listen_thread.join(float(self.options.get("closeTimeout", 2)))
        self._listen_thread = None

    def _listen_loop(self) -> None:
        connected_once = False
        delay = float(self.options.get("reconnectDelay", 0.1))
        while not self._listen_stop.is_set():
            try:
                headers = self.build_headers({"Accept": "text/event-stream"}, True)
                if self._last_event_id: headers["Last-Event-ID"] = self._last_event_id
                request = urllib.request.Request(self.endpoint, headers=headers, method="GET")
                response = urllib.request.urlopen(request, timeout=float(self.options.get("listenTimeout", 300)))
                self._listen_response = response; self._capture_session(response.headers)
                if connected_once and self._lifecycle_handler: self._lifecycle_handler("reconnected")
                connected_once = True
                data: list[str] = []; event_id: str | None = None
                while not self._listen_stop.is_set():
                    raw = response.readline()
                    if not raw: break
                    line = raw.decode("utf-8").rstrip("\r\n")
                    if line.startswith("id:"): event_id = line[3:].strip()
                    elif line.startswith("data:"): data.append(line[5:].lstrip())
                    elif line == "":
                        if event_id: self._last_event_id = event_id
                        if data:
                            message = json.loads("\n".join(data))
                            if self._message_handler: self._message_handler(message)
                        data = []; event_id = None
                response.close(); self._listen_response = None
                if not self._listen_stop.is_set() and self._lifecycle_handler: self._lifecycle_handler("disconnected")
            except Exception:
                self._listen_response = None
                if not self._listen_stop.is_set() and connected_once and self._lifecycle_handler: self._lifecycle_handler("disconnected")
            if not self._listen_stop.is_set(): self._listen_stop.wait(delay)

    def close(self) -> None:
        self._listen_stop.set()
        if self._listen_response is not None:
            try:
                raw = getattr(getattr(self._listen_response, "fp", None), "raw", None)
                connection = getattr(raw, "_sock", None)
                if connection is not None:
                    connection.shutdown(socket.SHUT_RDWR)
                else:
                    self._listen_response.close()
            except Exception:
                pass
        if self._listen_thread and self._listen_thread is not threading.current_thread():
            self._listen_thread.join(float(self.options.get("closeTimeout", 2)))
        self._listen_thread = None

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        return self.send_with_headers(message)

    def send_with_headers(self, message: dict[str, Any], extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
        body = json.dumps(message).encode("utf-8")
        headers = self.build_headers(
            {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
            message.get("method") != "initialize",
            str(message.get("method") or ""),
            message.get("params") if isinstance(message.get("params"), dict) else {},
            extra_headers,
        )
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=float(self.options.get("timeout", 30))) as response:
                self._capture_session(response.headers)
                content_type = response.headers.get("Content-Type", "") if hasattr(response.headers, "get") else ""
                text = response.read().decode("utf-8")
                if not text:
                    return {"jsonrpc": "2.0", "id": message.get("id"), "result": {}}
                # A spec-compliant MCP server may answer a JSON-RPC POST with an SSE
                # stream (Content-Type: text/event-stream) carrying the response — and
                # any interleaved notifications/keepalives — in `data:` frames. Parse
                # those rather than JSON-decoding the raw stream; otherwise keep the
                # JSON path. (The optional standalone GET stream for unsolicited
                # server->client messages is out of scope for this request/response
                # transport.)
                if "text/event-stream" in content_type.lower():
                    return self._select_sse_response(_ax_mcp_parse_sse(text), message.get("id"))
                return json.loads(text)
        except urllib.error.HTTPError as error:
            if error.code == 401 and self._apply_oauth():
                return self.send_with_headers(message, extra_headers)
            raise AxMCPError(f"HTTP error {error.code}: {error.reason}")

    def _select_sse_response(self, messages: list[dict[str, Any]], request_id: Any) -> dict[str, Any]:
        # Return the JSON-RPC response whose id matches this request; route any
        # other messages (server notifications/requests interleaved on the POST
        # stream) to the inbound handler, mirroring the stdio transport.
        response: dict[str, Any] | None = None
        for msg in messages:
            if response is None and isinstance(msg, dict) and msg.get("id") == request_id:
                response = msg
                continue
            if self._message_handler:
                self._message_handler(msg)
        if response is not None:
            return response
        return messages[-1] if messages else {"jsonrpc": "2.0", "id": request_id, "result": {}}

    def send_notification(self, message: dict[str, Any]) -> None:
        response = self.send(message)
        if "error" in response:
            error = response["error"]
            raise AxMCPError(str(error.get("message", "MCP notification failed")), code=error.get("code"))

    def build_headers(
        self,
        base: dict[str, str] | None = None,
        include_protocol_version: bool = True,
        method: str | None = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, str]:
        headers = {**self.headers, **(base or {})}
        for key, value in (extra_headers or {}).items():
            headers[key] = _ax_mcp_encode_header_value(str(value)) if self.era == "modern" and key.lower().startswith("mcp-param-") else str(value)
        if self.era != "modern" and self.session_id:
            headers["MCP-Session-Id"] = self.session_id
        if (self.era == "modern" or include_protocol_version) and self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self.era == "modern" and method:
            headers["Mcp-Method"] = method
            name = mcp_request_name(method, params or {})
            if name:
                headers["Mcp-Name"] = _ax_mcp_encode_header_value(name)
        self.last_headers = dict(headers)
        return headers

    def terminate_session(self) -> None:
        if self.era == "modern" or not self.session_id:
            return
        self.session_id = None

    def _capture_session(self, headers: Any) -> None:
        if self.era == "modern":
            return
        session_id = headers.get("MCP-Session-Id") if hasattr(headers, "get") else None
        if session_id:
            self.session_id = session_id

    def _apply_oauth(self) -> bool:
        oauth = self.options.get("oauth")
        if oauth is None:
            return False
        if isinstance(oauth, AxMCPOAuthOptions):
            store = oauth.tokenStore
            callback = oauth.onAuthCode
            scopes = oauth.scopes or []
            client_id = oauth.clientId or "ax-mcp-client"
            redirect_uri = oauth.redirectUri or "http://localhost:8787/callback"
            require_iss = oauth.requireIss
        else:
            store = oauth.get("tokenStore")
            callback = oauth.get("onAuthCode")
            scopes = oauth.get("scopes") or []
            client_id = oauth.get("clientId") or "ax-mcp-client"
            redirect_uri = oauth.get("redirectUri") or "http://localhost:8787/callback"
            require_iss = bool(oauth.get("requireIss", oauth.get("require_iss", False)))
        token = _token_store_get(store, self.endpoint)
        if token and token.get("accessToken"):
            self.headers["Authorization"] = "Bearer " + token["accessToken"]
            return True
        if not callable(callback):
            return False
        verifier = ax_mcp_pkce_verifier()
        challenge = ax_mcp_pkce_challenge(verifier)
        state = ax_mcp_pkce_verifier()
        params = urllib.parse.urlencode({
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(scopes),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        })
        auth = callback(self.endpoint + ("&" if "?" in self.endpoint else "?") + params)
        if not auth or not auth.get("code"):
            return False
        validation = mcp_oauth_validate_issuer({**auth, "expectedState": state}, self.endpoint, require_iss)
        if not validation.get("ok"):
            raise AxMCPError(str(validation.get("message") or "OAuth authorization response validation failed"))
        token = {"accessToken": "mcp-auth-code-" + auth["code"], "issuer": self.endpoint}
        _token_store_set(store, self.endpoint, token)
        self.headers["Authorization"] = "Bearer " + token["accessToken"]
        return True


class AxMCPStdioTransport(AxMCPTransport):
    def __init__(self, command: str, args: list[str] | None = None, options: dict[str, Any] | None = None):
        env = None
        if options and options.get("env"):
            env = {**options["env"]}
        self.process = subprocess.Popen([command, *(args or [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env)
        self.lock = threading.Lock()
        self.protocol_version: str | None = None
        self._message_handler: Callable[[dict[str, Any]], None] | None = None

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.process.stdin is None or self.process.stdout is None:
            raise AxMCPError("MCP stdio process is not connected")
        line = ax_mcp_stdio_encode(message)
        with self.lock:
            self.process.stdin.write(line)
            self.process.stdin.flush()
            while True:
                raw = self.process.stdout.readline()
                if raw == "":
                    raise AxMCPError("MCP stdio process closed")
                parsed = ax_mcp_stdio_decode(raw)
                if parsed.get("id") == message.get("id"):
                    return parsed
                if self._message_handler:
                    self._message_handler(parsed)

    def send_notification(self, message: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise AxMCPError("MCP stdio process is not connected")
        self.process.stdin.write(ax_mcp_stdio_encode(message))
        self.process.stdin.flush()

    def close(self) -> None:
        self.process.terminate()


def ax_mcp_stdio_encode(message: dict[str, Any]) -> str:
    return json.dumps(message, separators=(",", ":")) + "\n"


def ax_mcp_stdio_decode(line: str) -> dict[str, Any]:
    return json.loads(line.strip())


def _ax_mcp_parse_sse(text: str) -> list[dict[str, Any]]:
    # Extract JSON-RPC messages from the `data:` frames of an SSE body. Mirrors
    # the AI module's streaming SSE reader but stays self-contained so the MCP
    # module keeps no cross-module dependency (TestPythonModulesSelfContained).
    messages: list[dict[str, Any]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        messages.append(json.loads(data))
    return messages


def ax_mcp_pkce_verifier() -> str:
    return base64.urlsafe_b64encode(uuid.uuid4().bytes + uuid.uuid4().bytes).decode("ascii").rstrip("=")


def ax_mcp_pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def ax_mcp_validate_endpoint(endpoint: str, options: dict[str, Any] | None = None) -> str:
    opts = options or {}
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme not in {"http", "https"}:
        raise AxMCPError("MCP endpoint must use http or https")
    require_https = opts.get("requireHttps", opts.get("require_https", True))
    if require_https and parsed.scheme != "https":
        raise AxMCPError("MCP endpoint must use https")
    host = parsed.hostname
    if not host:
        raise AxMCPError("MCP endpoint must include a host")
    if host in {"localhost", "localhost.localdomain"} and not opts.get("allowLocalhost", opts.get("allow_localhost", False)):
        raise AxMCPError("MCP endpoint host is local")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return endpoint
    allow_private = opts.get("allowPrivateNetworks", opts.get("allow_private_networks", False))
    allow_local = opts.get("allowLocalhost", opts.get("allow_localhost", False))
    if (ip.is_loopback and not allow_local) or (ip.is_private and not allow_private) or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        raise AxMCPError("MCP endpoint host is not allowed by SSRF protection")
    return endpoint


def _token_store_get(store: Any, key: str) -> dict[str, Any] | None:
    if store is None:
        return None
    if isinstance(store, dict):
        token = store.get(key)
        if token is None and callable(store.get("getToken")):
            token = store["getToken"](key)
        return _token_to_dict(token)
    getter = getattr(store, "getToken", None) or getattr(store, "get_token", None)
    return _token_to_dict(getter(key)) if callable(getter) else None


def _token_store_set(store: Any, key: str, token: dict[str, Any]) -> None:
    if store is None:
        return None
    if isinstance(store, dict):
        if callable(store.get("setToken")):
            store["setToken"](key, token)
        else:
            store[key] = token
        return None
    setter = getattr(store, "setToken", None) or getattr(store, "set_token", None)
    if callable(setter):
        setter(key, token)
    return None


def _token_to_dict(token: Any) -> dict[str, Any] | None:
    if token is None:
        return None
    if isinstance(token, AxMCPTokenSet):
        return {"accessToken": token.accessToken, "refreshToken": token.refreshToken, "expiresAt": token.expiresAt, "issuer": token.issuer}
    if isinstance(token, dict):
        return token
    return None


def _override_name(name: str, options: dict[str, Any]) -> str:
    for item in options.get("functionOverrides") or []:
        if item.get("name") == name:
            return item.get("updates", {}).get("name") or name
    return name


def _override_description(item: dict[str, Any], options: dict[str, Any]) -> str:
    name = item.get("name", "")
    description = item.get("description") or item.get("title") or name
    for override in options.get("functionOverrides") or []:
        if override.get("name") == name:
            return override.get("updates", {}).get("description") or description
    return description


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in value).strip("_") or "item"


def _content_to_value(content: list[dict[str, Any]]) -> Any:
    texts = [item.get("text", "") for item in content if item.get("type") == "text"]
    if texts:
        return {"content": "\n".join(texts)}
    return {"content": content}


def run_mcp_conformance_fixture(fixture: dict[str, Any]) -> None:
    operation = fixture.get("operation", "initialize")
    expected_error = fixture.get("expected_error_contains")
    try:
        if operation == "ssrf":
            ax_mcp_validate_endpoint(fixture.get("endpoint", "https://127.0.0.1/mcp"), fixture.get("ssrfProtection"))
            if expected_error:
                raise AssertionError("expected SSRF validation to fail")
            return
        if operation == "stdio_framing":
            encoded = ax_mcp_stdio_encode(fixture["message"])
            if fixture.get("expected_line") is not None and encoded != fixture["expected_line"]:
                raise AssertionError(f"stdio line mismatch: {encoded!r}")
            decoded = ax_mcp_stdio_decode(encoded)
            _assert_subset(decoded, fixture["message"], "stdio decoded")
            return
        if operation == "oauth_issuer":
            for case in fixture.get("cases") or []:
                actual = mcp_oauth_validate_issuer(
                    case.get("response") or {},
                    case.get("expected_issuer", ""),
                    bool(case.get("require_iss")),
                )
                _assert_subset(actual, case.get("expected") or {}, "OAuth issuer validation")
            endpoint = fixture.get("endpoint", "https://auth.example")
            def oauth_callback(url: str) -> dict[str, str]:
                state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["state"][0]
                return {"code": "abc", "state": state, "iss": endpoint}
            transport = AxMCPStreamableHTTPTransport(endpoint, {"oauth": {"onAuthCode": oauth_callback, "requireIss": True}})
            if not transport._apply_oauth():
                raise AssertionError("OAuth issuer-validating stub did not produce a token")
            if transport.headers.get("Authorization") != fixture.get("stub_expected_authorization"):
                raise AssertionError("OAuth issuer-validating stub did not set Authorization")
            return
        if operation == "oauth":
            challenge = ax_mcp_pkce_challenge(fixture.get("verifier", "test-verifier"))
            if fixture.get("expected_challenge") and challenge != fixture["expected_challenge"]:
                raise AssertionError("PKCE challenge mismatch")
            store: dict[str, Any] = {}
            auth_codes: list[str] = []
            def oauth_callback(url: str) -> dict[str, str]:
                state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["state"][0]
                auth_codes.append(url)
                return {"code": "abc", "state": state}
            transport = AxMCPStreamableHTTPTransport(
                fixture.get("endpoint", "https://example.com/mcp"),
                {"oauth": {"tokenStore": store, "onAuthCode": oauth_callback}},
            )
            if not transport._apply_oauth():
                raise AssertionError("OAuth flow did not produce a token")
            if "Authorization" not in transport.headers:
                raise AssertionError("OAuth flow did not set Authorization")
            return
        if operation == "discover":
            constants = mcp_protocol_constants()
            version = fixture.get("protocol_version", "2026-07-28")
            if version not in (constants.get("supportedProtocolVersions") or []):
                raise AssertionError(f"missing supported MCP protocol version {version}")
            request = mcp_jsonrpc_request(
                fixture.get("request_id", "discover-1"),
                "server/discover",
                fixture.get("params") or {},
            )
            _assert_subset(request, fixture.get("expected_request") or {}, "discover request")
            return
        if operation == "modern_headers":
            headers = mcp_modern_request_headers(
                fixture.get("method", "server/discover"),
                fixture.get("resource_name"),
                fixture.get("protocol_version"),
            )
            _assert_subset(headers, fixture.get("expected_headers") or {}, "modern headers")
            for key in fixture.get("forbidden_headers") or []:
                if key in headers:
                    raise AssertionError(f"modern headers contain forbidden {key}")
            return
        if operation == "era_classification":
            classification = mcp_classify_discovery_result(fixture.get("discovery_result"))
            _assert_subset(classification, fixture.get("expected_classification") or {}, "discovery classification")
            for invalid in fixture.get("invalid_discovery_results") or []:
                result = mcp_classify_discovery_result(invalid)
                if result.get("valid") is not False:
                    raise AssertionError(f"invalid discovery result classified as valid: {invalid!r}")
            for case in fixture.get("era_cases") or []:
                actual = mcp_resolve_known_era(case.get("configured", "auto"), case.get("hint"), case.get("cached"), case.get("stored"))
                _assert_subset(actual, case.get("expected") or {}, "era resolution")
            capability_case = fixture.get("capability_case") or {}
            capabilities = mcp_client_capabilities(
                capability_case.get("has_roots", False),
                capability_case.get("has_sampling", False),
                capability_case.get("has_elicitation", False),
                capability_case.get("era", "legacy"),
                capability_case.get("tasks_extension", False),
            )
            _assert_subset(capabilities, capability_case.get("expected") or {}, "client capabilities")
            for case in fixture.get("request_name_cases") or []:
                actual = mcp_request_name(case.get("method", ""), case.get("params") or {})
                if actual != case.get("expected", ""):
                    raise AssertionError(f"request name mismatch: {actual!r}")
            return
        if operation == "mutual_version":
            for case in fixture.get("cases") or []:
                actual = mcp_select_mutual_version(case.get("error_data"), case.get("client_versions") or [])
                if actual != case.get("expected_version", ""):
                    raise AssertionError(f"mutual version mismatch: {actual!r}")
            return
        if operation == "request_meta":
            actual = mcp_build_request_meta(
                fixture.get("existing"),
                fixture.get("protocol_version", "2026-07-28"),
                fixture.get("client_capabilities") or {},
                fixture.get("client_info") or {},
                fixture.get("log_level"),
                fixture.get("traceparent"),
                fixture.get("tracestate"),
            )
            _assert_subset(actual, fixture.get("expected_meta") or {}, "request meta")
            return
        if operation == "extension_negotiation":
            actual = mcp_negotiate_extensions(fixture.get("client_extensions") or {}, fixture.get("server_extensions") or {})
            if actual != (fixture.get("expected_extensions") or {}):
                raise AssertionError(f"extension negotiation mismatch: {actual!r}")
            return
        if operation == "param_headers":
            bindings = mcp_param_header_bindings(fixture.get("input_schema") or {})
            if bindings != (fixture.get("expected_bindings") or []):
                raise AssertionError(f"parameter header bindings mismatch: {bindings!r}")
            values = mcp_param_header_values(bindings, fixture.get("arguments") or {})
            if values != (fixture.get("expected_values") or {}):
                raise AssertionError(f"parameter header values mismatch: {values!r}")
            for invalid in fixture.get("invalid_schemas") or []:
                try:
                    mcp_param_header_bindings(invalid.get("schema") or {})
                except Exception as error:
                    if invalid.get("expected_error_contains", "") not in str(error):
                        raise AssertionError(f"unexpected parameter header error: {error}") from error
                else:
                    raise AssertionError("invalid parameter header schema was accepted")
            for invalid in fixture.get("invalid_values") or []:
                try:
                    mcp_param_header_values(bindings, invalid.get("arguments") or {})
                except Exception as error:
                    if invalid.get("expected_error_contains", "") not in str(error):
                        raise AssertionError(f"unexpected parameter header value error: {error}") from error
                else:
                    raise AssertionError("invalid parameter header value was accepted")
            return
        if operation == "header_value":
            for case in fixture.get("cases") or []:
                actual = mcp_header_value_plan(case.get("value", ""))
                if actual != (case.get("expected_plan") or {}):
                    raise AssertionError(f"header value plan mismatch: {actual!r}")
            return
        if operation == "cache_fold":
            for case in fixture.get("cases") or []:
                actual = mcp_fold_cache_info(case.get("pages") or [], case.get("fetched_at", 0))
                _assert_subset(actual, case.get("expected") or {}, "cache info")
                for field in case.get("forbidden_fields") or []:
                    if field in actual:
                        raise AssertionError(f"cache info contains forbidden field {field}")
                fresh = mcp_cache_freshness(actual, case.get("now", 0))
                if fresh is not case.get("expected_fresh"):
                    raise AssertionError(f"cache freshness mismatch: {fresh!r}")
            return
        if operation == "tasks_v2_violations":
            for case in fixture.get("validation_cases") or []:
                if mcp_validate_modern_task(case.get("task")) is not case.get("expected_valid"):
                    raise AssertionError("modern task validation mismatch")
            for case in fixture.get("terminal_cases") or []:
                _assert_subset(mcp_task_terminal_outcome(case.get("task") or {}), case.get("expected") or {}, "task terminal outcome")
            for scenario in fixture.get("scenarios") or []:
                transport = AxMCPScriptedTransport(scenario.get("responses") or [])
                client = AxMCPClient(transport, scenario.get("client_options") or {})
                client.init()
                try:
                    client.call_tool("slow", {})
                except Exception as error:
                    if scenario.get("expected_error", "") not in str(error):
                        raise
                else:
                    raise AssertionError("expected Tasks v2 protocol violation")
            return
        if operation == "mrtr_violations":
            for case in fixture.get("plan_cases") or []:
                actual = mcp_mrtr_plan_round(case.get("result") or {}, case.get("era", "legacy"), case.get("method", "tools/call"), case.get("round", 0), case.get("max_rounds"))
                _assert_subset(actual, case.get("expected") or {}, "MRTR round plan")
            for case in fixture.get("fulfill_cases") or []:
                actual = mcp_mrtr_fulfill_roots(case.get("input_requests") or {}, case.get("roots"))
                _assert_subset(actual, case.get("expected") or {}, "MRTR roots fulfillment")
            for case in fixture.get("next_params_cases") or []:
                actual = mcp_mrtr_next_params(case.get("base_params") or {}, case.get("input_responses"), case.get("request_state"))
                if actual != (case.get("expected") or {}):
                    raise AssertionError(f"MRTR next params mismatch: {actual!r}")
            return
        if operation == "http_session_headers":
            transport = AxMCPStreamableHTTPTransport(fixture.get("endpoint", "https://example.com/mcp"), fixture.get("transport_options") or {})
            transport.session_id = fixture.get("session_id", "session-1")
            transport.set_protocol_version(fixture.get("protocol_version", AX_MCP_PROTOCOL_VERSION))
            headers = transport.build_headers({"Accept": "application/json"})
            _assert_subset(headers, fixture.get("expected_headers") or {}, "headers")
            return
        if operation == "modern_transport_headers":
            transport = AxMCPStreamableHTTPTransport(fixture.get("endpoint", "https://example.com/mcp"))
            transport.session_id = fixture.get("session_id", "legacy-session")
            transport.set_era(fixture.get("era", "modern"))
            transport.set_protocol_version(fixture.get("protocol_version", "2026-07-28"))
            headers = transport.build_headers(
                {"Accept": "application/json"},
                True,
                fixture.get("method", ""),
                fixture.get("params") or {},
                fixture.get("extra_headers") or {},
            )
            _assert_subset(headers, fixture.get("expected_headers") or {}, "modern headers")
            for name in fixture.get("forbidden_headers") or []:
                if name in headers:
                    raise AssertionError(f"forbidden modern header present: {name}")
            if transport.era_cache_key != fixture.get("expected_era_cache_key"):
                raise AssertionError(f"era cache key mismatch: {transport.era_cache_key!r}")
            try:
                transport.start_listening()
            except Exception as error:
                if fixture.get("expected_listen_error_contains", "") not in str(error):
                    raise
            else:
                raise AssertionError("modern transport allowed legacy HTTP GET listening")
            return

        if operation == "execution_context_ucp":
            transport = AxMCPScriptedTransport(fixture.get("responses") or [])
            mcp = AxMCPClient(transport, fixture.get("client_options") or {})
            ucp = AxUCPClient(
                fixture.get("ucp_profile") or {},
                lambda _operation, _payload, _options: dict(fixture.get("ucp_response") or {}),
                fixture.get("ucp_options") or {},
            )
            context = AxExecutionContext([mcp], [ucp]).initialize()
            names = [client.namespace() for client in [*context.mcp, *context.ucp]]
            if names != list(fixture.get("expected_namespaces") or []):
                raise AssertionError(f"context namespaces mismatch: {names!r}")
            tool_names = [tool.name for tool in context.native_tools()]
            for expected in fixture.get("expected_native_tools") or []:
                if expected not in tool_names:
                    raise AssertionError(f"missing native context tool {expected}")
            call = fixture.get("call_ucp") or {}
            outcome = ucp.call(call.get("operation", "catalog.search"), call.get("payload") or {}, idempotency_key="fixture-key")
            _assert_subset(outcome, fixture.get("expected_ucp_outcome") or {}, "UCP outcome")
            state = context.continuation_state()
            if state.get("namespaces") != names or not state.get("catalogFingerprint"):
                raise AssertionError("invalid execution context continuation state")
            return

        transport = AxMCPScriptedTransport(fixture.get("responses") or fixture.get("transport_responses") or [])
        client = AxMCPClient(transport, fixture.get("client_options") or {})
        if operation == "protocol_negotiation":
            client.init()
            if fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
                raise AssertionError("protocol version mismatch")
            return
        client.init()
        if operation != "client_discovery" and fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
            raise AssertionError("protocol version mismatch")
        if operation == "client_discovery":
            if fixture.get("call_tool"):
                call = fixture["call_tool"]
                result = client.call_tool(call["name"], call.get("arguments") or {})
                _assert_subset(result, fixture.get("expected_call_result") or {}, "tool result")
            if client.get_era() != fixture.get("expected_era"):
                raise AssertionError(f"era mismatch: {client.get_era()!r}")
            if fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
                raise AssertionError("protocol version mismatch")
            _assert_catalog_names(client.tools, fixture.get("expected_tool_names"), "tool names")
            if fixture.get("expected_server_info"):
                _assert_subset(client.server_info or {}, fixture["expected_server_info"], "server info")
            _assert_requests(transport.requests, fixture)
            expected_headers = fixture.get("expected_request_headers") or []
            for index, subset in enumerate(expected_headers):
                _assert_subset(transport.request_headers[index], subset, f"request headers {index}")
            forbidden = set(fixture.get("forbidden_methods") or [])
            methods = [request.get("method") for request in transport.requests] + [item.get("method") for item in transport.notifications]
            if forbidden.intersection(methods):
                raise AssertionError(f"forbidden modern method emitted: {forbidden.intersection(methods)!r}")
            expected_notifications = fixture.get("expected_notification_methods")
            if expected_notifications is not None and [item.get("method") for item in transport.notifications] != expected_notifications:
                raise AssertionError("notification methods mismatch")
            return
        if operation == "read_cache":
            catalog_methods = {"resources/list", "resources/templates/list"}
            client.refresh(force=False)
            catalog_requests = sum(1 for request in transport.requests if request.get("method") in catalog_methods)
            if catalog_requests != fixture.get("expected_catalog_requests_after_fresh_refresh"):
                raise AssertionError(f"fresh catalog issued extra requests: {catalog_requests}")
            first = client.read_resource(fixture.get("uri", ""))
            second = client.read_resource(fixture.get("uri", ""))
            _assert_subset(first, fixture.get("expected_first") or {}, "first resource read")
            _assert_subset(second, fixture.get("expected_first") or {}, "cached resource read")
            transport.emit(fixture.get("notification") or {})
            after = client.read_resource(fixture.get("uri", ""))
            _assert_subset(after, fixture.get("expected_after_update") or {}, "resource read after update")
            reads = sum(1 for request in transport.requests if request.get("method") == "resources/read")
            if reads != fixture.get("expected_read_requests"):
                raise AssertionError(f"resource read request count mismatch: {reads}")
            return
        if operation == "tasks_v2_modern":
            result = client.call_tool("slow", {})
            _assert_subset(result, fixture.get("expected_call_result") or {}, "task call result")
            client.provide_task_input("task-1", {})
            client.cancel_task("task-1")
            for call, expected in ((client.list_tasks, fixture.get("expected_list_error", "")), (lambda: client.get_task_result("task-1"), fixture.get("expected_result_error", ""))):
                try:
                    call()
                except Exception as error:
                    if expected not in str(error):
                        raise
                else:
                    raise AssertionError("expected modern task legacy-method rejection")
            methods = [request.get("method") for request in transport.requests]
            if methods != (fixture.get("expected_methods") or []):
                raise AssertionError(f"task request methods mismatch: {methods!r}")
            return
        if operation == "mrtr_roots":
            result = client.call_tool("work", {"value": 1})
            _assert_subset(result, fixture.get("expected_call_result") or {}, "MRTR tool result")
            _assert_subset(client.get_prompt("ask", {}), fixture.get("expected_prompt_result") or {}, "MRTR prompt result")
            _assert_subset(client.read_resource("file:///resource"), fixture.get("expected_resource_result") or {}, "MRTR resource result")
            methods = [request.get("method") for request in transport.requests]
            if methods != (fixture.get("expected_methods") or []):
                raise AssertionError(f"MRTR request methods mismatch: {methods!r}")
            tool_calls = [request for request in transport.requests if request.get("method") == "tools/call"]
            if len({request.get("id") for request in tool_calls}) != len(tool_calls):
                raise AssertionError("MRTR rounds reused a request id")
            for index, expected in enumerate(fixture.get("expected_tool_call_params") or []):
                params = tool_calls[index].get("params") or {}
                _assert_subset(params, expected, f"MRTR tool params {index}")
                expected_responses = expected.get("inputResponses")
                if expected_responses is None:
                    if "inputResponses" in params or "requestState" in params:
                        raise AssertionError("initial MRTR request included round state")
                elif set((params.get("inputResponses") or {}).keys()) != set(expected_responses.keys()):
                    raise AssertionError("MRTR request retained stale input responses")
                if "requestState" not in expected and "requestState" in params:
                    raise AssertionError("MRTR request retained stale requestState")
            return
        if operation == "subscriptions_listen":
            for case in fixture.get("semantic_cases") or []:
                actual = mcp_listen_interests(case.get("subscribed_uris") or [], case.get("filters") or {})
                if actual != (case.get("expected") or {}):
                    raise AssertionError(f"listen interests mismatch: {actual!r}")
            delivered: list[dict[str, Any]] = []
            client.add_notification_listener(delivered.append)
            client.start_listening()
            if len(transport.request_streams) != 1:
                raise AssertionError("initial subscriptions/listen stream missing")
            first = transport.request_streams[0]
            _assert_subset((first.get("params") or {}).get("notifications") or {}, fixture.get("expected_first_notifications") or {}, "initial listen interests")
            client.acquire_resource_subscription(fixture.get("uri", ""), "fixture")
            if len(transport.request_streams) != fixture.get("expected_stream_count"):
                raise AssertionError("subscription interest change did not restart request stream")
            second = transport.request_streams[-1]
            if first.get("id") == second.get("id"):
                raise AssertionError("subscriptions/listen restart reused its request id")
            _assert_subset((second.get("params") or {}).get("notifications") or {}, fixture.get("expected_second_notifications") or {}, "updated listen interests")
            before = len([item for item in delivered if item.get("method") == "notifications/resources/updated"])
            notification = json.loads(json.dumps(fixture.get("delivered_notification") or {}))
            notification.setdefault("params", {})["_meta"] = {"io.modelcontextprotocol/subscriptionId": "other"}
            transport.emit(notification)
            if len([item for item in delivered if item.get("method") == "notifications/resources/updated"]) != before:
                raise AssertionError("cross-subscription notification was delivered")
            notification["params"]["_meta"]["io.modelcontextprotocol/subscriptionId"] = second.get("id")
            transport.emit(notification)
            updates = [item for item in delivered if item.get("method") == "notifications/resources/updated"]
            if len(updates) != before + 1 or "_meta" in (updates[-1].get("params") or {}):
                raise AssertionError("active subscription notification was not delivered cleanly")
            methods = [request.get("method") for request in transport.requests]
            for forbidden in fixture.get("expected_forbidden_methods") or []:
                if forbidden in methods:
                    raise AssertionError(f"modern subscription emitted legacy method {forbidden}")
            return
        if operation == "initialize":
            _assert_requests(transport.requests, fixture)
            return
        if operation == "ping":
            client.ping()
            _assert_requests(transport.requests, fixture)
            return
        if operation == "tools":
            functions = client.native_tools()
            names = [fn.name for fn in functions]
            if fixture.get("expected_function_names") and names != fixture["expected_function_names"]:
                raise AssertionError(f"function names mismatch: {names!r}")
            if fixture.get("call_function"):
                call = fixture["call_function"]
                result = next(fn for fn in functions if fn.name == call["name"]).call(call.get("arguments") or {})
                _assert_subset(result, fixture.get("expected_call_result") or {}, "tool result")
            _assert_requests(transport.requests, fixture)
            return
        if operation == "prompts_resources":
            _assert_catalog_names(client.prompts, fixture.get("expected_prompt_names"), "prompt names")
            _assert_catalog_names(client.resources, fixture.get("expected_resource_names"), "resource names")
            _assert_catalog_names(client.resource_templates, fixture.get("expected_resource_template_names"), "resource template names")
            return
        if operation == "roots_notifications":
            transport.emit({"jsonrpc": "2.0", "id": "server-1", "method": "roots/list"})
            if fixture.get("expected_roots_response"):
                _assert_subset(transport.sent_responses[0], fixture["expected_roots_response"], "roots response")
            return
        if operation == "cancellation":
            client.cancel_request(fixture.get("request_id", "1"), fixture.get("reason", "cancelled"))
            _assert_subset(transport.notifications[-1], fixture.get("expected_notification") or {}, "cancel notification")
            return
        raise AssertionError(f"unsupported MCP conformance operation {operation}")
    except Exception as exc:
        if expected_error and expected_error in str(exc):
            return
        raise


def _assert_requests(requests: list[dict[str, Any]], fixture: dict[str, Any]) -> None:
    expected = fixture.get("expected_requests") or []
    if len(requests) < len(expected):
        raise AssertionError(f"expected at least {len(expected)} requests, got {len(requests)}")
    for index, subset in enumerate(expected):
        _assert_subset(requests[index], subset, f"request {index}")


def _assert_catalog_names(catalog: list[dict[str, Any]], expected: Any, label: str) -> None:
    if expected is None:
        return
    names = [str(item.get("name", "")) for item in catalog]
    if names != expected:
        raise AssertionError(f"{label} mismatch: {names!r}")


def _assert_subset(actual: Any, expected: Any, label: str) -> None:
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            raise AssertionError(f"{label}: expected dict, got {type(actual).__name__}")
        for key, value in expected.items():
            if key not in actual:
                raise AssertionError(f"{label}: missing key {key!r}")
            _assert_subset(actual[key], value, label + "." + key)
    elif isinstance(expected, list):
        if not isinstance(actual, list):
            raise AssertionError(f"{label}: expected list, got {type(actual).__name__}")
        if len(actual) < len(expected):
            raise AssertionError(f"{label}: expected list length at least {len(expected)}, got {len(actual)}")
        for index, value in enumerate(expected):
            _assert_subset(actual[index], value, f"{label}[{index}]")
    elif actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")
