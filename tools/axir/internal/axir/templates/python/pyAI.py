from __future__ import annotations

from abc import ABC, abstractmethod
import base64
import codecs
import copy
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import math
import os
import random
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Iterable, Protocol
# AXIR_CORE_IMPORTS

AxUsageContext = dict[str, Any]
AxUsageEvent = dict[str, Any]
AxUsageObserver = Callable[[AxUsageEvent], Any]


@dataclass(frozen=True)
class AxRateLimitInfo:
    operation: str
    provider: str
    model: str
    streaming: bool
    previous_model_usage: dict[str, Any] | None = None


class AxRateLimiter(Protocol):
    def __call__(self, next_request: Callable[[], Any], info: AxRateLimitInfo) -> Any:
        ...


class AxSpan(Protocol):
    def set_attributes(self, attributes: dict[str, Any]) -> None:
        ...

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        ...

    def record_exception(self, error: BaseException | str) -> None:
        ...

    def set_status(self, status: str, description: str | None = None) -> None:
        ...

    def end(self) -> None:
        ...


class AxTracer(Protocol):
    def start_span(
        self,
        name: str,
        *,
        kind: str = "internal",
        attributes: dict[str, Any] | None = None,
        parent: AxSpan | None = None,
    ) -> AxSpan:
        ...


class AxCounter(Protocol):
    def add(self, value: float, attributes: dict[str, Any] | None = None) -> None:
        ...


class AxHistogram(Protocol):
    def record(self, value: float, attributes: dict[str, Any] | None = None) -> None:
        ...


class AxGauge(Protocol):
    def record(self, value: float, attributes: dict[str, Any] | None = None) -> None:
        ...


class AxMeter(Protocol):
    def create_counter(self, name: str, **options: Any) -> AxCounter:
        ...

    def create_histogram(self, name: str, **options: Any) -> AxHistogram:
        ...

    def create_gauge(self, name: str, **options: Any) -> AxGauge:
        ...


@dataclass(frozen=True)
class AxRuntimeHooks:
    rate_limiter: AxRateLimiter | None = None
    tracer: AxTracer | None = None
    meter: AxMeter | None = None


@dataclass(frozen=True)
class _AxRuntimeFrame:
    hooks: AxRuntimeHooks
    globals: AxRuntimeHooks
    span: AxSpan | None = None


_runtime_hooks_lock = threading.RLock()
_global_runtime_hooks = AxRuntimeHooks()
_runtime_frame: ContextVar[_AxRuntimeFrame | None] = ContextVar("ax_runtime_hooks", default=None)
_meter_cache_lock = threading.RLock()
_meter_cache: dict[int, tuple[Any, dict[tuple[str, str], Any]]] = {}


def set_rate_limiter(limiter: AxRateLimiter | None) -> None:
    """Set the process-wide rate limiter; pass None to clear it."""
    global _global_runtime_hooks
    with _runtime_hooks_lock:
        _global_runtime_hooks = AxRuntimeHooks(limiter, _global_runtime_hooks.tracer, _global_runtime_hooks.meter)


def set_tracer(tracer: AxTracer | None) -> None:
    """Set the process-wide tracer; pass None to clear it."""
    global _global_runtime_hooks
    with _runtime_hooks_lock:
        _global_runtime_hooks = AxRuntimeHooks(_global_runtime_hooks.rate_limiter, tracer, _global_runtime_hooks.meter)


def set_meter(meter: AxMeter | None) -> None:
    """Set the process-wide meter; pass None to clear it."""
    global _global_runtime_hooks
    with _runtime_hooks_lock:
        _global_runtime_hooks = AxRuntimeHooks(_global_runtime_hooks.rate_limiter, _global_runtime_hooks.tracer, meter)


def _snapshot_global_runtime_hooks() -> AxRuntimeHooks:
    with _runtime_hooks_lock:
        return _global_runtime_hooks


def _coerce_runtime_hooks(value: Any) -> AxRuntimeHooks:
    if isinstance(value, AxRuntimeHooks):
        return value
    if not isinstance(value, dict):
        return AxRuntimeHooks()
    return AxRuntimeHooks(
        value.get("rate_limiter") or value.get("rateLimiter"),
        value.get("tracer"),
        value.get("meter"),
    )


def _runtime_hooks_from_options(options: dict[str, Any] | None) -> AxRuntimeHooks:
    if not isinstance(options, dict):
        return AxRuntimeHooks()
    nested = _coerce_runtime_hooks(options.get("runtime_hooks") or options.get("runtimeHooks"))
    return AxRuntimeHooks(
        options.get("rate_limiter") or options.get("rateLimiter") or nested.rate_limiter,
        options.get("tracer") or nested.tracer,
        options.get("meter") or nested.meter,
    )


def _strip_runtime_hooks(options: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(options or {})
    for key in ("runtime_hooks", "runtimeHooks", "rate_limiter", "rateLimiter", "tracer", "meter"):
        out.pop(key, None)
    return out


def _merge_runtime_hooks(*layers: AxRuntimeHooks | None) -> AxRuntimeHooks:
    rate_limiter = tracer = meter = None
    for layer in layers:
        if layer is None:
            continue
        if rate_limiter is None and layer.rate_limiter is not None:
            rate_limiter = layer.rate_limiter
        if tracer is None and layer.tracer is not None:
            tracer = layer.tracer
        if meter is None and layer.meter is not None:
            meter = layer.meter
    return AxRuntimeHooks(rate_limiter, tracer, meter)


def _effective_runtime_hooks(call_options: dict[str, Any] | None = None, service_hooks: AxRuntimeHooks | None = None) -> AxRuntimeHooks:
    frame = _runtime_frame.get()
    globals_snapshot = frame.globals if frame else _snapshot_global_runtime_hooks()
    return _merge_runtime_hooks(
        _runtime_hooks_from_options(call_options),
        frame.hooks if frame else None,
        service_hooks,
        globals_snapshot,
    )


def _call_optional(target: Any, snake: str, camel: str, *args: Any) -> Any:
    if target is None:
        return None
    method = getattr(target, snake, None) or getattr(target, camel, None)
    if callable(method):
        return method(*args)
    return None


def _start_runtime_span(hooks: AxRuntimeHooks, name: str, kind: str, attributes: dict[str, Any]) -> AxSpan | None:
    tracer = hooks.tracer
    if tracer is None:
        return None
    parent = _runtime_frame.get().span if _runtime_frame.get() else None
    try:
        start = getattr(tracer, "start_span", None)
        if callable(start):
            return start(name, kind=kind, attributes=dict(attributes), parent=parent)
        start = getattr(tracer, "startSpan", None)
        if callable(start):
            return start({"name": name, "kind": kind, "attributes": dict(attributes)}, parent)
    except BaseException:
        pass
    return None


def _finish_runtime_span(span: AxSpan | None, error: BaseException | None = None) -> None:
    if span is None:
        return
    try:
        if error is not None:
            _call_optional(span, "record_exception", "recordException", error)
            _call_optional(span, "set_status", "setStatus", "error", str(error))
        else:
            _call_optional(span, "set_status", "setStatus", "ok", None)
        _call_optional(span, "end", "end")
    except BaseException:
        pass


def _meter_instrument(meter: AxMeter | None, kind: str, name: str) -> Any:
    if meter is None:
        return None
    key = id(meter)
    with _meter_cache_lock:
        cached = _meter_cache.get(key)
        if cached is None or cached[0] is not meter:
            cached = (meter, {})
            _meter_cache[key] = cached
        instruments = cached[1]
        instrument = instruments.get((kind, name))
        if instrument is not None:
            return instrument
        try:
            snake = f"create_{kind}"
            camel = "create" + kind.title()
            creator = getattr(meter, snake, None) or getattr(meter, camel, None)
            instrument = creator(name) if callable(creator) else None
        except BaseException:
            instrument = None
        if instrument is not None:
            instruments[(kind, name)] = instrument
        return instrument


def _record_runtime_metric(meter: AxMeter | None, kind: str, name: str, value: float, attributes: dict[str, Any]) -> None:
    try:
        instrument = _meter_instrument(meter, kind, name)
        if instrument is None:
            return
        method = getattr(instrument, "add" if kind == "counter" else "record", None)
        if callable(method):
            method(value, dict(attributes))
    except BaseException:
        pass


@contextmanager
def _runtime_hook_scope(
    call_hooks: AxRuntimeHooks | dict[str, Any] | None,
    program_hooks: AxRuntimeHooks | None,
    *,
    span_name: str,
    span_kind: str = "internal",
    attributes: dict[str, Any] | None = None,
    metric_prefix: str = "ax_gen_generation",
):
    parent = _runtime_frame.get()
    hooks = _merge_runtime_hooks(
        _coerce_runtime_hooks(call_hooks),
        parent.hooks if parent else None,
        program_hooks,
    )
    globals_snapshot = parent.globals if parent else _snapshot_global_runtime_hooks()
    effective = _merge_runtime_hooks(hooks, globals_snapshot)
    attrs = dict(attributes or {})
    span = _start_runtime_span(effective, span_name, span_kind, attrs)
    token = _runtime_frame.set(_AxRuntimeFrame(hooks, globals_snapshot, span or (parent.span if parent else None)))
    started = time.perf_counter()
    error = None
    _record_runtime_metric(effective.meter, "counter", f"{metric_prefix}_requests_total", 1, attrs)
    try:
        yield effective
    except BaseException as exc:
        error = exc
        _record_runtime_metric(effective.meter, "counter", f"{metric_prefix}_errors_total", 1, attrs)
        raise
    finally:
        _record_runtime_metric(effective.meter, "histogram", f"{metric_prefix}_duration_ms", (time.perf_counter() - started) * 1000, attrs)
        _finish_runtime_span(span, error)
        _runtime_frame.reset(token)

_usage_observer_lock = threading.RLock()
_usage_observer: AxUsageObserver | None = None


def set_usage_observer(observer: AxUsageObserver | None) -> None:
    """Set the process-wide best-effort usage observer; pass None to clear it."""
    global _usage_observer
    with _usage_observer_lock:
        _usage_observer = observer


def _emit_usage_event(
    operation: str,
    response: dict[str, Any],
    options: dict[str, Any] | None,
    streaming: bool,
) -> None:
    try:
        event = build_usage_event(operation, response, options or {}, streaming)
    except Exception:
        return
    if not event:
        return
    with _usage_observer_lock:
        observer = _usage_observer
    if observer is None:
        return
    try:
        observer(copy.deepcopy(event))
    except BaseException:
        pass


def _usage_observed_stream(
    values: Iterable[dict[str, Any]],
    options: dict[str, Any],
):
    last_usage_response = None
    completed = False
    try:
        for value in values:
            model_usage = value.get("model_usage") or value.get("modelUsage")
            if isinstance(model_usage, dict) and model_usage.get("tokens"):
                last_usage_response = value
            yield value
        completed = True
    finally:
        if completed and last_usage_response is not None:
            _emit_usage_event("chat", last_usage_response, options, True)
        close = getattr(values, "close", None)
        if callable(close):
            close()


def _invoke_rate_limiter(limiter: AxRateLimiter | None, next_request: Callable[[], Any], info: AxRateLimitInfo) -> Any:
    if limiter is None:
        return next_request()
    run = getattr(limiter, "run", None)
    if callable(run):
        return run(next_request, info)
    return limiter(next_request, info)


def _runtime_observed_stream(
    values: Iterable[dict[str, Any]],
    options: dict[str, Any],
    span: AxSpan | None,
    meter: AxMeter | None,
    attributes: dict[str, Any],
    started: float,
):
    error = None
    completed = False
    try:
        yield from _usage_observed_stream(values, options)
        completed = True
    except BaseException as exc:
        error = exc
        _record_runtime_metric(meter, "counter", "ax_llm_errors_total", 1, attributes)
        raise
    finally:
        if not completed and error is None:
            error = RuntimeError("stream terminated before completion")
            _record_runtime_metric(meter, "counter", "ax_llm_errors_total", 1, attributes)
        _record_runtime_metric(meter, "histogram", "ax_llm_request_duration_ms", (time.perf_counter() - started) * 1000, attributes)
        _finish_runtime_span(span, error)


class AxAIServiceError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        response_body: Any = None,
        request: Any = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.response_body = response_body
        self.request = request
        self.retryable = retryable


class AxAIServiceStatusError(AxAIServiceError):
    pass


class AxAIServiceNetworkError(AxAIServiceError):
    pass


class AxAIServiceResponseError(AxAIServiceError):
    pass


class AxAIServiceStreamTerminatedError(AxAIServiceError):
    pass


class AxAIServiceTimeoutError(AxAIServiceError):
    pass


class AxAIServiceAuthenticationError(AxAIServiceError):
    pass


class AxAIRefusalError(AxAIServiceError):
    pass


class AxUnsupportedCapabilityError(AxAIServiceError):
    pass


def ai(provider: str = "openai", **options):
    resolved = provider_resolve_profile(provider or "openai")
    if not resolved.get("known"):
        raise ValueError(f"unsupported AxAI provider: {provider}")
    canonical = resolved.get("id")
    descriptor = provider_descriptor(canonical)
    transport = descriptor.get("transport")
    if transport == "openai-responses":
        return OpenAIResponsesClient(_profile=canonical, **options)
    if transport == "gemini-generate-content":
        return GoogleGeminiClient(_profile=canonical, **options)
    if transport == "anthropic-messages":
        return AnthropicClient(_profile=canonical, **options)
    if transport == "openai-chat":
        return OpenAICompatibleClient(_profile=canonical, **options)
    raise ValueError(f"profile {canonical} uses unsupported transport: {transport}")


def default_features() -> dict[str, Any]:
    return {
        "functions": True,
        "streaming": True,
        "structured_outputs": True,
        "media": {
            "images": {"supported": True, "formats": ["image/jpeg", "image/png", "image/webp"]},
            "audio": {"supported": False, "formats": [], "output": {"supported": False, "formats": []}},
            "files": {"supported": False, "formats": [], "upload_method": "none"},
            "urls": {"supported": False, "web_search": False, "context_fetching": False},
        },
        "caching": {"supported": False, "types": []},
        "thinking": False,
        "multi_turn": True,
    }


def default_metrics() -> dict[str, Any]:
    return {
        "latency": {
            "chat": {"mean": 0.0, "p95": 0.0, "p99": 0.0, "samples": []},
            "embed": {"mean": 0.0, "p95": 0.0, "p99": 0.0, "samples": []},
        },
        "errors": {
            "chat": {"count": 0, "rate": 0.0, "total": 0},
            "embed": {"count": 0, "rate": 0.0, "total": 0},
        },
    }


def _encode_multipart(payload: dict[str, Any]) -> tuple[bytes, str]:
    """Encode a request payload as multipart/form-data.

    Multipart operations (e.g. OpenAI /audio/transcriptions) carry the audio as a
    binary `file` part; every other field is a plain form field. The `file` value is
    a base64 string (optionally a data: URL) or a dict {data, mimeType?, filename?}.
    """
    boundary = "----axllmFormBoundary" + uuid.uuid4().hex
    crlf = b"\r\n"
    parts: list[bytes] = []
    for key, value in payload.items():
        if value is None:
            continue
        if key == "file":
            if isinstance(value, dict):
                data = str(value.get("data", ""))
                filename = str(value.get("filename") or "audio.wav")
                content_type = str(value.get("mimeType") or value.get("mime_type") or "audio/wav")
            else:
                data = str(value)
                filename = "audio.wav"
                content_type = "audio/wav"
            if data.startswith("data:") and "," in data:
                data = data.split(",", 1)[1]
            try:
                file_bytes = base64.b64decode(data)
            except Exception:
                file_bytes = data.encode()
            parts.append(b"--" + boundary.encode() + crlf)
            parts.append(
                ('Content-Disposition: form-data; name="file"; filename="' + filename + '"').encode() + crlf
            )
            parts.append(("Content-Type: " + content_type).encode() + crlf + crlf)
            parts.append(file_bytes + crlf)
        else:
            parts.append(b"--" + boundary.encode() + crlf)
            parts.append(('Content-Disposition: form-data; name="' + str(key) + '"').encode() + crlf + crlf)
            parts.append(str(value).encode() + crlf)
    parts.append(b"--" + boundary.encode() + b"--" + crlf)
    return b"".join(parts), "multipart/form-data; boundary=" + boundary


def _realtime_event_is_ready(event: dict[str, Any]) -> bool:
    if event.get("type") in (
        "session.created",
        "session.updated",
        "transcription_session.created",
        "transcription_session.updated",
    ):
        return True
    return "setupComplete" in event


def _realtime_event_is_done(event: dict[str, Any]) -> bool:
    if event.get("type") in ("response.done", "response.completed"):
        return True
    server_content = event.get("serverContent")
    return bool(server_content and server_content.get("turnComplete"))


class ScriptedRealtimeTransport:
    """Deterministic realtime transport for offline tests: returns canned inbound
    frames in order and records every event the driver sends. No network, so the
    realtime turn loop runs without credentials or a live socket."""

    def __init__(self, inbound: Iterable[dict[str, Any]]):
        self._inbound = list(inbound)
        self.sent: list[dict[str, Any]] = []

    def send(self, event: dict[str, Any]) -> None:
        self.sent.append(event)

    def recv(self) -> dict[str, Any] | None:
        return self._inbound.pop(0) if self._inbound else None

    def close(self) -> None:
        pass


class _WebSocketRealtimeTransport:
    """Real realtime transport over the optional `websocket-client` dependency."""

    def __init__(self, url: str, headers: list[str], timeout: float | None):
        try:
            import websocket  # websocket-client
        except ImportError as exc:
            raise RuntimeError(
                "realtime audio requires the optional dependency 'websocket-client' "
                "(install axllm[realtime]) or pass a custom transport"
            ) from exc
        self._websocket = websocket
        self._ws = websocket.create_connection(url, header=headers, timeout=timeout or 30)
        self._ws.settimeout(timeout or 30)
        self.sent: list[dict[str, Any]] = []

    def send(self, event: dict[str, Any]) -> None:
        self.sent.append(event)
        self._ws.send(json.dumps(event))

    def recv(self) -> dict[str, Any] | None:
        try:
            raw = self._ws.recv()
        except self._websocket.WebSocketTimeoutException:
            return None
        if not raw:
            return None
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8")
        return json.loads(raw)

    def close(self) -> None:
        try:
            self._ws.close()
        except Exception:
            pass


class AxAIService(ABC):
    @abstractmethod
    def get_id(self) -> str:
        ...

    @abstractmethod
    def get_name(self) -> str:
        ...

    @abstractmethod
    def get_features(self, model: str | None = None) -> dict[str, Any]:
        ...

    def get_model_list(self):
        return []

    @abstractmethod
    def get_metrics(self) -> dict[str, Any]:
        ...

    def get_logger(self):
        return lambda _message: None

    def get_last_used_chat_model(self):
        return None

    def get_last_used_embed_model(self):
        return None

    def get_last_used_model_config(self):
        return None

    @abstractmethod
    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        ...

    def chat_with_hooks(self, request: dict[str, Any], options: dict[str, Any] | None, hooks: AxRuntimeHooks):
        return self.chat(request, {**(options or {}), "runtime_hooks": hooks})

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        stream_request = copy.deepcopy(_coerce_chat_request(request))
        stream_request.setdefault("model_config", {})["stream"] = True
        result = self.chat(stream_request, {**(options or {}), "stream": True})
        if isinstance(result, dict):
            yield result
        else:
            yield from result

    def stream_with_hooks(self, request: dict[str, Any], options: dict[str, Any] | None, hooks: AxRuntimeHooks):
        return self.stream(request, {**(options or {}), "runtime_hooks": hooks})

    @abstractmethod
    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        ...

    def embed_with_hooks(self, request: dict[str, Any], options: dict[str, Any] | None, hooks: AxRuntimeHooks):
        return self.embed(request, {**(options or {}), "runtime_hooks": hooks})

    @abstractmethod
    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        ...

    @abstractmethod
    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        ...

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        return 0.0

    @abstractmethod
    def set_options(self, options: dict[str, Any]):
        ...

    @abstractmethod
    def get_options(self) -> dict[str, Any]:
        ...

    def complete(self, request: dict[str, Any]) -> dict[str, Any]:
        return chat_response_to_completion(self.chat(_coerce_chat_request(request)))


class AIClient(AxAIService):
    pass


class AxBaseAI(AIClient):
    def __init__(
        self,
        *,
        name: str,
        model: str,
        embed_model: str | None = None,
        model_config: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
        features: dict[str, Any] | None = None,
    ):
        if not model:
            raise ValueError("No model defined")
        self.name = name
        self.id = str(uuid.uuid4())
        self.model = model
        self.embed_model = embed_model
        self.model_config = {"temperature": 0, **(model_config or {})}
        self.runtime_hooks = _runtime_hooks_from_options(options)
        self.options = _strip_runtime_hooks(options)
        self.features = copy.deepcopy(features or default_features())
        self.metrics = default_metrics()
        self.last_used_chat_model = None
        self.last_used_embed_model = None
        self.last_used_model_config = None
        self.last_model_usage = None

    def get_id(self) -> str:
        return self.id

    def get_name(self) -> str:
        return self.name

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        return copy.deepcopy(self.features)

    def get_model_list(self):
        models = []
        if self.model:
            models.append({"key": self.model, "description": f"{self.name} chat model", "model": self.model})
        if self.embed_model:
            models.append({"key": self.embed_model, "description": f"{self.name} embed model", "embedModel": self.embed_model})
        return models

    def get_metrics(self) -> dict[str, Any]:
        return copy.deepcopy(self.metrics)

    def get_last_used_chat_model(self):
        return self.last_used_chat_model

    def get_last_used_embed_model(self):
        return self.last_used_embed_model

    def get_last_used_model_config(self):
        return copy.deepcopy(self.last_used_model_config)

    def set_options(self, options: dict[str, Any]):
        if any(key in options for key in ("runtime_hooks", "runtimeHooks", "rate_limiter", "rateLimiter", "tracer", "meter")):
            self.runtime_hooks = _runtime_hooks_from_options(options)
        self.options = _strip_runtime_hooks(options)

    def set_rate_limiter(self, limiter: AxRateLimiter | None):
        self.runtime_hooks = AxRuntimeHooks(limiter, self.runtime_hooks.tracer, self.runtime_hooks.meter)
        return self

    def set_tracer(self, tracer: AxTracer | None):
        self.runtime_hooks = AxRuntimeHooks(self.runtime_hooks.rate_limiter, tracer, self.runtime_hooks.meter)
        return self

    def set_meter(self, meter: AxMeter | None):
        self.runtime_hooks = AxRuntimeHooks(self.runtime_hooks.rate_limiter, self.runtime_hooks.tracer, meter)
        return self

    def get_options(self) -> dict[str, Any]:
        return copy.deepcopy(self.options)

    def _merged_options(self, options: dict[str, Any] | None = None) -> dict[str, Any]:
        call_options = _strip_runtime_hooks(options)
        merged = {**self.options, **call_options}
        default_context = self.options.get("usage_context") or self.options.get("usageContext")
        call_context = call_options.get("usage_context") or call_options.get("usageContext")
        context = merge_usage_context(default_context, call_context)
        if context:
            merged["usage_context"] = context
            merged["usageContext"] = context
        return merged

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        started = time.perf_counter()
        is_error = False
        span = None
        stream_returned = False
        hooks = _effective_runtime_hooks(options, self.runtime_hooks)
        try:
            req = _coerce_chat_request(request)
            validate_chat_request(req)
            merged_options = self._merged_options(options)
            model = req.get("model") or self.model
            model_config = merge_model_config(self.model_config, req.get("model_config"), merged_options)
            if merged_options.get("stream") is not None:
                model_config["stream"] = bool(merged_options["stream"])
            req = {**req, "model": model, "model_config": model_config}
            self.last_used_chat_model = model
            self.last_used_model_config = copy.deepcopy(model_config)
            streaming = bool(model_config.get("stream"))
            attributes = {"ax.operation": "chat", "ax.ai": self.name, "ax.model": str(model), "ax.streaming": streaming}
            span = _start_runtime_span(hooks, "ax_llm_chat", "client", attributes)
            _record_runtime_metric(hooks.meter, "counter", "ax_llm_requests_total", 1, attributes)
            info = AxRateLimitInfo("chat", self.name, str(model), streaming, copy.deepcopy(self.last_model_usage))
            response = _invoke_rate_limiter(hooks.rate_limiter, lambda: self._chat(req, merged_options), info)
            if isinstance(response, dict):
                self.last_model_usage = copy.deepcopy(response.get("model_usage") or response.get("modelUsage"))
                _emit_usage_event("chat", response, merged_options, False)
                _record_runtime_metric(hooks.meter, "histogram", "ax_llm_request_duration_ms", (time.perf_counter() - started) * 1000, attributes)
                _finish_runtime_span(span)
                return response
            stream_returned = True
            return _runtime_observed_stream(response, merged_options, span, hooks.meter, attributes, started)
        except Exception as exc:
            is_error = True
            if span is not None:
                attributes = {"ax.operation": "chat", "ax.ai": self.name, "ax.model": str(self.last_used_chat_model or self.model), "ax.streaming": bool((options or {}).get("stream"))}
                _record_runtime_metric(hooks.meter, "counter", "ax_llm_errors_total", 1, attributes)
                _record_runtime_metric(hooks.meter, "histogram", "ax_llm_request_duration_ms", (time.perf_counter() - started) * 1000, attributes)
                _finish_runtime_span(span, exc)
            raise
        finally:
            self._record_metrics("chat", time.perf_counter() - started, is_error)

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        started = time.perf_counter()
        is_error = False
        span = None
        hooks = _effective_runtime_hooks(options, self.runtime_hooks)
        try:
            texts = request.get("texts")
            if not texts:
                raise AxAIServiceResponseError("Embed texts is empty")
            embed_model = request.get("embed_model") or request.get("embedModel") or self.embed_model
            if not embed_model:
                raise AxAIServiceResponseError("Embed model not set")
            req = {**request, "texts": list(texts), "embed_model": embed_model}
            self.last_used_embed_model = embed_model
            merged_options = self._merged_options(options)
            attributes = {"ax.operation": "embed", "ax.ai": self.name, "ax.model": str(embed_model), "ax.streaming": False}
            span = _start_runtime_span(hooks, "ax_llm_embed", "client", attributes)
            _record_runtime_metric(hooks.meter, "counter", "ax_llm_requests_total", 1, attributes)
            info = AxRateLimitInfo("embed", self.name, str(embed_model), False, copy.deepcopy(self.last_model_usage))
            response = _invoke_rate_limiter(hooks.rate_limiter, lambda: self._embed(req, merged_options), info)
            self.last_model_usage = copy.deepcopy(response.get("model_usage") or response.get("modelUsage")) if isinstance(response, dict) else None
            _emit_usage_event("embed", response, merged_options, False)
            _record_runtime_metric(hooks.meter, "histogram", "ax_llm_request_duration_ms", (time.perf_counter() - started) * 1000, attributes)
            _finish_runtime_span(span)
            return response
        except Exception as exc:
            is_error = True
            attributes = {"ax.operation": "embed", "ax.ai": self.name, "ax.model": str(self.last_used_embed_model or self.embed_model or ""), "ax.streaming": False}
            _record_runtime_metric(hooks.meter, "counter", "ax_llm_errors_total", 1, attributes)
            _record_runtime_metric(hooks.meter, "histogram", "ax_llm_request_duration_ms", (time.perf_counter() - started) * 1000, attributes)
            _finish_runtime_span(span, exc)
            raise
        finally:
            self._record_metrics("embed", time.perf_counter() - started, is_error)

    @abstractmethod
    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        ...

    @abstractmethod
    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        ...

    def _record_metrics(self, kind: str, duration_seconds: float, is_error: bool):
        bucket = self.metrics["latency"][kind]
        bucket["samples"].append(duration_seconds * 1000)
        samples = bucket["samples"]
        bucket["mean"] = sum(samples) / len(samples)
        ordered = sorted(samples)
        bucket["p95"] = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
        bucket["p99"] = ordered[min(len(ordered) - 1, int(len(ordered) * 0.99))]
        errors = self.metrics["errors"][kind]
        errors["total"] += 1
        if is_error:
            errors["count"] += 1
        errors["rate"] = errors["count"] / errors["total"] if errors["total"] else 0.0


class ProviderOperationClient(AxBaseAI):
    def __init__(
        self,
        profile: str,
        name: str,
        model: str = "gpt-4.1-mini",
        embed_model: str = "text-embedding-3-small",
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 60.0,
        api_version: str | None = None,
        options: dict[str, Any] | None = None,
        model_config: dict[str, Any] | None = None,
        transport: Callable[[dict[str, Any]], Any] | None = None,
        credential_provider: Callable[[dict[str, str]], dict[str, str]] | None = None,
        credentialProvider: Callable[[dict[str, str]], dict[str, str]] | None = None,
        usage_context: AxUsageContext | None = None,
        usageContext: AxUsageContext | None = None,
        **runtime_options,
    ):
        service_options = {**(options or {}), **runtime_options}
        if api_version is not None:
            service_options["api_version"] = api_version
        descriptor = provider_resolve_descriptor(profile, service_options)
        context = usage_context or usageContext
        if context:
            service_options["usage_context"] = copy.deepcopy(context)
            service_options["usageContext"] = copy.deepcopy(context)
        super().__init__(
            name=name,
            model=model,
            embed_model=embed_model,
            model_config=model_config,
            options=service_options,
            features=descriptor.get("features") or default_features(),
        )
        self.profile = profile
        self.descriptor = descriptor
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or descriptor.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.credential_provider = credential_provider or credentialProvider
        if self.descriptor.get("authRequired") and not self.api_key and not self.credential_provider:
            raise AxAIServiceAuthenticationError(
                f"{self.profile} requires api_key or credential_provider"
            )
        self.api_version = descriptor.get("apiVersion") or api_version
        self.timeout = timeout
        self.transport = transport
        self._context_cache_entries: dict[str, dict[str, Any]] = {}

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        return False

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        model_info = self.options.get("modelInfo", self.options.get("model_info"))
        return float(provider_estimate_cost(model_usage or {}, model_info))

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        return copy.deepcopy(
            provider_resolve_features(
                self.profile,
                str(model or self.model),
                self.options,
            )
        )

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        realtime_model = request.get("model") or self.model
        if provider_should_use_realtime(self.profile, str(realtime_model or ""), request, options):
            return self.realtime_chat(request, options)
        payload = provider_build_chat_request(self.profile, request, options)
        if payload.get("stream"):
            return self._stream_chat(payload, request, options)
        model = request.get("model") or payload.get("model") or self.model
        endpoint = self._operation_path("chat", model)
        raw = self._context_cache_chat(request, payload, model, endpoint, options)
        if raw is None:
            operation = "responses" if self.descriptor.get("transport") == "openai-responses" else "chat"
            raw = self._request_json(endpoint, payload, stream=False, method=self._operation_method("chat"), operation=operation)
        return provider_normalize_chat_response(self.profile, raw, self.name, model)

    def _context_cache_chat(self, request, payload, model, endpoint, options):
        cfg = (options or {}).get("contextCache", (options or {}).get("context_cache"))
        supported = bool((((self.descriptor.get("features") or {}).get("caching") or {}).get("supported")))
        if self.profile != "google-gemini" or not supported or not cfg:
            return None
        if cfg is True:
            cfg = {}
        if not isinstance(cfg, dict):
            return None
        explicit = str(cfg.get("name") or cfg.get("cacheName") or cfg.get("cache_name") or "")
        if explicit:
            cached_payload = copy.deepcopy(payload)
            cached_payload["cachedContent"] = explicit
            return self._request_json(endpoint, cached_payload, stream=False, method=self._operation_method("chat"))

        prompts = request.get("chat_prompt") or request.get("chatPrompt") or request.get("messages") or []
        non_system_seen = 0
        cached_content_count = 0
        for prompt in prompts if isinstance(prompts, list) else []:
            if not isinstance(prompt, dict) or prompt.get("role") == "system":
                continue
            non_system_seen += 1
            if prompt.get("cache") is True:
                cached_content_count = non_system_seen
        cache_body = {}
        for key in ("systemInstruction", "tools", "toolConfig"):
            if key in payload:
                cache_body[key] = copy.deepcopy(payload[key])
        contents = list(payload.get("contents") or [])
        if cached_content_count:
            cache_body["contents"] = copy.deepcopy(contents[:cached_content_count])
        if not cache_body.get("systemInstruction") and not cache_body.get("contents"):
            return None
        min_tokens = int(cfg.get("minTokens", cfg.get("min_tokens", 2048)))
        encoded = json.dumps(cache_body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        eligible = math.ceil(len(encoded) / 4) >= min_tokens
        ttl_seconds = int(cfg.get("ttlSeconds", cfg.get("ttl_seconds", 3600)))
        refresh_window_ms = int(float(cfg.get("refreshWindowSeconds", cfg.get("refresh_window_seconds", 300))) * 1000)
        content_hash = hashlib.sha256(encoded.encode()).hexdigest()
        cache_key = f"{self.profile}:{model}:{content_hash}"
        namespace = str(cfg.get("namespace") or "default")
        registry = cfg.get("registry")

        def registry_call(name, *args):
            callback = registry.get(name) if isinstance(registry, dict) else getattr(registry, name, None)
            return callback(*args) if callable(callback) else None

        external = registry is not None
        entry = registry_call("get", namespace, cache_key) if external else self._context_cache_entries.get(cache_key)
        entry = copy.deepcopy(entry) if isinstance(entry, dict) else {}
        now = int(time.time() * 1000)
        plan = ai_context_cache_plan(True, True, "", entry, now, refresh_window_ms, eligible)

        def save(value):
            if external:
                registry_call("set", namespace, cache_key, copy.deepcopy(value))
            else:
                self._context_cache_entries[cache_key] = copy.deepcopy(value)

        def expiry(value):
            raw = (value or {}).get("expireTime") or (value or {}).get("expire_time")
            parsed = 0
            if isinstance(raw, (int, float)):
                parsed = int(raw)
            elif isinstance(raw, str):
                try:
                    parsed = int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp() * 1000)
                except ValueError:
                    pass
            return ai_context_cache_expiry(parsed, int(time.time() * 1000))

        api_key = self.api_key or ""
        cache_name = str(plan.get("cacheName") or "")
        try:
            if plan.get("action") == "refresh":
                ops = ai_gemini_cache_ops(cache_name, ttl_seconds, api_key, str(model), cache_body, options)
                refreshed = self._request_json(ops["update"]["path"], ops["update"]["request"], stream=False, method=ops["update"]["method"], base_url=ops["update"].get("base_url"))
                expires_at = expiry(refreshed)
                if not expires_at:
                    raise AxAIServiceResponseError("Gemini cache refresh omitted a future expireTime", response_body=refreshed)
                save({"cacheName": cache_name, "expiresAt": expires_at})
            if plan.get("action") in ("create", "refresh") and (plan.get("action") == "create" or not cache_name):
                ops = ai_gemini_cache_ops("", ttl_seconds, api_key, str(model), cache_body, options)
                created = self._request_json(ops["create"]["path"], ops["create"]["request"], stream=False, method=ops["create"]["method"], base_url=ops["create"].get("base_url"))
                cache_name = str((created or {}).get("name") or "")
                expires_at = expiry(created)
                if not cache_name or not expires_at:
                    raise AxAIServiceResponseError("Gemini cache creation omitted name or future expireTime", response_body=created)
                save({"cacheName": cache_name, "expiresAt": expires_at})
        except AxAIServiceError:
            if plan.get("action") == "refresh":
                try:
                    ops = ai_gemini_cache_ops("", ttl_seconds, api_key, str(model), cache_body, options)
                    created = self._request_json(ops["create"]["path"], ops["create"]["request"], stream=False, method=ops["create"]["method"], base_url=ops["create"].get("base_url"))
                    cache_name = str((created or {}).get("name") or "")
                    expires_at = expiry(created)
                    if not cache_name or not expires_at:
                        raise AxAIServiceResponseError("Gemini cache recreation omitted name or future expireTime", response_body=created)
                    save({"cacheName": cache_name, "expiresAt": expires_at})
                except AxAIServiceError:
                    return self._request_json(endpoint, payload, stream=False, method=self._operation_method("chat"))
            else:
                return self._request_json(endpoint, payload, stream=False, method=self._operation_method("chat"))
        if not cache_name:
            return None
        cached_payload = copy.deepcopy(payload)
        cached_payload.pop("systemInstruction", None)
        cached_payload["contents"] = contents[cached_content_count:]
        cached_payload.pop("tools", None)
        cached_payload.pop("toolConfig", None)
        cached_payload["cachedContent"] = cache_name
        try:
            return self._request_json(endpoint, cached_payload, stream=False, method=self._operation_method("chat"))
        except AxAIServiceError as error:
            if not ai_context_cache_rejection(error.status or 0, error.response_body):
                raise
            current = registry_call("get", namespace, cache_key) if external else self._context_cache_entries.get(cache_key)
            recovery = ai_context_cache_recovery(current or {}, cache_name, external)
            if recovery.get("invalidated"):
                if external:
                    registry_call("set", namespace, cache_key, recovery.get("externalEntry"))
                elif recovery.get("deleteInMemory"):
                    self._context_cache_entries.pop(cache_key, None)
            return self._request_json(endpoint, payload, stream=False, method=self._operation_method("chat"))

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        req = _coerce_chat_request(request)
        req.setdefault("model_config", {})["stream"] = True
        validate_chat_request(req)
        merged_options = {**self._merged_options(options), "stream": True}
        model = req.get("model") or self.model
        model_config = merge_model_config(self.model_config, req.get("model_config"), merged_options)
        model_config["stream"] = True
        req = {**req, "model": model, "model_config": model_config}
        self.last_used_chat_model = model
        self.last_used_model_config = copy.deepcopy(model_config)
        payload = provider_build_chat_request(self.profile, req, merged_options)
        hooks = _effective_runtime_hooks(options, self.runtime_hooks)
        attributes = {"ax.operation": "chat", "ax.ai": self.name, "ax.model": str(model), "ax.streaming": True}
        span = _start_runtime_span(hooks, "ax_llm_chat", "client", attributes)
        _record_runtime_metric(hooks.meter, "counter", "ax_llm_requests_total", 1, attributes)
        started = time.perf_counter()
        info = AxRateLimitInfo("chat", self.name, str(model), True, copy.deepcopy(self.last_model_usage))
        try:
            result = _invoke_rate_limiter(hooks.rate_limiter, lambda: self._stream_chat(payload, req, merged_options), info)
        except BaseException as exc:
            _record_runtime_metric(hooks.meter, "counter", "ax_llm_errors_total", 1, attributes)
            _record_runtime_metric(hooks.meter, "histogram", "ax_llm_request_duration_ms", (time.perf_counter() - started) * 1000, attributes)
            _finish_runtime_span(span, exc)
            raise
        yield from _runtime_observed_stream(result, merged_options, span, hooks.meter, attributes, started)

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        payload = provider_build_embed_request(self.profile, request, options)
        model = request.get("embed_model") or request.get("embedModel") or payload.get("model") or self.embed_model
        endpoint = self._operation_path("embed", model)
        raw = self._request_json(endpoint, payload, stream=False, method=self._operation_method("embed"), operation="embed")
        return provider_normalize_embed_response(self.profile, raw, self.name, model)

    def _stream_chat(self, payload: dict[str, Any], request: dict[str, Any], options: dict[str, Any] | None = None):
        model = request.get("model") or payload.get("model") or self.model
        endpoint = self._operation_path("stream_chat", model)
        cfg = resolve_stream_retry(options or {})
        max_retries = int(cfg["max_retries"])
        initial_delay = float(cfg["initial_delay_ms"])
        max_delay = float(cfg["max_delay_ms"])
        backoff = float(cfg["backoff_factor"])
        attempt = 0
        sentinel = object()
        while True:
            # Pre-content streaming retry: peek the first raw SSE event before any stateful
            # normalize runs (so peeking has no side effects). If the provider classifies it as
            # a retryable transient status (e.g. Anthropic's HTTP-200 overloaded_error event),
            # re-issue with the same exponential backoff apiCall uses for a 529 before surfacing.
            events = None
            try:
                raw = self._request_json(endpoint, payload, stream=True, method=self._operation_method("stream_chat"), operation="stream_chat")
                events = _iter_sse_json(raw)
                first = next(events, sentinel)
            except AxAIServiceError as error:
                if _is_retryable_ai_error(error) and attempt < max_retries:
                    attempt += 1
                    delay = min(initial_delay * (backoff ** (attempt - 1)), max_delay)
                    if delay > 0:
                        time.sleep(delay / 1000.0)
                    continue
                raise
            if first is not sentinel:
                status = provider_classify_stream_error_status(self.profile, first)
                if status is not None and is_retryable_status(status) and attempt < max_retries:
                    close = getattr(events, "close", None)
                    if callable(close):
                        close()
                    attempt += 1
                    delay = min(initial_delay * (backoff ** (attempt - 1)), max_delay)
                    if delay > 0:
                        time.sleep(delay / 1000.0)
                    continue
            state: dict[str, Any] = {}
            try:
                if first is not sentinel:
                    yield provider_normalize_stream_delta(self.profile, first, state, self.name, model)
                    for event in events:
                        yield provider_normalize_stream_delta(self.profile, event, state, self.name, model)
            finally:
                close = getattr(events, "close", None)
                if callable(close):
                    close()
            return

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        payload = provider_build_transcribe_request(self.profile, request)
        model = request.get("model") or self.model
        descriptor = provider_operation_descriptor(self.profile, "transcribe")
        body_key = "data" if descriptor.get("body") == "multipart" else "json"
        raw = self._request_json(self._operation_path("transcribe", model), payload, stream=False, body_key=body_key, method=self._operation_method("transcribe"), operation="transcribe")
        return provider_normalize_transcribe_response(self.profile, raw)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        payload = provider_build_speak_request(self.profile, request)
        model = request.get("model") or self.model
        descriptor = provider_operation_descriptor(self.profile, "speak")
        body_key = "data" if descriptor.get("body") == "multipart" else "json"
        binary_response = descriptor.get("response") == "binary"
        raw = self._request_json(self._operation_path("speak", model), payload, stream=False, body_key=body_key, binary_response=binary_response, method=self._operation_method("speak"), operation="speak")
        return provider_normalize_speak_response(self.profile, raw, request)

    def realtime(self, events: Iterable[dict[str, Any]], model: str | None = None):
        state: dict[str, Any] = {}
        for event in events:
            yield provider_normalize_realtime_event(self.profile, event, state, self.name, model or self.model)

    def realtime_audio_setup(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        return provider_build_realtime_audio_setup(self.profile, request, self._merged_options(options))

    def realtime_audio_input(self, request: dict[str, Any]):
        return provider_build_realtime_audio_input(self.profile, request)

    def realtime_chat(self, request: dict[str, Any], options: dict[str, Any] | None = None, *, transport: Any = None):
        """Drive a realtime audio turn over a WebSocket transport: send the
        Core-built session setup + input events, fold the inbound event stream
        through the shared realtime codec, and return the final response. Pass a
        ScriptedRealtimeTransport to exercise the loop offline without a socket."""
        model = request.get("model") or self.model
        setup = provider_build_realtime_audio_setup(self.profile, request, self._merged_options(options))
        inputs = provider_build_realtime_audio_input(self.profile, request)
        own_transport = transport is None
        if transport is None:
            url, headers = self._realtime_ws_target(model)
            transport = _WebSocketRealtimeTransport(url, headers, self.timeout)
        events: list[dict[str, Any]] = []
        try:
            transport.send(setup)
            input_sent = False
            while True:
                event = transport.recv()
                if event is None:
                    break
                if event.get("type") == "error":
                    detail = event.get("error") or {}
                    raise AxAIServiceError(detail.get("message") or "realtime error", code=detail.get("code"))
                if _realtime_event_is_ready(event):
                    if not input_sent:
                        input_sent = True
                        for item in inputs:
                            transport.send(item)
                    continue
                events.append(event)
                if _realtime_event_is_done(event):
                    break
        finally:
            if own_transport:
                transport.close()
        # Fold the per-delta normalize results into one turn response: concat the
        # transcript/text content and base64-concat the audio chunks (mirrors the
        # TS makeChatResponse; base64 join can't live in Core, so it stays here).
        state: dict[str, Any] = {}
        contents: list[str] = []
        audio_chunks: list[str] = []
        function_calls: list[Any] = []
        response_id = None
        finish_reason = None
        model_usage = None
        for event in events:
            out = provider_normalize_realtime_event(self.profile, event, state, self.name, model)
            result = out["results"][0]
            if result.get("content"):
                contents.append(result["content"])
            audio = result.get("audio")
            if audio and audio.get("data"):
                audio_chunks.append(audio["data"])
            if result.get("function_calls"):
                function_calls.extend(result["function_calls"])
            if result.get("finish_reason"):
                finish_reason = result["finish_reason"]
            remote_id = out.get("remote_id") or result.get("id")
            if remote_id and remote_id != "0":
                response_id = remote_id
            if out.get("model_usage"):
                model_usage = out["model_usage"]
        text = "".join(contents)
        merged: dict[str, Any] = {
            "index": 0,
            "id": response_id or "realtime",
            "content": text,
            "function_calls": function_calls,
            "finish_reason": finish_reason or "stop",
        }
        if audio_chunks:
            combined = base64.b64encode(b"".join(base64.b64decode(chunk) for chunk in audio_chunks)).decode()
            merged["audio"] = {"data": combined, "format": "pcm16", "transcript": text}
        return {"results": [merged], "remote_id": response_id, "model_usage": model_usage}

    def _realtime_ws_target(self, model: str | None):
        # Grammar-specific URL + auth construction lives in Core so the client
        # stays provider-agnostic.
        target = provider_realtime_ws_url(self.profile, str(model or ""), self.api_key or "")
        headers = [f"{key}: {value}" for key, value in (target.get("headers") or {}).items()]
        return target.get("url", ""), headers

    def _operation_path(self, operation: str, model: str | None = None):
        descriptor = (self.descriptor.get("operations") or {}).get(operation) or provider_operation_descriptor(self.profile, operation)
        path = str(descriptor.get("path", "/" + operation))
        if model is not None:
            path = path.replace("{model}", urllib.parse.quote(str(model), safe=""))
        if self.descriptor.get("auth") == "api_key_query":
            key_name = self.descriptor.get("apiKeyQuery") or "key"
            separator = "&" if "?" in path else "?"
            path += separator + urllib.parse.quote(str(key_name), safe="") + "=" + urllib.parse.quote(self.api_key or "", safe="")
        if self.api_version:
            separator = "&" if "?" in path else "?"
            path += separator + "api-version=" + urllib.parse.quote(str(self.api_version), safe="")
        return path

    def _operation_method(self, operation: str) -> str:
        descriptor = (self.descriptor.get("operations") or {}).get(operation) or provider_operation_descriptor(self.profile, operation)
        return str(descriptor.get("method") or "POST").upper()

    def _request_json(self, endpoint: str, payload: dict[str, Any], *, stream: bool, body_key: str = "json", binary_response: bool = False, method: str = "POST", base_url: str | None = None, operation: str = "chat"):
        method = str(method or "POST").upper()
        request_base_url = (base_url or self.base_url).rstrip("/")
        request_url = request_base_url + endpoint
        headers = self._headers()
        if self.credential_provider:
            fresh = self.credential_provider({
                "profile": self.profile,
                "operation": operation,
                "method": method,
                "url": request_url,
            })
            if not isinstance(fresh, dict):
                raise AxAIServiceAuthenticationError(
                    "credential_provider must return a header dictionary"
                )
            headers.update({str(key): str(value) for key, value in fresh.items()})
        call = {
            "method": method,
            "url": request_url,
            "headers": headers,
            body_key: payload,
            "stream": stream,
        }
        if self.transport:
            try:
                return _transport_result(self.transport(call), call)
            except AxAIServiceError:
                raise
            except TimeoutError as exc:
                raise AxAIServiceTimeoutError("OpenAI-compatible request timed out", request=call, retryable=True) from exc
            except OSError as exc:
                raise AxAIServiceNetworkError(str(exc), request=call, retryable=True) from exc
        if not self.api_key:
            raise AxAIServiceAuthenticationError("OPENAI_API_KEY is required")
        request_headers = call["headers"]
        if body_key == "data":
            request_body, multipart_content_type = _encode_multipart(payload)
            request_headers = dict(request_headers)
            request_headers["Content-Type"] = multipart_content_type
        else:
            request_body = json.dumps(payload).encode()
        req = urllib.request.Request(
            call["url"],
            data=request_body,
            headers=request_headers,
            method=method,
        )
        try:
            res = urllib.request.urlopen(req, timeout=self.timeout)
            if stream:
                def body_chunks():
                    try:
                        read = getattr(res, "read1", res.read)
                        while True:
                            chunk = read(8192)
                            if not chunk:
                                return
                            yield chunk
                    except TimeoutError as exc:
                        raise AxAIServiceTimeoutError("OpenAI-compatible request timed out", request=call, retryable=True) from exc
                    except OSError as exc:
                        raise AxAIServiceNetworkError(str(exc), request=call, retryable=True) from exc
                    finally:
                        res.close()
                return body_chunks()
            with res:
                if binary_response:
                    # Binary operations (e.g. OpenAI /audio/speech returns raw mp3)
                    # must not be UTF-8 decoded; return the bytes as base64.
                    return base64.b64encode(res.read()).decode()
                return json.loads(res.read().decode())
        except TimeoutError as exc:
            raise AxAIServiceTimeoutError("OpenAI-compatible request timed out", request=call, retryable=True) from exc
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = body
            raise openai_normalize_error(exc.code, parsed, call) from exc
        except OSError as exc:
            raise AxAIServiceNetworkError(str(exc), request=call, retryable=True) from exc

    def _headers(self):
        headers = {
            "Content-Type": "application/json",
        }
        if self.descriptor.get("auth") == "bearer":
            headers["Authorization"] = "Bearer " + (self.api_key or "")
        if self.descriptor.get("auth") in ("anthropic_key", "x-api-key"):
            headers["x-api-key"] = self.api_key or ""
        if self.descriptor.get("auth") == "api_key_header":
            key_name = self.descriptor.get("apiKeyHeader") or "api-key"
            headers[str(key_name)] = self.api_key or ""
        for key, value in (self.descriptor.get("headers") or {}).items():
            headers[str(key)] = str(value)
        return headers


class OpenAICompatibleClient(ProviderOperationClient):
    def __init__(self, _profile="openai-compatible", **options):
        descriptor = provider_descriptor(_profile)
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", descriptor.get("defaultEmbedModel") or "")
        super().__init__(
            _profile,
            _profile,
            model=options.pop("model", descriptor.get("defaultModel") or ""),
            embed_model=embed_model,
            **options,
        )


class OpenAIResponsesClient(ProviderOperationClient):
    def __init__(self, _profile="openai-responses", **options):
        descriptor = provider_descriptor(_profile)
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", descriptor.get("defaultEmbedModel") or "")
        super().__init__(
            _profile,
            _profile,
            model=options.pop("model", descriptor.get("defaultModel") or ""),
            embed_model=embed_model,
            **options,
        )


class GoogleGeminiClient(ProviderOperationClient):
    def __init__(self, _profile="google-gemini", **options):
        descriptor = provider_descriptor(_profile)
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "gemini-embedding-2")
        is_vertex = bool((options.get("project_id") or options.get("projectId")) and options.get("region"))
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or (os.environ.get("GOOGLE_VERTEX_ACCESS_TOKEN") if is_vertex else None) or os.environ.get("GOOGLE_APIKEY") or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("GOOGLE_GEMINI_BASE_URL")
        super().__init__(
            _profile,
            _profile,
            model=options.pop("model", descriptor.get("defaultModel") or ""),
            embed_model=embed_model,
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class AnthropicClient(ProviderOperationClient):
    def __init__(self, _profile="anthropic", **options):
        descriptor = provider_descriptor(_profile)
        is_vertex = bool((options.get("project_id") or options.get("projectId")) and options.get("region"))
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or (os.environ.get("GOOGLE_VERTEX_ACCESS_TOKEN") if is_vertex else None) or os.environ.get("ANTHROPIC_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("ANTHROPIC_BASE_URL")
        super().__init__(
            _profile,
            _profile,
            model=options.pop("model", descriptor.get("defaultModel") or ""),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


def _normalize_azure_api_version(version: Any) -> str:
    text = str(version or "2024-02-15-preview").strip()
    marker = "api-version="
    if marker in text:
        return text.split(marker, 1)[1].split("&", 1)[0]
    return text


def get_supported_ai_models(model_type: str | None = None):
    options = {} if model_type is None else {"type": model_type}
    return copy.deepcopy(provider_model_catalog(options))


def _router_default_features() -> dict[str, Any]:
    return {
        "functions": False,
        "streaming": False,
        "media": {
            "images": {"supported": False, "formats": []},
            "audio": {"supported": False, "formats": [], "output": {"supported": False, "formats": []}},
            "files": {"supported": False, "formats": [], "uploadMethod": "none"},
            "urls": {"supported": False, "webSearch": False, "contextFetching": False},
        },
        "caching": {"supported": False, "types": []},
        "thinking": False,
        "multiTurn": True,
    }


class MultiServiceRouter(AxAIService):
    def __init__(self, services):
        if not services:
            raise ValueError("No AI services provided.")
        self.services: dict[Any, dict[str, Any]] = {}
        self.options: dict[str, Any] | None = None
        self.last_used_service = None
        for index, item in enumerate(services):
            if isinstance(item, dict) and "key" in item:
                key = item["key"]
                if key in self.services:
                    raise ValueError(f"Duplicate model key: {key}")
                self.services[key] = {
                    "service": item["service"],
                    "description": item.get("description", ""),
                    "isInternal": item.get("isInternal", item.get("is_internal")),
                }
                continue
            service = item
            model_list = service.get_model_list()
            if not model_list:
                raise ValueError(f"Service {index} '{service.get_name()}' has no model list.")
            for entry in model_list:
                key = entry.get("key")
                if key in self.services:
                    other = self.services[key]["service"]
                    raise ValueError(f"Service {index} '{service.get_name()}' has duplicate model key: {key} as service {other.get_name()}")
                if "model" in entry and entry.get("model") is not None:
                    self.services[key] = {"service": service, "description": entry.get("description", ""), "model": entry.get("model")}
                elif "embedModel" in entry and entry.get("embedModel"):
                    self.services[key] = {"service": service, "description": entry.get("description", ""), "embedModel": entry.get("embedModel")}
                elif "embed_model" in entry and entry.get("embed_model"):
                    self.services[key] = {"service": service, "description": entry.get("description", ""), "embedModel": entry.get("embed_model")}
                else:
                    raise ValueError(f"Key {key} in model list for service {index} '{service.get_name()}' is missing a model or embedModel property.")

    @staticmethod
    def create(services):
        return MultiServiceRouter(services)

    def get_id(self) -> str:
        return "MultiServiceRouter:" + ",".join(str(entry["service"].get_id()) for entry in self.services.values())

    def get_name(self) -> str:
        return "MultiServiceRouter"

    def get_model_list(self):
        out = []
        for key, entry in self.services.items():
            if entry.get("isInternal"):
                continue
            item = {"key": key, "description": entry.get("description", "")}
            if "model" in entry:
                item["model"] = entry["model"]
            elif "embedModel" in entry:
                item["embedModel"] = entry["embedModel"]
            else:
                raise ValueError(f"Service {key} has no model or embedModel")
            out.append(item)
        return out

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        if model is not None and model in self.services:
            return copy.deepcopy(self.services[model]["service"].get_features(model))
        return _router_default_features()

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            raise ValueError("Model key must be specified for multi-service")
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for model key: {model_key}")
        self.last_used_service = entry["service"]
        req = copy.deepcopy(request)
        if "modelConfig" in req and "model_config" not in req:
            req["model_config"] = copy.deepcopy(req["modelConfig"])
        if "model" not in entry:
            req.pop("model", None)
            return entry["service"].chat(req, options)
        return entry["service"].chat(req, options)

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            raise ValueError("Model key must be specified for multi-service")
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for model key: {model_key}")
        self.last_used_service = entry["service"]
        req = copy.deepcopy(request)
        if "modelConfig" in req and "model_config" not in req:
            req["model_config"] = copy.deepcopy(req["modelConfig"])
        if "model" not in entry:
            req.pop("model", None)
        return entry["service"].stream(req, options)

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        embed_key = request.get("embedModel", request.get("embed_model"))
        if not embed_key:
            raise ValueError("Embed model key must be specified for multi-service")
        entry = self.services.get(embed_key)
        if entry is None:
            raise ValueError(f"No service found for embed model key: {embed_key}")
        self.last_used_service = entry["service"]
        if "model" not in entry:
            req = copy.deepcopy(request)
            req.pop("embedModel", None)
            req.pop("embed_model", None)
            return entry["service"].embed(req, options)
        return entry["service"].embed(copy.deepcopy(request), options)

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            if not self.services:
                raise ValueError("No AI services provided.")
            service = next(iter(self.services.values()))["service"]
            self.last_used_service = service
            return service.transcribe(request, options)
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for transcription model key: {model_key}")
        self.last_used_service = entry["service"]
        return entry["service"].transcribe(request, options)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        model_key = request.get("model")
        if not model_key:
            if not self.services:
                raise ValueError("No AI services provided.")
            service = next(iter(self.services.values()))["service"]
            self.last_used_service = service
            return service.speak(request, options)
        entry = self.services.get(model_key)
        if entry is None:
            raise ValueError(f"No service found for speech model key: {model_key}")
        self.last_used_service = entry["service"]
        return entry["service"].speak(request, options)

    def get_metrics(self) -> dict[str, Any]:
        service = self.last_used_service or (next(iter(self.services.values()))["service"] if self.services else None)
        if service is None:
            raise ValueError("No service available to get metrics.")
        return service.get_metrics()

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        return self.last_used_service.get_estimated_cost(model_usage) if self.last_used_service else 0.0

    def get_logger(self):
        service = self.last_used_service or (next(iter(self.services.values()))["service"] if self.services else None)
        if service is None:
            raise ValueError("No service available to get logger.")
        return service.get_logger()

    def set_options(self, options: dict[str, Any]):
        for entry in self.services.values():
            entry["service"].set_options(options)
        self.options = dict(options or {})

    def get_options(self) -> dict[str, Any]:
        return dict(self.options or {})

    def get_last_used_chat_model(self):
        return self.last_used_service.get_last_used_chat_model() if self.last_used_service else None

    def get_last_used_embed_model(self):
        return self.last_used_service.get_last_used_embed_model() if self.last_used_service else None

    def get_last_used_model_config(self):
        return self.last_used_service.get_last_used_model_config() if self.last_used_service else None

    def complete(self, request: dict[str, Any]) -> dict[str, Any]:
        return chat_response_to_completion(self.chat(_coerce_chat_request(request)))


def _feature_bool(features: dict[str, Any], key: str, fallback: bool = False) -> bool:
    if key in features:
        return bool(features.get(key))
    snake = {
        "structuredOutputs": "structured_outputs",
        "multiTurn": "multi_turn",
        "functionCot": "function_cot",
        "hasThinkingBudget": "has_thinking_budget",
        "hasShowThoughts": "has_show_thoughts",
    }.get(key)
    if snake and snake in features:
        return bool(features.get(snake))
    return fallback


def _append_unique(left: list[Any], values: list[Any]):
    for value in values or []:
        if value not in left:
            left.append(value)


def _service_latency_score(service: AxAIService) -> float:
    try:
        return float(provider_balancer_metric_score(service.get_metrics()))
    except Exception:
        return 0.0


def _is_retryable_ai_error(exc: AxAIServiceError) -> bool:
    if isinstance(exc, AxAIServiceAuthenticationError):
        return False
    if isinstance(exc, AxAIServiceStatusError):
        return getattr(exc, "status", None) in {408, 429, 500, 502, 503, 504, 529}
    return isinstance(
        exc,
        (
            AxAIServiceNetworkError,
            AxAIServiceResponseError,
            AxAIServiceStreamTerminatedError,
            AxAIServiceTimeoutError,
        ),
    )


AxBalancerStatsKey = dict[str, Any]
AxBalancerRouteStats = dict[str, Any]
AxBalancerStatsObservation = dict[str, Any]
AxBalancerRoutingEvent = dict[str, Any]
AxBalancerCandidateScore = dict[str, Any]
AxBalancerFailureReason = str


class AxBalancerStatsStore(ABC):
    """Shared adaptive-routing state. ``observe`` must be atomic per key."""

    @abstractmethod
    def get(self, key: AxBalancerStatsKey) -> AxBalancerRouteStats | None:
        raise NotImplementedError

    @abstractmethod
    def observe(self, key: AxBalancerStatsKey, observation: AxBalancerStatsObservation) -> None:
        raise NotImplementedError


def create_balancer_route_stats() -> AxBalancerRouteStats:
    return copy.deepcopy(provider_balancer_route_stats())


def update_balancer_route_stats(
    current: AxBalancerRouteStats | None,
    observation: AxBalancerStatsObservation,
) -> AxBalancerRouteStats:
    return copy.deepcopy(provider_balancer_observe_route(current, observation))


def sample_balancer_route_health(
    stats: AxBalancerRouteStats | None,
    deadline_ms: float,
) -> dict[str, float]:
    return copy.deepcopy(provider_balancer_sample_health(stats, deadline_ms))


class AxInMemoryBalancerStatsStore(AxBalancerStatsStore):
    """Thread-safe in-memory adaptive-routing store."""

    def __init__(self):
        self._stats: dict[tuple[str, str, str, str], AxBalancerRouteStats] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(key: AxBalancerStatsKey) -> tuple[str, str, str, str]:
        return (
            str(key["namespace"]),
            str(key["slice"]),
            str(key["logicalModel"]),
            str(key["routeKey"]),
        )

    def get(self, key: AxBalancerStatsKey) -> AxBalancerRouteStats | None:
        with self._lock:
            value = self._stats.get(self._key(key))
            return copy.deepcopy(value) if value is not None else None

    def observe(self, key: AxBalancerStatsKey, observation: AxBalancerStatsObservation) -> None:
        with self._lock:
            encoded = self._key(key)
            self._stats[encoded] = update_balancer_route_stats(self._stats.get(encoded), observation)


@dataclass
class AxBalancerAdaptiveStrategy:
    deadline_ms: float
    bad_outcome_cost: float
    expected_tokens: dict[str, float] | None = None
    estimate_cost: Callable[[dict[str, Any]], float] | None = None
    namespace: str = "default"
    slice: Callable[[dict[str, Any]], str] | None = None
    route_key: Callable[[AxAIService, int], str] | None = None
    stats_store: AxBalancerStatsStore | None = None
    on_routing_event: Callable[[AxBalancerRoutingEvent], Any] | None = None

    def as_options(self) -> dict[str, Any]:
        return {
            "type": "adaptive",
            "deadlineMs": self.deadline_ms,
            "badOutcomeCost": self.bad_outcome_cost,
            "expectedTokens": self.expected_tokens,
            "estimateCost": self.estimate_cost,
            "namespace": self.namespace,
            "slice": self.slice,
            "routeKey": self.route_key,
            "statsStore": self.stats_store,
            "onRoutingEvent": self.on_routing_event,
        }


@dataclass
class AxBalancerOptions:
    strategy: AxBalancerAdaptiveStrategy | dict[str, Any] | str | None = None
    debug: bool = True
    initial_backoff_ms: int = 1000
    max_backoff_ms: int = 32000
    max_retries: int = 3

    def as_options(self) -> dict[str, Any]:
        strategy = self.strategy.as_options() if isinstance(self.strategy, AxBalancerAdaptiveStrategy) else self.strategy
        return {
            "strategy": strategy,
            "debug": self.debug,
            "initialBackoffMs": self.initial_backoff_ms,
            "maxBackoffMs": self.max_backoff_ms,
            "maxRetries": self.max_retries,
        }


class AxBalancer(AxAIService):
    input_order_comparator = "input_order"

    @staticmethod
    def create(services, options: dict[str, Any] | None = None):
        return AxBalancer(services, options)

    def __init__(self, services, options: dict[str, Any] | AxBalancerOptions | None = None):
        if not services:
            raise ValueError("No AI services provided.")
        if isinstance(options, AxBalancerOptions):
            options = options.as_options()
        options = dict(options or {})
        raw_strategy = options.get("strategy")
        if isinstance(raw_strategy, AxBalancerAdaptiveStrategy):
            raw_strategy = raw_strategy.as_options()
            options["strategy"] = raw_strategy
        self.adaptive = self._create_adaptive_state(list(services), raw_strategy) if isinstance(raw_strategy, dict) and raw_strategy.get("type") == "adaptive" else None
        self.policy = provider_balancer_retry_policy(options or {})
        self.debug = bool(self.policy.get("debug", True))
        self.max_retries = int(self.policy.get("maxRetries", 3))
        self.initial_backoff_ms = int(self.policy.get("initialBackoffMs", 1000))
        self.max_backoff_ms = int(self.policy.get("maxBackoffMs", 32000))
        self.service_failures: dict[str, dict[str, Any]] = {}
        self.services = list(services)
        self._validate_models()
        if self.policy.get("strategy") != "input_order":
            self.services.sort(key=_service_latency_score)
        self.current_service_index = 0
        self.current_service = self.services[0]

    def _create_adaptive_state(self, services, strategy):
        normalized = provider_balancer_adaptive_policy(strategy)
        namespace = str(normalized.get("namespace") or "").strip()
        if not namespace:
            raise ValueError("Adaptive namespace must be non-empty.")
        store = strategy.get("statsStore") or strategy.get("stats_store")
        route_key = strategy.get("routeKey") or strategy.get("route_key")
        if store is not None and route_key is None:
            raise ValueError("Adaptive routeKey is required when statsStore is supplied.")
        store = store or AxInMemoryBalancerStatsStore()
        route_keys: dict[int, str] = {}
        seen: set[str] = set()
        for index, service in enumerate(services):
            key = route_key(service, index) if route_key else service.get_id()
            key = provider_balancer_validate_route_key(str(key or ""), list(seen))
            seen.add(key)
            route_keys[id(service)] = key
        return {
            "strategy": strategy,
            "namespace": namespace,
            "store": store,
            "route_keys": route_keys,
            "indices": {id(service): index for index, service in enumerate(services)},
        }

    def _validate_models(self):
        reference = next((service.get_model_list() for service in self.services if service.get_model_list() is not None), None)
        if reference is None:
            return
        reference_keys = {entry.get("key") for entry in reference}
        for index, service in enumerate(self.services):
            model_list = service.get_model_list()
            if model_list is None:
                raise ValueError(f"Service at index {index} ({service.get_name()}) has no model list while another service does.")
            keys = {entry.get("key") for entry in model_list}
            for key in reference_keys:
                if key not in keys:
                    raise ValueError(f"Service at index {index} ({service.get_name()}) is missing model {key!r}")
            for key in keys:
                if key not in reference_keys:
                    raise ValueError(f"Service at index {index} ({service.get_name()}) has extra model {key!r}")

    def _next_service(self, services, current_index: int):
        next_index = current_index + 1
        return (services[next_index] if next_index < len(services) else None, next_index)

    def _reset(self):
        self.current_service_index = 0
        self.current_service = self.services[0]

    def _can_retry_service(self, service: AxAIService) -> bool:
        return service.get_id() not in self.service_failures

    def _handle_failure(self, service: AxAIService, exc: AxAIServiceError):
        failure = self.service_failures.get(service.get_id(), {"retries": 0})
        self.service_failures[service.get_id()] = {"retries": int(failure.get("retries", 0)) + 1}

    def _handle_success(self, service: AxAIService):
        self.service_failures.pop(service.get_id(), None)

    def _candidate_services(self, request: dict[str, Any]):
        candidates = [service for service in self.services if provider_balancer_candidate_allowed(service.get_features(str(request.get("model"))) or {}, request)]
        if candidates:
            return candidates
        requirements = []
        if (request.get("responseFormat") or request.get("response_format") or {}).get("type") == "json_schema":
            requirements.append("structured outputs")
        caps = request.get("capabilities") or {}
        if caps.get("requiresImages") or caps.get("requires_images"):
            requirements.append("images")
        if caps.get("requiresAudio") or caps.get("requires_audio"):
            requirements.append("audio")
        raise ValueError(f"No services available that support required capabilities: {', '.join(requirements)}.")

    def _emit_routing_event(self, event: AxBalancerRoutingEvent):
        if self.adaptive is None:
            return
        callback = self.adaptive["strategy"].get("onRoutingEvent") or self.adaptive["strategy"].get("on_routing_event")
        if callback is None:
            return
        try:
            callback(copy.deepcopy(event))
        except Exception:
            pass

    def _adaptive_stats(self, key: AxBalancerStatsKey):
        try:
            return self.adaptive["store"].get(key)
        except Exception as error:
            self._emit_routing_event({
                "type": "store-error", **{name: key[name] for name in ("namespace", "slice", "logicalModel")},
                "operation": "get", "routeKey": key["routeKey"], "errorType": type(error).__name__,
            })
            return None

    def _adaptive_observe(self, candidate, observation, *, streaming=False, reason=None, status=None):
        try:
            self.adaptive["store"].observe(candidate["stats_key"], observation)
        except Exception as error:
            key = candidate["stats_key"]
            self._emit_routing_event({
                "type": "store-error", **{name: key[name] for name in ("namespace", "slice", "logicalModel")},
                "operation": "observe", "routeKey": key["routeKey"], "errorType": type(error).__name__,
            })
        key = candidate["stats_key"]
        self._emit_routing_event({
            "type": "observation", **{name: key[name] for name in ("namespace", "slice", "logicalModel")},
            "routeKey": candidate["route_key"], "serviceName": candidate["service"].get_name(),
            "outcome": observation["outcome"], "latencyMs": observation.get("latencyMs"),
            "streaming": streaming, "reason": reason, "status": status,
        })

    @staticmethod
    def _failure_reason(error):
        if isinstance(error, AxAIServiceStatusError): return "status"
        if isinstance(error, AxAIServiceNetworkError): return "network"
        if isinstance(error, AxAIServiceResponseError): return "response"
        if isinstance(error, AxAIServiceStreamTerminatedError): return "stream-terminated"
        if isinstance(error, AxAIServiceTimeoutError): return "timeout"
        return None

    def _adaptive_cost(self, service, route_key, request):
        strategy = self.adaptive["strategy"]
        logical_model = str(request.get("model") or "default")
        resolved_model = logical_model
        for entry in service.get_model_list() or []:
            if entry.get("key") == request.get("model"):
                resolved_model = str(entry.get("model") or logical_model)
                break
        expected = strategy.get("expectedTokens") or strategy.get("expected_tokens")
        context = {
            "service": service,
            "serviceIndex": self.adaptive["indices"][id(service)],
            "routeKey": route_key,
            "logicalModel": logical_model,
            "resolvedModel": resolved_model,
            "expectedTokens": expected,
        }
        estimate = strategy.get("estimateCost") or strategy.get("estimate_cost")
        if estimate:
            cost = float(estimate(context))
        else:
            prompt = float((expected or {}).get("promptTokens", (expected or {}).get("prompt_tokens", 0)) or 0)
            completion = float((expected or {}).get("completionTokens", (expected or {}).get("completion_tokens", 0)) or 0)
            usage = None if expected is None else {
                "ai": service.get_name(), "model": resolved_model,
                "tokens": {"promptTokens": prompt, "completionTokens": completion, "totalTokens": prompt + completion},
            }
            cost = float(service.get_estimated_cost(usage) or 0)
        if not math.isfinite(cost) or cost < 0:
            raise ValueError(f"Adaptive estimated cost for route {route_key!r} must be finite and non-negative.")
        return cost

    def _rank_adaptive(self, request, options):
        candidates = self._candidate_services(request)
        strategy = self.adaptive["strategy"]
        logical_model = str(request.get("model") or "default")
        slice_callback = strategy.get("slice")
        slice_value = slice_callback({"model": request.get("model"), "options": options}) if slice_callback else "default"
        slice_value = str(slice_value or "").strip()
        if not slice_value:
            raise ValueError("Adaptive slice must be non-empty.")
        ranked = []
        for order, service in enumerate(candidates):
            route_key = self.adaptive["route_keys"][id(service)]
            stats_key = {"namespace": self.adaptive["namespace"], "slice": slice_value, "logicalModel": logical_model, "routeKey": route_key}
            health = sample_balancer_route_health(self._adaptive_stats(stats_key), float(strategy.get("deadlineMs", strategy.get("deadline_ms"))))
            estimated_cost = self._adaptive_cost(service, route_key, request)
            failure = float(health["failureProbability"])
            late = float(health["deadlineMissProbability"])
            score = float(provider_balancer_adaptive_score(estimated_cost, float(strategy.get("badOutcomeCost", strategy.get("bad_outcome_cost"))), failure, late))
            ranked.append({"service": service, "order": order, "route_key": route_key, "stats_key": stats_key, "score": score, "estimated_cost": estimated_cost, "failure": failure, "late": late})
        ranked_by_key = {value["route_key"]: value for value in ranked}
        ranked = [ranked_by_key[value["routeKey"]] for value in provider_balancer_rank_candidates([
            {"routeKey": value["route_key"], "score": value["score"], "order": value["order"]}
            for value in ranked
        ])]
        base = {"namespace": self.adaptive["namespace"], "slice": slice_value, "logicalModel": logical_model}
        self._emit_routing_event({"type": "ranked", **base, "candidates": [
            {"routeKey": item["route_key"], "serviceName": item["service"].get_name(), "score": item["score"],
             "estimatedCost": item["estimated_cost"], "failureProbability": item["failure"], "deadlineMissProbability": item["late"]}
            for item in ranked
        ]})
        return ranked

    def _adaptive_invoke(self, method, request, options):
        ranked = self._rank_adaptive(request, options)
        last_error = None
        for attempt, candidate in enumerate(ranked, 1):
            service = candidate["service"]
            self.current_service = service
            key = candidate["stats_key"]
            base = {name: key[name] for name in ("namespace", "slice", "logicalModel")}
            self._emit_routing_event({"type": "selected", **base, "routeKey": candidate["route_key"], "serviceName": service.get_name(), "attempt": attempt})
            started = time.monotonic()
            try:
                response = getattr(service, method)(request, options)
                if method == "stream":
                    response = list(response)
                latency = max(1.0, (time.monotonic() - started) * 1000)
                self._adaptive_observe(candidate, {"outcome": "success", "latencyMs": latency}, streaming=method == "stream")
                return response
            except AxAIServiceError as error:
                if not _is_retryable_ai_error(error):
                    raise
                last_error = error
                reason = self._failure_reason(error)
                status = getattr(error, "status", None)
                self._adaptive_observe(candidate, {"outcome": "failure"}, streaming=method == "stream", reason=reason, status=status)
                next_route = ranked[attempt]["route_key"] if attempt < len(ranked) else None
                self._emit_routing_event({"type": "fallback", **base, "fromRouteKey": candidate["route_key"], "toRouteKey": next_route, "reason": reason, "status": status})
        if last_error is not None:
            raise last_error
        raise ValueError(f"All candidate services exhausted (tried {len(ranked)} service(s))")

    def get_id(self) -> str:
        return self.current_service.get_id()

    def get_name(self) -> str:
        return self.current_service.get_name()

    def get_model_list(self):
        for service in self.services:
            model_list = service.get_model_list()
            if model_list:
                return copy.deepcopy(model_list)
        return None

    def get_features(self, model: str | None = None) -> dict[str, Any]:
        features = {
            "functions": False,
            "streaming": False,
            "thinking": False,
            "multiTurn": False,
            "structuredOutputs": False,
            "media": {
                "images": {"supported": False, "formats": []},
                "audio": {"supported": False, "formats": []},
                "files": {"supported": False, "formats": [], "uploadMethod": "none"},
                "urls": {"supported": False, "webSearch": False, "contextFetching": False},
            },
            "caching": {"supported": False, "types": []},
        }
        structured_output_modes: list[Any] = []
        all_modes_advertised = bool(self.services)
        for service in self.services:
            raw = service.get_features(model) or {}
            raw_modes = raw.get("structuredOutputModes", raw.get("structured_output_modes"))
            if raw_modes is None:
                all_modes_advertised = False
            else:
                _append_unique(structured_output_modes, list(raw_modes or []))
            for key in ("functions", "streaming", "thinking", "multiTurn", "structuredOutputs", "functionCot", "hasThinkingBudget", "hasShowThoughts"):
                if _feature_bool(raw, key):
                    features[key] = True
            media = raw.get("media") or {}
            for kind in ("images", "audio", "files"):
                src = media.get(kind) or {}
                if src.get("supported"):
                    features["media"][kind]["supported"] = True
                _append_unique(features["media"][kind]["formats"], list(src.get("formats") or []))
            upload = (media.get("files") or {}).get("uploadMethod") or (media.get("files") or {}).get("upload_method")
            if upload and upload != "none":
                features["media"]["files"]["uploadMethod"] = upload
            urls = media.get("urls") or {}
            if urls.get("supported"):
                features["media"]["urls"]["supported"] = True
            if urls.get("webSearch") or urls.get("web_search"):
                features["media"]["urls"]["webSearch"] = True
            if urls.get("contextFetching") or urls.get("context_fetching"):
                features["media"]["urls"]["contextFetching"] = True
            caching = raw.get("caching") or {}
            if caching.get("supported"):
                features["caching"]["supported"] = True
            _append_unique(features["caching"]["types"], list(caching.get("types") or []))
        if all_modes_advertised:
            features["structured_output_modes"] = structured_output_modes
        return features

    def get_metrics(self) -> dict[str, Any]:
        out = default_metrics()
        chat_sum = chat_count = embed_sum = embed_count = 0.0
        for service in self.services:
            metrics = service.get_metrics() or {}
            errors = metrics.get("errors") or {}
            for kind in ("chat", "embed"):
                src = errors.get(kind) or {}
                out["errors"][kind]["count"] += src.get("count", 0) or 0
                out["errors"][kind]["total"] += src.get("total", 0) or 0
            latency = metrics.get("latency") or {}
            chat = latency.get("chat") or {}
            chat_samples = len(chat.get("samples") or [])
            if chat_samples:
                chat_sum += (chat.get("mean", 0) or 0) * chat_samples
                chat_count += chat_samples
            embed = latency.get("embed") or {}
            embed_samples = len(embed.get("samples") or [])
            if embed_samples:
                embed_sum += (embed.get("mean", 0) or 0) * embed_samples
                embed_count += embed_samples
            out["latency"]["chat"]["p95"] = max(out["latency"]["chat"]["p95"], chat.get("p95", 0) or 0)
            out["latency"]["chat"]["p99"] = max(out["latency"]["chat"]["p99"], chat.get("p99", 0) or 0)
            out["latency"]["embed"]["p95"] = max(out["latency"]["embed"]["p95"], embed.get("p95", 0) or 0)
            out["latency"]["embed"]["p99"] = max(out["latency"]["embed"]["p99"], embed.get("p99", 0) or 0)
        for kind in ("chat", "embed"):
            total = out["errors"][kind]["total"]
            if total:
                out["errors"][kind]["rate"] = out["errors"][kind]["count"] / total
        if chat_count:
            out["latency"]["chat"]["mean"] = chat_sum / chat_count
        if embed_count:
            out["latency"]["embed"]["mean"] = embed_sum / embed_count
        return out

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        if self.adaptive is not None:
            return self._adaptive_invoke("chat", request, options)
        candidates = self._candidate_services(request)
        index = 0
        current = candidates[index]
        self.current_service = current
        while True:
            if not self._can_retry_service(current):
                current, index = self._next_service(candidates, index)
                if current is None:
                    raise ValueError(f"All candidate services exhausted (tried {len(candidates)} service(s))")
                self.current_service = current
                continue
            try:
                response = current.chat(request, options)
                self._handle_success(current)
                return response
            except AxAIServiceError as exc:
                if not _is_retryable_ai_error(exc):
                    raise
                self._handle_failure(current, exc)
                failure = self.service_failures.get(current.get_id(), {})
                if int(failure.get("retries", 0)) >= self.max_retries:
                    current, index = self._next_service(candidates, index)
                    if current is None:
                        raise
                    self.current_service = current
            except Exception:
                raise

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        def iterate():
            if self.adaptive is not None:
                ranked = self._rank_adaptive(request, options)
                last_error = None
                for attempt, candidate in enumerate(ranked, 1):
                    service = candidate["service"]
                    self.current_service = service
                    key = candidate["stats_key"]
                    base = {name: key[name] for name in ("namespace", "slice", "logicalModel")}
                    self._emit_routing_event({"type": "selected", **base, "routeKey": candidate["route_key"], "serviceName": service.get_name(), "attempt": attempt})
                    started = time.monotonic()
                    source = None
                    try:
                        source = iter(service.stream(request, options))
                        first = next(source)
                    except StopIteration:
                        self._adaptive_observe(candidate, {"outcome": "success", "latencyMs": max(1.0, (time.monotonic() - started) * 1000)}, streaming=True)
                        return
                    except AxAIServiceError as error:
                        close = getattr(source, "close", None)
                        if callable(close): close()
                        if not _is_retryable_ai_error(error): raise
                        last_error = error
                        reason = self._failure_reason(error)
                        status = getattr(error, "status", None)
                        self._adaptive_observe(candidate, {"outcome": "failure"}, streaming=True, reason=reason, status=status)
                        next_route = ranked[attempt]["route_key"] if attempt < len(ranked) else None
                        self._emit_routing_event({"type": "fallback", **base, "fromRouteKey": candidate["route_key"], "toRouteKey": next_route, "reason": reason, "status": status})
                        continue
                    self._adaptive_observe(candidate, {"outcome": "success", "latencyMs": max(1.0, (time.monotonic() - started) * 1000)}, streaming=True)
                    try:
                        yield first
                        yield from source
                    except AxAIServiceError as error:
                        self._adaptive_observe(candidate, {"outcome": "failure"}, streaming=True, reason=self._failure_reason(error), status=getattr(error, "status", None))
                        raise
                    finally:
                        close = getattr(source, "close", None)
                        if callable(close): close()
                    return
                if last_error is not None: raise last_error
                raise ValueError(f"All candidate services exhausted (tried {len(ranked)} service(s))")

            candidates = self._candidate_services(request)
            last_error = None
            for service in candidates:
                self.current_service = service
                while self._can_retry_service(service):
                    source = None
                    try:
                        source = iter(service.stream(request, options))
                        first = next(source)
                    except StopIteration:
                        self._handle_success(service)
                        return
                    except AxAIServiceError as error:
                        close = getattr(source, "close", None)
                        if callable(close): close()
                        if not _is_retryable_ai_error(error): raise
                        last_error = error
                        self._handle_failure(service, error)
                        failure = self.service_failures.get(service.get_id(), {})
                        if int(failure.get("retries", 0)) >= self.max_retries: break
                        continue
                    self._handle_success(service)
                    try:
                        yield first
                        yield from source
                    finally:
                        close = getattr(source, "close", None)
                        if callable(close): close()
                    return
            if last_error is not None: raise last_error
            raise ValueError(f"All candidate services exhausted (tried {len(candidates)} service(s))")
        return iterate()

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        self._reset()
        index = self.current_service_index
        while True:
            if not self._can_retry_service(self.current_service):
                next_service, index = self._next_service(self.services, index)
                if next_service is None:
                    raise ValueError(f"All services exhausted (tried {len(self.services)} service(s))")
                self.current_service = next_service
                self.current_service_index = index
                continue
            try:
                response = self.current_service.embed(request, options)
                self._handle_success(self.current_service)
                return response
            except AxAIServiceError as exc:
                if not _is_retryable_ai_error(exc):
                    raise
                self._handle_failure(self.current_service, exc)
                failure = self.service_failures.get(self.current_service.get_id(), {})
                if int(failure.get("retries", 0)) >= self.max_retries:
                    next_service, index = self._next_service(self.services, index)
                    if next_service is None:
                        raise
                    self.current_service = next_service
                    self.current_service_index = index

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        return self.current_service.transcribe(request, options)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        return self.current_service.speak(request, options)

    def get_estimated_cost(self, model_usage: dict[str, Any] | None = None) -> float:
        return self.current_service.get_estimated_cost(model_usage)

    def get_logger(self):
        return self.current_service.get_logger()

    def set_options(self, options: dict[str, Any]):
        for service in self.services:
            service.set_options(options)
        self.current_service.set_options(options)
        self.debug = bool((options or {}).get("debug", self.debug))

    def get_options(self) -> dict[str, Any]:
        return self.current_service.get_options()

    def get_last_used_chat_model(self):
        return self.current_service.get_last_used_chat_model()

    def get_last_used_embed_model(self):
        return self.current_service.get_last_used_embed_model()

    def get_last_used_model_config(self):
        return self.current_service.get_last_used_model_config()

    def complete(self, request: dict[str, Any]) -> dict[str, Any]:
        return chat_response_to_completion(self.chat(_coerce_chat_request(request)))


class ProviderRouter:
    def __init__(self, config: dict[str, Any]):
        providers_config = config.get("providers") or {}
        self.providers = [providers_config.get("primary"), *(providers_config.get("alternatives") or [])]
        self.providers = [provider for provider in self.providers if provider is not None]
        self.processing = config.get("processing") or {}
        routing = config.get("routing") or {}
        self.routing = routing.get("capability") or {}

    def _provider_records(self):
        return [
            {"name": provider.get_name(), "id": provider.get_id(), "features": copy.deepcopy(provider.get_features())}
            for provider in self.providers
        ]

    def _service_for_name(self, name: str):
        for provider in self.providers:
            if provider.get_name() == name:
                return provider
        return self.providers[0] if self.providers else None

    def get_routing_recommendation(self, request: dict[str, Any]):
        rec = provider_route_recommendation(self._provider_records(), _coerce_chat_request(request), self.routing)
        out = copy.deepcopy(rec)
        out["provider"] = self._service_for_name(out.get("providerName"))
        return out

    def validate_request(self, request: dict[str, Any]):
        return provider_route_validation(self._provider_records(), _coerce_chat_request(request), self.processing, self.routing)

    def get_routing_stats(self):
        return provider_routing_stats(self._provider_records())

    def _selected_provider(self, request: dict[str, Any]):
        rec = self.get_routing_recommendation(request)
        provider = rec.get("provider")
        if provider is None:
            raise AxUnsupportedCapabilityError("No provider selected")
        return rec, provider

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        rec, provider = self._selected_provider(request)
        processed_request = provider_route_preprocess_request(provider.get_features(), request)
        response = provider.chat(processed_request, options)
        return {"response": response, "routing": rec}

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        _rec, provider = self._selected_provider(request)
        processed_request = provider_route_preprocess_request(provider.get_features(), request)
        return provider.stream(processed_request, options)

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        _rec, provider = self._selected_provider(request)
        return provider.embed(request, options)

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        _rec, provider = self._selected_provider(request)
        return provider.transcribe(request, options)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        _rec, provider = self._selected_provider(request)
        return provider.speak(request, options)


def _core_not(value): return not value
def _core_and(left, right): return bool(left and right)
def _core_or(left, right): return bool(left or right)
def _core_add(left, right): return left + right
def _core_mul(left, right): return left * right
def _core_div(left, right): return float(left or 0) / float(right or 1)
def _core_math_abs(value): return abs(float(value or 0))
def _core_math_log(value): return math.log(float(value))
def _core_math_exp(value): return math.exp(float(value))
def _core_math_sqrt(value): return math.sqrt(float(value))
def _core_math_cos(value): return math.cos(float(value))
def _core_math_pow(left, right): return float(left) ** float(right)
_core_math_random_lock = threading.Lock()
_core_math_random_values: list[float] = []
def _core_set_math_random_values(values):
    with _core_math_random_lock:
        _core_math_random_values[:] = [float(value) for value in values]
def _core_math_random():
    with _core_math_random_lock:
        if _core_math_random_values:
            return _core_math_random_values.pop(0)
    return random.random()
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_lt(left, right): return left < right
def _core_lte(left, right): return left <= right
def _core_gt(left, right): return left > right
def _core_gte(left, right): return left >= right
def _core_contains(container, item): return False if container is None else item in container
def _core_len(value): return len(value or [])
def _core_truthy(value): return bool(value)
def _core_is_none(value): return value is None
def _core_is_not_none(value): return value is not None
def _core_none(): return None
def _core_coalesce(value, fallback): return fallback if value is None else value
def _core_runtime_error(message): return RuntimeError(str(message))


def _core_coverage_mark(name):
    path = os.environ.get("AXIR_COVERAGE_FILE")
    if not path or name in _CORE_COVERAGE_SEEN:
        return
    _CORE_COVERAGE_SEEN.add(name)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(name + "\n")


_CORE_COVERAGE_SEEN: set[str] = set()


def _core_get(target, key, default=None):
    if target is None:
        return default
    if isinstance(target, dict):
        return target.get(key, default)
    if isinstance(target, (list, tuple)) and isinstance(key, int):
        return target[key] if 0 <= key < len(target) else default
    return getattr(target, key, default)


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_type_is(value, type_name):
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "list":
        return isinstance(value, list)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "null":
        return value is None
    if type_name == "json":
        return value is None or isinstance(value, (dict, list, str, int, float, bool))
    return False


def _core_map_merge(left, right):
    out = dict(left or {})
    out.update(right or {})
    return out


def _core_map_delete(target, key):
    if isinstance(target, dict):
        target.pop(key, None)
    return target


def _core_map_contains(values, key):
    return isinstance(values, dict) and key in values


def _core_map_keys(values):
    return list(values.keys()) if isinstance(values, dict) else []


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_json_parse(value):
    return json.loads(value)


def _core_json_stringify(value):
    return json.dumps(value or {}, sort_keys=True, separators=(",", ":"))


def _core_string_starts_with(value, prefix):
    return isinstance(value, str) and value.startswith(str(prefix))


def _core_string_ends_with(value, suffix):
    return str(value).endswith(str(suffix))


def _core_string_join(sep, values):
    return str(sep).join(str(item) for item in values)


def _core_string_lower(value):
    return str(value).lower()


def _core_string_format(template, *args):
    return str(template).format(*args)


def _core_string_replace(value, old, new):
    return str(value).replace(str(old), str(new))


def _core_string_str(value):
    return str(value)


def _core_ai_error_response(message, response_body=None):
    return AxAIServiceResponseError(str(message), response_body=response_body)


def _core_ai_error_refusal(message, response_body=None):
    return AxAIRefusalError(str(message), response_body=response_body)


def _core_ai_error_stream(message, response_body=None, retryable=True):
    return AxAIServiceStreamTerminatedError(str(message), response_body=response_body, retryable=bool(retryable))


def _core_ai_error_unsupported(message):
    return AxUnsupportedCapabilityError(str(message))


def _core_ai_error_auth(message, status=None, code=None, response_body=None, request=None):
    return AxAIServiceAuthenticationError(str(message), status=status, code=code, response_body=response_body, request=request)


def _core_ai_error_timeout(message, status=None, code=None, response_body=None, request=None, retryable=True):
    return AxAIServiceTimeoutError(str(message), status=status, code=code, response_body=response_body, request=request, retryable=bool(retryable))


def _core_ai_error_status(message, status=None, code=None, response_body=None, request=None, retryable=False):
    return AxAIServiceStatusError(str(message), status=status, code=code, response_body=response_body, request=request, retryable=bool(retryable))


# AXIR_CORE_AI_FUNCTIONS

for _axir_provider_public_name in (
    "provider_normalize_profile",
    "provider_profile_registry",
    "provider_resolve_profile",
    "provider_model_catalog_summary",
    "provider_model_catalog",
    "provider_route_request_requirements",
    "provider_route_preprocess_request",
    "provider_route_recommendation",
    "provider_route_validation",
    "provider_balancer_retry_policy",
    "provider_balancer_metric_score",
    "provider_balancer_candidate_allowed",
    "provider_routing_stats",
    "provider_descriptor",
    "provider_operation_descriptor",
    "provider_build_chat_request",
    "provider_build_embed_request",
    "provider_normalize_chat_response",
    "provider_normalize_stream_delta",
    "provider_normalize_embed_response",
    "provider_build_transcribe_request",
    "provider_build_speak_request",
    "provider_normalize_transcribe_response",
    "provider_normalize_speak_response",
    "provider_normalize_realtime_event",
    "openai_build_chat_request",
    "openai_build_embed_request",
    "openai_normalize_chat_response",
    "openai_normalize_stream_delta",
    "openai_normalize_embed_response",
    "openai_responses_build_chat_request",
    "openai_responses_normalize_chat_response",
    "openai_responses_normalize_stream_delta",
    "openai_responses_build_transcribe_request",
    "openai_responses_build_speak_request",
    "openai_responses_normalize_realtime_event",
):
    if _axir_provider_public_name in globals():
        globals().setdefault(f"_{_axir_provider_public_name}", globals()[_axir_provider_public_name])
del _axir_provider_public_name


def _coerce_chat_request(request: dict[str, Any]):
    if "chat_prompt" in request:
        return copy.deepcopy(request)
    if "chatPrompt" in request:
        out = copy.deepcopy(request)
        out["chat_prompt"] = out.pop("chatPrompt")
        return out
    if "messages" in request:
        return {
            "chat_prompt": copy.deepcopy(request["messages"]),
            "functions": request.get("functions") or _tools_to_functions(request.get("tools") or []),
            "function_call": request.get("function_call") or request.get("tool_choice"),
            "response_format": request.get("response_format"),
            "model": request.get("model"),
            "model_config": request.get("model_config") or {},
        }
    return copy.deepcopy(request)


def _tools_to_functions(tools):
    out = []
    for tool in tools:
        fn = tool.get("function", tool)
        out.append({"name": fn.get("name"), "description": fn.get("description", ""), "parameters": fn.get("parameters")})
    return out


def _transport_result(result: Any, request: dict[str, Any]):
    if isinstance(result, tuple):
        status, body = result[0], result[1]
        result = {"status": status, "json": body}
    if isinstance(result, dict) and "status" in result:
        status = int(result.get("status") or 200)
        body = result.get("json", result.get("body", result.get("data")))
        if status >= 400:
            raise openai_normalize_error(status, body, request)
        return body
    return result


def _iter_sse_json(raw: Any):
    if isinstance(raw, list) and all(isinstance(item, dict) or item == "[DONE]" for item in raw):
        for item in raw:
            if item != "[DONE]":
                yield item
        return

    chunks = [raw] if isinstance(raw, (str, bytes, bytearray)) else raw
    decoder = codecs.getincrementaldecoder("utf-8")()
    line = ""
    data_lines: list[str] = []
    pending_cr = False
    at_start = True
    terminated = False

    def flush_event():
        nonlocal data_lines, terminated
        if not data_lines:
            return None
        payload = "\n".join(data_lines)
        data_lines = []
        if payload.strip() == "[DONE]":
            terminated = True
            return None
        return json.loads(payload)

    def process_line(value: str):
        if value == "":
            return flush_event()
        if value.startswith(":"):
            return None
        colon = value.find(":")
        field = value if colon < 0 else value[:colon]
        field_value = "" if colon < 0 else value[colon + 1:]
        if field_value.startswith(" "):
            field_value = field_value[1:]
        if field == "data":
            data_lines.append(field_value)
        return None

    def process_text(text: str):
        nonlocal line, pending_cr, at_start
        if at_start and text:
            at_start = False
            if text.startswith("\ufeff"):
                text = text[1:]
        for char in text:
            if pending_cr:
                pending_cr = False
                event = process_line(line)
                line = ""
                if event is not None:
                    yield event
                if terminated:
                    return
                if char == "\n":
                    continue
            if char == "\r":
                pending_cr = True
            elif char == "\n":
                event = process_line(line)
                line = ""
                if event is not None:
                    yield event
                if terminated:
                    return
            else:
                line += char

    try:
        for chunk in chunks:
            if isinstance(chunk, dict):
                yield chunk
                continue
            text = chunk if isinstance(chunk, str) else decoder.decode(bytes(chunk), final=False)
            yield from process_text(text)
            if terminated:
                return
        yield from process_text(decoder.decode(b"", final=True))
        if terminated:
            return
        if pending_cr:
            event = process_line(line)
            line = ""
            if event is not None:
                yield event
        elif line:
            # Provider-compatible EOF: accept a final event without a blank line.
            process_line(line)
        event = flush_event()
        if event is not None:
            yield event
    finally:
        close = getattr(raw, "close", None)
        if callable(close):
            close()
