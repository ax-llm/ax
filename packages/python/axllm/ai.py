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


# BEGIN AXIR CORE EMITTED FUNCTIONS
def openai_build_chat_request(request: AxChatRequest, options: Any, prompt_caching: bool) -> Any:
    _core_coverage_mark("openai_build_chat_request")
    payload = _openai_build_chat_request_impl(request, options, prompt_caching, "none", "none")
    return payload


def _openai_build_chat_request_impl(request: AxChatRequest, options: Any, prompt_caching: bool, reasoning_content_mode: str, reasoning_details_mode: str) -> Any:
    _core_coverage_mark("_openai_build_chat_request_impl")
    payload = {}
    model = _core_get(request, "model", None)
    payload["model"] = model
    messages = []
    chat_prompt = _core_get(request, "chat_prompt", None)
    message_count = _core_len(chat_prompt)
    last_index = _core_add(message_count, -1)
    has_context_cache_snake = _core_map_contains(options, "context_cache")
    has_context_cache_camel = _core_map_contains(options, "contextCache")
    has_context_cache = _core_or(has_context_cache_snake, has_context_cache_camel)
    has_cache_flag = False
    for raw_message in chat_prompt:
        raw_cache = _core_get(raw_message, "cache", False)
        has_cache_flag = _core_or(has_cache_flag, raw_cache)
    empty_functions_for_cache = []
    functions_for_cache = _core_get(request, "functions", empty_functions_for_cache)
    for cache_fn in functions_for_cache:
        fn_cache = _core_get(cache_fn, "cache", False)
        has_cache_flag = _core_or(has_cache_flag, fn_cache)
    cache_requested = _core_or(has_context_cache, has_cache_flag)
    is_gpt_56_base = _core_eq(model, "gpt-5.6")
    is_gpt_56_tier = _core_string_starts_with(model, "gpt-5.6-")
    is_gpt_56 = _core_or(is_gpt_56_base, is_gpt_56_tier)
    cache_provider_and_model = _core_and(prompt_caching, is_gpt_56)
    cache_enabled = _core_and(cache_provider_and_model, cache_requested)
    message_index = 0
    marker_count = 0
    for message in chat_prompt:
        provider_message = _openai_message_impl(message, reasoning_content_mode, reasoning_details_mode)
        if cache_enabled:
            is_before_last = _core_lt(message_index, last_index)
            explicit_cache = _core_get(message, "cache", False)
            should_mark = _core_or(is_before_last, explicit_cache)
            if should_mark:
                marked = _openai_apply_cache_breakpoint_impl(provider_message)
                provider_message = _core_get(marked, "message", provider_message)
                marker_added = _core_get(marked, "marked", False)
                if marker_added:
                    marker_count = _core_add(marker_count, 1)
                else:
                    pass
            else:
                pass
        else:
            pass
        messages.append(provider_message)
        message_index = _core_add(message_index, 1)
    payload["messages"] = messages
    empty_functions = []
    functions = _core_get(request, "functions", empty_functions)
    has_functions = _core_truthy(functions)
    if has_functions:
        tools = []
        for fn in functions:
            tool = _openai_tool_spec_impl(fn)
            tools.append(tool)
        payload["tools"] = tools
        tool_choice = _core_get(request, "function_call", "auto")
        payload["tool_choice"] = tool_choice
    else:
        pass
    response_format = _core_get(request, "response_format", None)
    has_response_format = _core_truthy(response_format)
    if has_response_format:
        response_format_type = _core_get(response_format, "type", None)
        is_json_object = _core_eq(response_format_type, "json_object")
        if is_json_object:
            json_mode_message = {}
            json_mode_message["role"] = "system"
            json_mode_message["content"] = "JSON output is required. Return only the requested JSON object."
            messages.append(json_mode_message)
            payload["messages"] = messages
        else:
            pass
        is_json_schema = _core_eq(response_format_type, "json_schema")
        if is_json_schema:
            json_schema_format = {}
            schema = _core_get(response_format, "schema", None)
            json_schema_format["type"] = "json_schema"
            json_schema_format["json_schema"] = schema
            payload["response_format"] = json_schema_format
        else:
            payload["response_format"] = response_format
    else:
        pass
    model_config = _core_get(request, "model_config", None)
    _openai_apply_model_config_impl(payload, model_config)
    if cache_enabled:
        has_markers = _core_gt(marker_count, 0)
        if has_markers:
            prompt_cache_options = {}
            prompt_cache_options["mode"] = "explicit"
            payload["prompt_cache_options"] = prompt_cache_options
        else:
            pass
        prompt_key_snake = _core_get(options, "prompt_cache_key", None)
        prompt_key = _core_get(options, "promptCacheKey", prompt_key_snake)
        session_snake = _core_get(options, "session_id", None)
        session = _core_get(options, "sessionId", session_snake)
        resolved_key = _core_coalesce(prompt_key, session)
        has_resolved_key = _core_truthy(resolved_key)
        if has_resolved_key:
            payload["prompt_cache_key"] = resolved_key
        else:
            pass
    else:
        pass
    return payload


def _openai_apply_cache_breakpoint_impl(message: Any) -> Any:
    _core_coverage_mark("_openai_apply_cache_breakpoint_impl")
    out = {}
    out["message"] = message
    out["marked"] = False
    content = _core_get(message, "content", None)
    content_is_string = _core_type_is(content, "string")
    if content_is_string:
        content_length = _core_len(content)
        has_content = _core_gt(content_length, 0)
        if has_content:
            breakpoint = {}
            breakpoint["mode"] = "explicit"
            part = {}
            part["type"] = "text"
            part["text"] = content
            part["prompt_cache_breakpoint"] = breakpoint
            parts = []
            parts.append(part)
            copy_seed = {}
            message_copy = _core_map_merge(message, copy_seed)
            message_copy["content"] = parts
            out["message"] = message_copy
            out["marked"] = True
        else:
            pass
        return out
    else:
        pass
    content_is_list = _core_type_is(content, "list")
    if content_is_list:
        part_count = _core_len(content)
        has_parts = _core_gt(part_count, 0)
        if has_parts:
            last_part_index = _core_add(part_count, -1)
            part_index = 0
            parts = []
            for content_part in content:
                is_last_part = _core_eq(part_index, last_part_index)
                if is_last_part:
                    part_seed = {}
                    part_copy = _core_map_merge(content_part, part_seed)
                    breakpoint = {}
                    breakpoint["mode"] = "explicit"
                    part_copy["prompt_cache_breakpoint"] = breakpoint
                    parts.append(part_copy)
                else:
                    parts.append(content_part)
                part_index = _core_add(part_index, 1)
            message_seed = {}
            message_copy = _core_map_merge(message, message_seed)
            message_copy["content"] = parts
            out["message"] = message_copy
            out["marked"] = True
        else:
            pass
    else:
        pass
    return out


def merge_model_config(base: Any, override: Any = None, options: Any = None) -> AxModelConfig:
    _core_coverage_mark("merge_model_config")
    empty_options_config = {}
    options_config_snake = _core_get(options, "model_config", empty_options_config)
    options_config = _core_get(options, "modelConfig", options_config_snake)
    base_options = _core_map_merge(base, options_config)
    merged = _core_map_merge(base_options, override)
    has_stream_option = _core_map_contains(options, "stream")
    if has_stream_option:
        stream = _core_get(options, "stream", None)
        merged["stream"] = stream
    else:
        pass
    budget_snake = _core_get(options, "thinking_token_budget", None)
    budget = _core_get(options, "thinkingTokenBudget", budget_snake)
    has_budget = _core_is_not_none(budget)
    if has_budget:
        merged["thinkingTokenBudget"] = budget
    else:
        pass
    reasoning_snake = _core_get(options, "reasoning_effort", None)
    reasoning = _core_get(options, "reasoningEffort", reasoning_snake)
    has_reasoning = _core_is_not_none(reasoning)
    if has_reasoning:
        merged["reasoning_effort"] = reasoning
    else:
        pass
    show_thoughts_snake = _core_get(options, "show_thoughts", None)
    show_thoughts = _core_get(options, "showThoughts", show_thoughts_snake)
    has_show_thoughts = _core_is_not_none(show_thoughts)
    if has_show_thoughts:
        merged["showThoughts"] = show_thoughts
    else:
        pass
    out = {}
    for key in merged:
        value = _core_get(merged, key, None)
        include = _core_is_not_none(value)
        if include:
            out[key] = value
        else:
            pass
    return out


def _openai_apply_model_config_impl(payload: Any, model_config: Any) -> None:
    _core_coverage_mark("_openai_apply_model_config_impl")
    _openai_copy_config_key_impl(payload, model_config, "max_tokens", "max_completion_tokens")
    _openai_copy_config_key_impl(payload, model_config, "maxTokens", "max_completion_tokens")
    _openai_copy_config_key_impl(payload, model_config, "temperature", "temperature")
    _openai_copy_config_key_impl(payload, model_config, "top_p", "top_p")
    _openai_copy_config_key_impl(payload, model_config, "topP", "top_p")
    _openai_copy_config_key_impl(payload, model_config, "n", "n")
    _openai_copy_config_key_impl(payload, model_config, "presence_penalty", "presence_penalty")
    _openai_copy_config_key_impl(payload, model_config, "presencePenalty", "presence_penalty")
    _openai_copy_config_key_impl(payload, model_config, "frequency_penalty", "frequency_penalty")
    _openai_copy_config_key_impl(payload, model_config, "frequencyPenalty", "frequency_penalty")
    _openai_copy_config_key_impl(payload, model_config, "reasoning_effort", "reasoning_effort")
    _openai_copy_config_key_impl(payload, model_config, "reasoningEffort", "reasoning_effort")
    budget_snake = _core_get(model_config, "thinking_token_budget", None)
    budget = _core_get(model_config, "thinkingTokenBudget", budget_snake)
    has_budget = _core_is_not_none(budget)
    if has_budget:
        model = _core_get(payload, "model", "")
        effort = openai_chat_reasoning_effort(model, budget)
        has_effort = _core_is_not_none(effort)
        if has_effort:
            payload["reasoning_effort"] = effort
        else:
            _core_map_delete(payload, "reasoning_effort")
    else:
        pass
    stop_snake = _core_get(model_config, "stop_sequences", None)
    stop = _core_get(model_config, "stopSequences", stop_snake)
    has_stop = _core_truthy(stop)
    if has_stop:
        payload["stop"] = stop
    else:
        pass
    stream = _core_get(model_config, "stream", None)
    is_stream = _core_truthy(stream)
    if is_stream:
        payload["stream"] = True
        stream_options = {}
        stream_options["include_usage"] = True
        payload["stream_options"] = stream_options
    else:
        pass
    return None


def validate_chat_request(request: AxChatRequest) -> None:
    _core_coverage_mark("validate_chat_request")
    realtime = _core_get(request, "realtime", None)
    has_realtime = _core_truthy(realtime)
    if has_realtime:
        error = _core_ai_error_unsupported("OpenAI-compatible beta does not support realtime requests")
        raise error
    else:
        pass
    prompt = _core_get(request, "chat_prompt", None)
    prompt_is_list = _core_type_is(prompt, "list")
    prompt_len = _core_len(prompt)
    prompt_empty = _core_eq(prompt_len, 0)
    prompt_not_list = _core_not(prompt_is_list)
    bad_prompt = _core_or(prompt_not_list, prompt_empty)
    if bad_prompt:
        error = _core_ai_error_response("Chat prompt is empty")
        raise error
    else:
        pass
    for message in prompt:
        role = _core_get(message, "role", None)
        is_system = _core_eq(role, "system")
        is_user = _core_eq(role, "user")
        is_assistant = _core_eq(role, "assistant")
        is_function = _core_eq(role, "function")
        valid_left = _core_or(is_system, is_user)
        valid_right = _core_or(is_assistant, is_function)
        valid_role = _core_or(valid_left, valid_right)
        invalid_role = _core_not(valid_role)
        if invalid_role:
            message_text = _core_string_format("Invalid chat message role: {}", role)
            error = _core_ai_error_response(message_text)
            raise error
        else:
            pass
        content = _core_get(message, "content", None)
        empty_function_calls = []
        function_calls_snake = _core_get(message, "function_calls", empty_function_calls)
        function_calls = _core_get(message, "functionCalls", function_calls_snake)
        thought = _core_get(message, "thought", None)
        has_content = _core_truthy(content)
        has_calls = _core_truthy(function_calls)
        has_thought = _core_truthy(thought)
        has_assistant_payload = _core_or(has_content, has_calls)
        has_assistant_payload = _core_or(has_assistant_payload, has_thought)
        missing_assistant_payload = _core_not(has_assistant_payload)
        bad_assistant = _core_and(is_assistant, missing_assistant_payload)
        if bad_assistant:
            error = _core_ai_error_response("Assistant content is required when no tool calls are provided")
            raise error
        else:
            pass
    return None


def openai_reasoning_effort(model: str, budget: Any) -> Any:
    _core_coverage_mark("openai_reasoning_effort")
    is_gpt56_alias = _core_eq(model, "gpt-5.6")
    is_gpt56_suffix = _core_string_starts_with(model, "gpt-5.6-")
    is_gpt56 = _core_or(is_gpt56_alias, is_gpt56_suffix)
    is_none = _core_eq(budget, "none")
    if is_none:
        if is_gpt56:
            return "none"
        else:
            pass
        none = _core_none()
        return none
    else:
        pass
    is_minimal = _core_eq(budget, "minimal")
    is_low = _core_eq(budget, "low")
    is_medium = _core_eq(budget, "medium")
    is_highest = _core_eq(budget, "highest")
    if is_gpt56:
        if is_minimal:
            return "low"
        else:
            pass
        if is_low:
            return "low"
        else:
            pass
        if is_medium:
            return "medium"
        else:
            pass
        if is_highest:
            return "max"
        else:
            pass
        return "high"
    else:
        pass
    if is_minimal:
        return "minimal"
    else:
        pass
    if is_low:
        return "medium"
    else:
        pass
    if is_highest:
        return "xhigh"
    else:
        pass
    return "high"


def build_chat_request(service: AxAIService, request: AxChatRequest, options: Any = None) -> Any:
    _core_coverage_mark("build_chat_request")
    validate_chat_request(request)
    payload = openai_build_chat_request(request, options, True)
    return payload


def openai_chat_reasoning_effort(model: str, budget: Any) -> Any:
    _core_coverage_mark("openai_chat_reasoning_effort")
    effort = openai_reasoning_effort(model, budget)
    is_max = _core_eq(effort, "max")
    if is_max:
        return "xhigh"
    else:
        pass
    return effort


def normalize_chat_response(raw: Any) -> AxChatResponse:
    _core_coverage_mark("normalize_chat_response")
    response = openai_normalize_chat_response(raw)
    return response


def normalize_stream_delta(raw: Any, state: Any) -> AxChatResponse:
    _core_coverage_mark("normalize_stream_delta")
    response = openai_normalize_stream_delta(raw, state)
    return response


def _openai_copy_config_key_impl(payload: Any, model_config: Any, source: str, target: str) -> None:
    _core_coverage_mark("_openai_copy_config_key_impl")
    has_source = _core_map_contains(model_config, source)
    if has_source:
        value = _core_get(model_config, source, None)
        payload[target] = value
    else:
        pass
    return None


def build_embed_request(service: AxAIService, request: AxEmbedRequest, options: Any = None) -> Any:
    _core_coverage_mark("build_embed_request")
    payload = openai_build_embed_request(request)
    return payload


def _openai_message_impl(message: Any, reasoning_content_mode: str, reasoning_details_mode: str) -> Any:
    _core_coverage_mark("_openai_message_impl")
    role = _core_get(message, "role", None)
    content = _core_get(message, "content", "")
    is_no_reasoning = _core_eq(reasoning_content_mode, "none")
    has_reasoning_mode = _core_not(is_no_reasoning)
    is_system = _core_eq(role, "system")
    if is_system:
        out = {}
        out["role"] = "system"
        out["content"] = content
        return out
    else:
        pass
    is_user = _core_eq(role, "user")
    if is_user:
        content_is_list = _core_type_is(content, "list")
        if content_is_list:
            parts = []
            for part in content:
                provider_part = _openai_content_part_impl(part)
                parts.append(provider_part)
            content = parts
        else:
            pass
        out = {}
        out["role"] = "user"
        out["content"] = content
        name = _core_get(message, "name", None)
        has_name = _core_truthy(name)
        if has_name:
            out["name"] = name
        else:
            pass
        return out
    else:
        pass
    is_assistant = _core_eq(role, "assistant")
    if is_assistant:
        thought = _core_get(message, "thought", None)
        has_thought = _core_truthy(thought)
        include_thought = _core_and(has_reasoning_mode, has_thought)
        empty_calls = []
        calls_snake = _core_get(message, "function_calls", empty_calls)
        calls = _core_get(message, "functionCalls", calls_snake)
        has_calls = _core_truthy(calls)
        out = {}
        out["role"] = "assistant"
        if include_thought:
            out[reasoning_content_mode] = thought
        else:
            pass
        is_no_details = _core_eq(reasoning_details_mode, "none")
        has_details_mode = _core_not(is_no_details)
        empty_thought_blocks = []
        thought_blocks_snake = _core_get(message, "thought_blocks", empty_thought_blocks)
        thought_blocks = _core_get(message, "thoughtBlocks", thought_blocks_snake)
        has_thought_blocks = _core_truthy(thought_blocks)
        include_details = _core_and(has_details_mode, has_thought_blocks)
        if include_details:
            details = []
            for thought_block in thought_blocks:
                data = _core_get(thought_block, "data", None)
                try:
                    detail = _core_json_parse(data)
                    details.append(detail)
                except Exception as parse_error:
                    pass
            has_details = _core_truthy(details)
            if has_details:
                out[reasoning_details_mode] = details
            else:
                pass
        else:
            pass
        if has_calls:
            assistant_content = _core_get(message, "content", None)
            has_assistant_content = _core_is_not_none(assistant_content)
            if has_reasoning_mode:
                reasoning_message_content = _core_get(message, "content", "")
                out["content"] = reasoning_message_content
            else:
                if has_assistant_content:
                    out["content"] = assistant_content
                else:
                    pass
            tool_calls = []
            for call in calls:
                provider_call = _openai_tool_call_to_provider_impl(call)
                tool_calls.append(provider_call)
            out["tool_calls"] = tool_calls
        else:
            out["content"] = content
        return out
    else:
        pass
    is_function = _core_eq(role, "function")
    if is_function:
        out = {}
        result = _core_get(message, "result", "")
        function_id_snake = _core_get(message, "function_id", None)
        function_id = _core_get(message, "functionId", function_id_snake)
        out["role"] = "tool"
        out["content"] = result
        out["tool_call_id"] = function_id
        return out
    else:
        pass
    message_text = _core_string_format("Invalid role: {}", role)
    error = _core_ai_error_response(message_text)
    raise error


def normalize_embed_response(raw: Any) -> AxEmbedResponse:
    _core_coverage_mark("normalize_embed_response")
    response = openai_normalize_embed_response(raw)
    return response


def normalize_token_usage(usage: Any) -> Any:
    _core_coverage_mark("normalize_token_usage")
    out = {}
    input_tokens = _core_get(usage, "input_tokens", 0)
    prompt_tokens_snake = _core_get(usage, "prompt_tokens", input_tokens)
    prompt_tokens_raw = _core_get(usage, "promptTokens", prompt_tokens_snake)
    prompt_details_snake = _core_get(usage, "prompt_tokens_details", None)
    prompt_details = _core_get(usage, "input_tokens_details", prompt_details_snake)
    cached_from_details = _core_get(prompt_details, "cached_tokens", None)
    cache_write_from_details = _core_get(prompt_details, "cache_write_tokens", None)
    cached_for_math = _core_coalesce(cached_from_details, 0)
    cache_write_for_math = _core_coalesce(cache_write_from_details, 0)
    negative_cached = _core_mul(cached_for_math, -1)
    prompt_without_cached = _core_add(prompt_tokens_raw, negative_cached)
    negative_cache_write = _core_mul(cache_write_for_math, -1)
    prompt_after_cache = _core_add(prompt_without_cached, negative_cache_write)
    prompt_is_negative = _core_lt(prompt_after_cache, 0)
    prompt_tokens = prompt_after_cache
    if prompt_is_negative:
        prompt_tokens = 0
    else:
        pass
    output_tokens = _core_get(usage, "output_tokens", 0)
    completion_tokens_snake = _core_get(usage, "completion_tokens", output_tokens)
    completion_tokens = _core_get(usage, "completionTokens", completion_tokens_snake)
    computed_total_tokens = _core_add(prompt_tokens, completion_tokens)
    total_tokens_snake = _core_get(usage, "total_tokens", computed_total_tokens)
    total_tokens = _core_get(usage, "totalTokens", total_tokens_snake)
    out["prompt_tokens"] = prompt_tokens
    out["completion_tokens"] = completion_tokens
    out["total_tokens"] = total_tokens
    thoughts_tokens_snake = _core_get(usage, "thoughts_tokens", None)
    thoughts_tokens = _core_get(usage, "thoughtsTokens", thoughts_tokens_snake)
    has_thoughts = _core_is_not_none(thoughts_tokens)
    if has_thoughts:
        out["thoughts_tokens"] = thoughts_tokens
    else:
        pass
    completion_details_snake = _core_get(usage, "completion_tokens_details", None)
    completion_details = _core_get(usage, "output_tokens_details", completion_details_snake)
    reasoning_from_details = _core_get(completion_details, "reasoning_tokens", None)
    reasoning_tokens_snake = _core_get(usage, "reasoning_tokens", reasoning_from_details)
    reasoning_tokens = _core_get(usage, "reasoningTokens", reasoning_tokens_snake)
    has_reasoning = _core_is_not_none(reasoning_tokens)
    if has_reasoning:
        out["reasoning_tokens"] = reasoning_tokens
    else:
        pass
    direct_cache_read_snake = _core_get(usage, "cache_read_tokens", None)
    direct_cache_read = _core_get(usage, "cacheReadTokens", direct_cache_read_snake)
    cache_read_tokens = _core_coalesce(direct_cache_read, cached_from_details)
    cache_read_for_compare = _core_coalesce(cache_read_tokens, 0)
    has_direct_cache_read = _core_is_not_none(direct_cache_read)
    has_positive_cache_read = _core_gt(cache_read_for_compare, 0)
    has_cache_read = _core_or(has_direct_cache_read, has_positive_cache_read)
    if has_cache_read:
        out["cache_read_tokens"] = cache_read_tokens
    else:
        pass
    direct_cache_creation_snake = _core_get(usage, "cache_creation_tokens", None)
    direct_cache_creation = _core_get(usage, "cacheCreationTokens", direct_cache_creation_snake)
    cache_creation_tokens = _core_coalesce(direct_cache_creation, cache_write_from_details)
    cache_creation_for_compare = _core_coalesce(cache_creation_tokens, 0)
    has_direct_cache_creation = _core_is_not_none(direct_cache_creation)
    has_positive_cache_creation = _core_gt(cache_creation_for_compare, 0)
    has_cache_creation = _core_or(has_direct_cache_creation, has_positive_cache_creation)
    if has_cache_creation:
        out["cache_creation_tokens"] = cache_creation_tokens
    else:
        pass
    service_tier_snake = _core_get(usage, "service_tier", None)
    service_tier = _core_get(usage, "serviceTier", service_tier_snake)
    has_service_tier = _core_is_not_none(service_tier)
    if has_service_tier:
        is_default = _core_eq(service_tier, "default")
        is_on_demand = _core_eq(service_tier, "on_demand")
        is_standard_only = _core_eq(service_tier, "standard_only")
        is_unspecified = _core_eq(service_tier, "unspecified")
        standard_pair = _core_or(is_default, is_on_demand)
        standard_triple = _core_or(standard_pair, is_standard_only)
        is_standard_alias = _core_or(standard_triple, is_unspecified)
        if is_standard_alias:
            service_tier = "standard"
        else:
            pass
        is_performance = _core_eq(service_tier, "performance")
        if is_performance:
            service_tier = "priority"
        else:
            pass
        out["service_tier"] = service_tier
    else:
        pass
    speed = _core_get(usage, "speed", None)
    has_speed = _core_is_not_none(speed)
    if has_speed:
        out["speed"] = speed
    else:
        pass
    return out


def _openai_content_part_impl(part: Any) -> Any:
    _core_coverage_mark("_openai_content_part_impl")
    type = _core_get(part, "type", None)
    is_text = _core_eq(type, "text")
    if is_text:
        text = _core_get(part, "text", "")
        out = {}
        out["type"] = "text"
        out["text"] = text
        return out
    else:
        pass
    is_image = _core_eq(type, "image")
    if is_image:
        mime_snake = _core_get(part, "mime_type", None)
        mime_raw = _core_get(part, "mimeType", mime_snake)
        mime = _core_coalesce(mime_raw, "image/png")
        image_value = _core_get(part, "image", None)
        image_raw = _core_get(part, "data", image_value)
        image = _core_coalesce(image_raw, "")
        is_data_url = _core_string_starts_with(image, "data:")
        url = ""
        if is_data_url:
            url = image
        else:
            url = _core_string_format("data:{};base64,{}", mime, image)
        details = _core_get(part, "details", "auto")
        image_url = {}
        image_url["url"] = url
        image_url["detail"] = details
        out = {}
        out["type"] = "image_url"
        out["image_url"] = image_url
        return out
    else:
        pass
    is_audio = _core_eq(type, "audio")
    if is_audio:
        audio_alt = _core_get(part, "audio", None)
        data = _core_get(part, "data", audio_alt)
        format = _core_get(part, "format", None)
        is_wav = _core_eq(format, "wav")
        is_mp3 = _core_eq(format, "mp3")
        format_ok = _core_or(is_wav, is_mp3)
        if format_ok:
            out = {}
            out["type"] = "input_audio"
            input_audio = {}
            input_audio["data"] = data
            input_audio["format"] = format
            out["input_audio"] = input_audio
            return out
        else:
            pass
        audio_message = _core_string_format("OpenAI audio chat input supports only wav and mp3 audio, received {}", format)
        audio_error = _core_ai_error_unsupported(audio_message)
        raise audio_error
    else:
        pass
    message = _core_string_format("OpenAI-compatible beta does not support content part type: {}", type)
    error = _core_ai_error_unsupported(message)
    raise error


def merge_usage_context(defaults: Any, overrides: Any) -> Any:
    _core_coverage_mark("merge_usage_context")
    merged = _core_map_merge(defaults, overrides)
    default_attributes = _core_get(defaults, "attributes", None)
    override_attributes = _core_get(overrides, "attributes", None)
    attributes = _core_map_merge(default_attributes, override_attributes)
    has_attributes = _core_truthy(attributes)
    if has_attributes:
        merged["attributes"] = attributes
    else:
        pass
    return merged


def build_usage_event(operation: str, response: Any, options: Any, streaming: bool) -> Any:
    _core_coverage_mark("build_usage_event")
    model_usage_snake = _core_get(response, "model_usage", None)
    top_model_usage = _core_get(response, "modelUsage", model_usage_snake)
    model_usage = top_model_usage
    results = _core_get(response, "results", None)
    for result in results:
        result_usage_snake = _core_get(result, "model_usage", None)
        result_usage = _core_get(result, "modelUsage", result_usage_snake)
        has_result_usage = _core_truthy(result_usage)
        if has_result_usage:
            model_usage = result_usage
        else:
            pass
    tokens = _core_get(model_usage, "tokens", None)
    has_tokens = _core_truthy(tokens)
    missing_tokens = _core_not(has_tokens)
    if missing_tokens:
        none = _core_none()
        return none
    else:
        pass
    event = {}
    event["operation"] = operation
    ai_name = _core_get(model_usage, "ai", None)
    model = _core_get(model_usage, "model", None)
    normalized_tokens = normalize_token_usage(tokens)
    event["ai"] = ai_name
    event["model"] = model
    event["tokens"] = normalized_tokens
    event["streaming"] = streaming
    usage_context_snake = _core_get(options, "usage_context", None)
    usage_context = _core_get(options, "usageContext", usage_context_snake)
    has_context = _core_truthy(usage_context)
    if has_context:
        event["context"] = usage_context
    else:
        pass
    option_session_snake = _core_get(options, "session_id", None)
    option_session = _core_get(options, "sessionId", option_session_snake)
    response_session_snake = _core_get(response, "session_id", None)
    response_session = _core_get(response, "sessionId", response_session_snake)
    session_id = _core_coalesce(response_session, option_session)
    has_session_id = _core_is_not_none(session_id)
    if has_session_id:
        event["sessionId"] = session_id
    else:
        pass
    remote_id_snake = _core_get(response, "remote_id", None)
    remote_id = _core_get(response, "remoteId", remote_id_snake)
    has_remote_id = _core_is_not_none(remote_id)
    if has_remote_id:
        event["remoteId"] = remote_id
    else:
        pass
    remote_request_id_snake = _core_get(response, "remote_request_id", None)
    remote_request_id = _core_get(response, "remoteRequestId", remote_request_id_snake)
    has_remote_request_id = _core_is_not_none(remote_request_id)
    if has_remote_request_id:
        event["remoteRequestId"] = remote_request_id
    else:
        pass
    remote_session_id_snake = _core_get(response, "remote_session_id", None)
    remote_session_id = _core_get(response, "remoteSessionId", remote_session_id_snake)
    has_remote_session_id = _core_is_not_none(remote_session_id)
    if has_remote_session_id:
        event["remoteSessionId"] = remote_session_id
    else:
        pass
    return event


def _openai_tool_call_to_provider_impl(call: Any) -> Any:
    _core_coverage_mark("_openai_tool_call_to_provider_impl")
    fn = _core_get(call, "function", None)
    params = _core_get(fn, "params", None)
    params_is_string = _core_type_is(params, "string")
    if params_is_string:
        pass
    else:
        params_json = _core_json_stringify(params)
        params = params_json
    id = _core_get(call, "id", None)
    name = _core_get(fn, "name", None)
    function = {}
    function["name"] = name
    function["arguments"] = params
    out = {}
    out["id"] = id
    out["type"] = "function"
    out["function"] = function
    return out


def _ai_model_usage_impl(ai_name: str, model: str, usage: Any) -> Any:
    _core_coverage_mark("_ai_model_usage_impl")
    has_usage = _core_truthy(usage)
    missing_usage = _core_not(has_usage)
    if missing_usage:
        none = _core_none()
        return none
    else:
        pass
    tokens = normalize_token_usage(usage)
    out = {}
    out["ai"] = ai_name
    out["model"] = model
    out["tokens"] = tokens
    return out


def _openai_tool_spec_impl(fn: Any) -> Any:
    _core_coverage_mark("_openai_tool_spec_impl")
    name = _core_get(fn, "name", None)
    description = _core_get(fn, "description", "")
    parameters = _core_get(fn, "parameters", None)
    function = {}
    function["name"] = name
    function["description"] = description
    has_parameters = _core_truthy(parameters)
    if has_parameters:
        function["parameters"] = parameters
    else:
        pass
    out = {}
    out["type"] = "function"
    out["function"] = function
    return out


def _chat_result_to_completion(result: Any, fallback_index: number) -> Any:
    _core_coverage_mark("_chat_result_to_completion")
    content = _core_get(result, "content", "")
    calls = []
    empty_calls = []
    function_calls = _core_get(result, "function_calls", empty_calls)
    for call in function_calls:
        fn = _core_get(call, "function", None)
        id = _core_get(call, "id", None)
        name = _core_get(fn, "name", None)
        params = _core_get(fn, "params", None)
        compat_call = {}
        compat_call["id"] = id
        compat_call["name"] = name
        compat_call["params"] = params
        calls.append(compat_call)
    index = _core_get(result, "index", fallback_index)
    thought = _core_get(result, "thought", None)
    has_thought = _core_is_not_none(thought)
    thought_blocks = _core_get(result, "thought_blocks", None)
    has_thought_blocks = _core_is_not_none(thought_blocks)
    completion = {}
    completion["index"] = index
    completion["content"] = content
    completion["function_calls"] = calls
    if has_thought:
        completion["thought"] = thought
    else:
        pass
    if has_thought_blocks:
        completion["thought_blocks"] = thought_blocks
    else:
        pass
    return completion


def openai_build_embed_request(request: AxEmbedRequest) -> Any:
    _core_coverage_mark("openai_build_embed_request")
    embed_model_snake = _core_get(request, "embed_model", None)
    model = _core_get(request, "embedModel", embed_model_snake)
    empty_texts = []
    texts = _core_get(request, "texts", empty_texts)
    payload = {}
    payload["model"] = model
    payload["input"] = texts
    dimensions = _core_get(request, "dimensions", None)
    has_dimensions = _core_truthy(dimensions)
    if has_dimensions:
        payload["dimensions"] = dimensions
    else:
        pass
    return payload


def openai_normalize_chat_response(raw: Any, ai_name: str = "openai", model: str = None) -> AxChatResponse:
    _core_coverage_mark("openai_normalize_chat_response")
    response = _openai_normalize_chat_response_impl(raw, ai_name, model, "none", "none")
    return response


def chat_response_to_completion(response: AxChatResponse) -> Any:
    _core_coverage_mark("chat_response_to_completion")
    empty_results = []
    results = _core_get(response, "results", empty_results)
    completions = []
    position = 0
    for result in results:
        completion = _chat_result_to_completion(result, position)
        completions.append(completion)
        next_position = _core_add(position, 1)
        position = next_position
    empty_completion = {}
    first = _core_list_get(completions, 0, empty_completion)
    content = _core_get(first, "content", "")
    calls = _core_get(first, "function_calls", empty_results)
    model_usage = _core_get(response, "model_usage", None)
    usage = _core_get(model_usage, "tokens", None)
    thought = _core_get(first, "thought", None)
    has_thought = _core_is_not_none(thought)
    thought_blocks = _core_get(first, "thought_blocks", None)
    has_thought_blocks = _core_is_not_none(thought_blocks)
    out = {}
    out["content"] = content
    out["function_calls"] = calls
    out["results"] = completions
    out["usage"] = usage
    if has_thought:
        out["thought"] = thought
    else:
        pass
    if has_thought_blocks:
        out["thought_blocks"] = thought_blocks
    else:
        pass
    return out


def _openai_usage_with_service_tier(raw: Any, usage: Any) -> Any:
    _core_coverage_mark("_openai_usage_with_service_tier")
    has_usage = _core_is_not_none(usage)
    if has_usage:
        pass
    else:
        return usage
    empty = {}
    out = _core_map_merge(empty, usage)
    usage_tier = _core_get(usage, "service_tier", None)
    raw_tier = _core_get(raw, "service_tier", usage_tier)
    tier = _core_get(raw, "service_tier_used", raw_tier)
    has_tier = _core_is_not_none(tier)
    if has_tier:
        out["service_tier"] = tier
    else:
        pass
    return out


def _openai_normalize_chat_response_impl(raw: Any, ai_name: str, model: str, reasoning_content_mode: str, reasoning_details_mode: str) -> AxChatResponse:
    _core_coverage_mark("_openai_normalize_chat_response_impl")
    raw_is_object = _core_type_is(raw, "object")
    raw_not_object = _core_not(raw_is_object)
    if raw_not_object:
        error = _core_ai_error_response("provider response must be a JSON object", raw)
        raise error
    else:
        pass
    provider_error = _core_get(raw, "error", None)
    has_provider_error = _core_truthy(provider_error)
    if has_provider_error:
        message = _core_get(provider_error, "message", "provider response error")
        error = _core_ai_error_response(message, raw)
        raise error
    else:
        pass
    choices = _core_get(raw, "choices", None)
    choices_is_list = _core_type_is(choices, "list")
    bad_choices = _core_not(choices_is_list)
    if bad_choices:
        error = _core_ai_error_response("provider response missing choices", raw)
        raise error
    else:
        pass
    results = []
    for choice in choices:
        result = _openai_normalize_choice_impl(choice, raw, reasoning_content_mode, reasoning_details_mode)
        results.append(result)
    raw_model = _core_get(raw, "model", None)
    used_model = _core_coalesce(raw_model, model)
    raw_usage = _core_get(raw, "usage", None)
    usage = _openai_usage_with_service_tier(raw, raw_usage)
    model_usage = _ai_model_usage_impl(ai_name, used_model, usage)
    remote_id = _core_get(raw, "id", None)
    out = {}
    out["results"] = results
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def ai_context_cache_rejection(status: number, body_json: Any) -> bool:
    _core_coverage_mark("ai_context_cache_rejection")
    status_400_min = _core_gte(status, 400)
    status_400_max = _core_lte(status, 400)
    is_400 = _core_and(status_400_min, status_400_max)
    status_404_min = _core_gte(status, 404)
    status_404_max = _core_lte(status, 404)
    is_404 = _core_and(status_404_min, status_404_max)
    valid_status = _core_or(is_400, is_404)
    body_text = _core_json_stringify(body_json)
    body_lower = _core_string_lower(body_text)
    names_compact = _core_contains(body_lower, "cachedcontent")
    names_spaced = _core_contains(body_lower, "cached content")
    names_resource = _core_contains(body_lower, "cachedcontents/")
    names_left = _core_or(names_compact, names_spaced)
    names_cache = _core_or(names_left, names_resource)
    has_cache = _core_contains(body_lower, "cache")
    expired = _core_contains(body_lower, "expired")
    not_found = _core_contains(body_lower, "not found")
    missing = _core_contains(body_lower, "does not exist")
    invalid = _core_contains(body_lower, "invalid")
    invalid_left = _core_or(expired, not_found)
    invalid_right = _core_or(missing, invalid)
    invalid_reason = _core_or(invalid_left, invalid_right)
    invalid_cache = _core_and(has_cache, invalid_reason)
    cache_rejection = _core_or(names_cache, invalid_cache)
    out = _core_and(valid_status, cache_rejection)
    return out


def _openai_normalize_choice_impl(choice: Any, raw: Any, reasoning_content_mode: str, reasoning_details_mode: str) -> Any:
    _core_coverage_mark("_openai_normalize_choice_impl")
    empty_message = {}
    message = _core_get(choice, "message", empty_message)
    refusal = _core_get(message, "refusal", None)
    has_refusal = _core_truthy(refusal)
    if has_refusal:
        error = _core_ai_error_refusal(refusal, raw)
        raise error
    else:
        pass
    index = _core_get(choice, "index", 0)
    id = _core_string_str(index)
    content_raw = _core_get(message, "content", None)
    content = _core_none()
    has_content = _core_truthy(content_raw)
    if has_content:
        content = content_raw
    else:
        content = _core_none()
    empty_calls = []
    tool_calls = _core_get(message, "tool_calls", empty_calls)
    function_calls = _openai_normalize_tool_calls_impl(tool_calls)
    finish_reason_raw = _core_get(choice, "finish_reason", None)
    finish_reason = _openai_finish_reason_impl(finish_reason_raw)
    out = {}
    out["index"] = index
    out["id"] = id
    out["content"] = content
    reasoning_content = _core_get(message, reasoning_content_mode, None)
    has_reasoning_content = _core_truthy(reasoning_content)
    is_no_reasoning = _core_eq(reasoning_content_mode, "none")
    has_reasoning_mode = _core_not(is_no_reasoning)
    include_reasoning_content = _core_and(has_reasoning_mode, has_reasoning_content)
    if include_reasoning_content:
        out["thought"] = reasoning_content
        thought_blocks = []
        thought_block = {}
        thought_block["data"] = reasoning_content
        thought_block["encrypted"] = False
        thought_blocks.append(thought_block)
        out["thought_blocks"] = thought_blocks
    else:
        pass
    is_no_details = _core_eq(reasoning_details_mode, "none")
    has_details_mode = _core_not(is_no_details)
    reasoning_details = _core_get(message, reasoning_details_mode, None)
    has_reasoning_details = _core_truthy(reasoning_details)
    include_reasoning_details = _core_and(has_details_mode, has_reasoning_details)
    if include_reasoning_details:
        detail_blocks = []
        for detail in reasoning_details:
            detail_block = {}
            data = _core_json_stringify(detail)
            detail_block["data"] = data
            type = _core_get(detail, "type", "")
            encrypted = _core_contains(type, "encrypted")
            detail_block["encrypted"] = encrypted
            detail_id = _core_get(detail, "id", None)
            has_detail_id = _core_truthy(detail_id)
            if has_detail_id:
                detail_block["signature"] = detail_id
            else:
                pass
            detail_blocks.append(detail_block)
        out["thought_blocks"] = detail_blocks
    else:
        pass
    out["function_calls"] = function_calls
    out["finish_reason"] = finish_reason
    return out


def ai_context_cache_expiry(provider_expire_time: Any, now: number) -> number:
    _core_coverage_mark("ai_context_cache_expiry")
    is_number = _core_type_is(provider_expire_time, "number")
    if is_number:
        future = _core_gt(provider_expire_time, now)
        if future:
            return provider_expire_time
        else:
            pass
    else:
        pass
    return 0


def ai_context_cache_plan(configured: bool, supported: bool, explicit_name: str, existing: Any, now: number, refresh_window_ms: number, create_eligible: bool) -> Any:
    _core_coverage_mark("ai_context_cache_plan")
    out = {}
    out["action"] = "none"
    out["managed"] = False
    enabled = _core_and(configured, supported)
    disabled = _core_not(enabled)
    if disabled:
        return out
    else:
        pass
    explicit_length = _core_len(explicit_name)
    has_explicit = _core_gt(explicit_length, 0)
    if has_explicit:
        out["action"] = "use"
        out["cacheName"] = explicit_name
        return out
    else:
        pass
    existing_object = _core_type_is(existing, "object")
    if existing_object:
        cache_name = _core_get(existing, "cacheName", "")
        expires_at = _core_get(existing, "expiresAt", 0)
        cache_name_length = _core_len(cache_name)
        has_name = _core_gt(cache_name_length, 0)
        future = _core_gt(expires_at, now)
        valid = _core_and(has_name, future)
        if valid:
            refresh_at = _core_add(now, refresh_window_ms)
            needs_refresh = _core_lt(expires_at, refresh_at)
            out["managed"] = True
            out["cacheName"] = cache_name
            if needs_refresh:
                out["action"] = "refresh"
            else:
                out["action"] = "use"
            return out
        else:
            pass
    else:
        pass
    if create_eligible:
        out["action"] = "create"
        out["managed"] = True
    else:
        pass
    return out


def ai_context_cache_recovery(current_entry: Any, cache_name: str, external_registry: bool) -> Any:
    _core_coverage_mark("ai_context_cache_recovery")
    out = {}
    out["invalidated"] = False
    out["deleteInMemory"] = False
    entry_object = _core_type_is(current_entry, "object")
    if entry_object:
        current_name = _core_get(current_entry, "cacheName", "")
        matches = _core_eq(current_name, cache_name)
        if matches:
            out["invalidated"] = True
            if external_registry:
                empty = {}
                tombstone = _core_map_merge(current_entry, empty)
                tombstone["expiresAt"] = 0
                out["externalEntry"] = tombstone
            else:
                out["deleteInMemory"] = True
        else:
            pass
    else:
        pass
    return out


def _openai_normalize_tool_calls_impl(calls: list[Any]) -> list[Any]:
    _core_coverage_mark("_openai_normalize_tool_calls_impl")
    out = []
    for call in calls:
        fn = _core_get(call, "function", None)
        params = _core_get(fn, "arguments", None)
        params_is_string = _core_type_is(params, "string")
        if params_is_string:
            try:
                parsed_params = _core_json_parse(params)
                params = parsed_params
            except Exception as parse_error:
                pass
        else:
            pass
        id = _core_get(call, "id", None)
        name = _core_get(fn, "name", None)
        function = {}
        function["name"] = name
        function["params"] = params
        normalized = {}
        normalized["id"] = id
        normalized["type"] = "function"
        normalized["function"] = function
        out.append(normalized)
    return out


def ai_gemini_cache_ops(cache_name: str, ttl_seconds: number, api_key: str, model: str, create_body: Any, options: Any) -> Any:
    _core_coverage_mark("ai_gemini_cache_ops")
    ttl = _core_string_format("{}s", ttl_seconds)
    descriptor = provider_resolve_descriptor("google-gemini", options)
    is_vertex = _core_get(descriptor, "vertex", False)
    create_path = "/cachedContents"
    update_path = _core_string_format("/{}?updateMask=ttl", cache_name)
    delete_path = _core_string_format("/{}", cache_name)
    if is_vertex:
        parent = _core_get(descriptor, "vertexParent", "")
        create_path = _core_string_format("/{}/cachedContents", parent)
        update_path = _core_string_format("/{}?updateMask=ttl", cache_name)
        delete_path = _core_string_format("/{}", cache_name)
    else:
        pass
    create_request = {}
    create_is_object = _core_type_is(create_body, "object")
    if create_is_object:
        empty = {}
        create_copy = _core_map_merge(create_body, empty)
        create_request = create_copy
    else:
        pass
    model_resource = _core_string_format("models/{}", model)
    if is_vertex:
        parent = _core_get(descriptor, "vertexParent", "")
        model_resource = _core_string_format("{}/publishers/google/models/{}", parent, model)
    else:
        pass
    create_request["model"] = model_resource
    create_request["ttl"] = ttl
    update_request = {}
    update_request["ttl"] = ttl
    empty_request = {}
    create = {}
    create["method"] = "POST"
    create["path"] = create_path
    create["request"] = create_request
    cache_base_url = _core_get(descriptor, "vertexCacheBaseUrl", None)
    has_cache_base_url = _core_truthy(cache_base_url)
    if has_cache_base_url:
        create["base_url"] = cache_base_url
    else:
        pass
    update = {}
    update["method"] = "PATCH"
    update["path"] = update_path
    update["request"] = update_request
    if has_cache_base_url:
        update["base_url"] = cache_base_url
    else:
        pass
    delete_op = {}
    delete_op["method"] = "DELETE"
    delete_op["path"] = delete_path
    delete_op["request"] = empty_request
    if has_cache_base_url:
        delete_op["base_url"] = cache_base_url
    else:
        pass
    out = {}
    out["create"] = create
    out["update"] = update
    out["delete"] = delete_op
    return out


def _openai_finish_reason_impl(value: Any) -> Any:
    _core_coverage_mark("_openai_finish_reason_impl")
    is_stop = _core_eq(value, "stop")
    if is_stop:
        return "stop"
    else:
        pass
    is_length = _core_eq(value, "length")
    if is_length:
        return "length"
    else:
        pass
    is_content_filter = _core_eq(value, "content_filter")
    if is_content_filter:
        return "error"
    else:
        pass
    is_tool_calls = _core_eq(value, "tool_calls")
    is_function_call = _core_eq(value, "function_call")
    is_call = _core_or(is_tool_calls, is_function_call)
    if is_call:
        return "function_call"
    else:
        pass
    none = _core_none()
    return none


def openai_normalize_embed_response(raw: Any, ai_name: str = "openai", model: str = None) -> AxEmbedResponse:
    _core_coverage_mark("openai_normalize_embed_response")
    embeddings = []
    empty_data = []
    data = _core_get(raw, "data", empty_data)
    for item in data:
        embedding = _core_get(item, "embedding", None)
        embeddings.append(embedding)
    raw_model = _core_get(raw, "model", None)
    used_model = _core_coalesce(raw_model, model)
    raw_usage = _core_get(raw, "usage", None)
    usage = _openai_usage_with_service_tier(raw, raw_usage)
    model_usage = _ai_model_usage_impl(ai_name, used_model, usage)
    remote_id = _core_get(raw, "id", None)
    out = {}
    out["embeddings"] = embeddings
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def openai_normalize_stream_delta(raw: Any, state: Any, ai_name: str = "openai", model: str = None) -> AxChatResponse:
    _core_coverage_mark("openai_normalize_stream_delta")
    response = _openai_normalize_stream_delta_impl(raw, state, ai_name, model, "none", "none")
    return response


def _openai_normalize_stream_delta_impl(raw: Any, state: Any, ai_name: str, model: str, reasoning_content_mode: str, reasoning_details_mode: str) -> AxChatResponse:
    _core_coverage_mark("_openai_normalize_stream_delta_impl")
    raw_is_object = _core_type_is(raw, "object")
    raw_not_object = _core_not(raw_is_object)
    if raw_not_object:
        error = _core_ai_error_stream("provider stream event must be a JSON object", raw, True)
        raise error
    else:
        pass
    provider_error = _core_get(raw, "error", None)
    has_provider_error = _core_truthy(provider_error)
    if has_provider_error:
        message = _core_get(provider_error, "message", "provider stream error")
        error = _core_ai_error_stream(message, raw, True)
        raise error
    else:
        pass
    index_ids = _core_get(state, "index_ids", None)
    missing_index_ids = _core_is_none(index_ids)
    if missing_index_ids:
        new_index_ids = {}
        state["index_ids"] = new_index_ids
        index_ids = new_index_ids
    else:
        pass
    raw_remote_id = _core_get(raw, "id", None)
    has_raw_remote_id = _core_truthy(raw_remote_id)
    if has_raw_remote_id:
        state["remote_id"] = raw_remote_id
    else:
        pass
    remote_id = _core_get(state, "remote_id", raw_remote_id)
    results = []
    empty_choices = []
    choices = _core_get(raw, "choices", empty_choices)
    for choice in choices:
        result = _openai_stream_choice_impl(choice, index_ids, reasoning_content_mode, reasoning_details_mode)
        results.append(result)
    raw_model = _core_get(raw, "model", None)
    used_model = _core_coalesce(raw_model, model)
    raw_usage = _core_get(raw, "usage", None)
    usage = _openai_usage_with_service_tier(raw, raw_usage)
    model_usage = _ai_model_usage_impl(ai_name, used_model, usage)
    out = {}
    out["results"] = results
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def _openai_stream_choice_impl(choice: Any, index_ids: Any, reasoning_content_mode: str, reasoning_details_mode: str) -> Any:
    _core_coverage_mark("_openai_stream_choice_impl")
    empty_delta = {}
    delta = _core_get(choice, "delta", empty_delta)
    calls = []
    empty_tool_calls = []
    tool_calls = _core_get(delta, "tool_calls", empty_tool_calls)
    for call in tool_calls:
        call_index = _core_get(call, "index", 0)
        call_id = _core_get(call, "id", None)
        has_call_id = _core_truthy(call_id)
        if has_call_id:
            index_ids[call_index] = call_id
        else:
            pass
        stable_id = _core_get(index_ids, call_index, None)
        has_stable_id = _core_truthy(stable_id)
        if has_stable_id:
            fn = _core_get(call, "function", None)
            name = _core_get(fn, "name", None)
            arguments = _core_get(fn, "arguments", None)
            function = {}
            function["name"] = name
            function["params"] = arguments
            normalized = {}
            normalized["id"] = stable_id
            normalized["type"] = "function"
            normalized["function"] = function
            calls.append(normalized)
        else:
            pass
    index = _core_get(choice, "index", 0)
    id = _core_string_str(index)
    content = _core_get(delta, "content", None)
    reasoning_content = _core_get(delta, reasoning_content_mode, None)
    has_reasoning_content = _core_truthy(reasoning_content)
    is_no_reasoning = _core_eq(reasoning_content_mode, "none")
    has_reasoning_mode = _core_not(is_no_reasoning)
    include_reasoning_content = _core_and(has_reasoning_mode, has_reasoning_content)
    finish_reason_raw = _core_get(choice, "finish_reason", None)
    finish_reason = _openai_finish_reason_impl(finish_reason_raw)
    out = {}
    out["index"] = index
    out["id"] = id
    out["content"] = content
    if include_reasoning_content:
        out["thought"] = reasoning_content
        thought_blocks = []
        thought_block = {}
        thought_block["data"] = reasoning_content
        thought_block["encrypted"] = False
        thought_blocks.append(thought_block)
        out["thought_blocks"] = thought_blocks
    else:
        pass
    is_no_details = _core_eq(reasoning_details_mode, "none")
    has_details_mode = _core_not(is_no_details)
    reasoning_details = _core_get(delta, reasoning_details_mode, None)
    has_reasoning_details = _core_truthy(reasoning_details)
    include_reasoning_details = _core_and(has_details_mode, has_reasoning_details)
    if include_reasoning_details:
        detail_blocks = []
        for detail in reasoning_details:
            detail_block = {}
            data = _core_json_stringify(detail)
            detail_block["data"] = data
            type = _core_get(detail, "type", "")
            encrypted = _core_contains(type, "encrypted")
            detail_block["encrypted"] = encrypted
            detail_id = _core_get(detail, "id", None)
            has_detail_id = _core_truthy(detail_id)
            if has_detail_id:
                detail_block["signature"] = detail_id
            else:
                pass
            detail_blocks.append(detail_block)
        out["thought_blocks"] = detail_blocks
    else:
        pass
    out["function_calls"] = calls
    out["finish_reason"] = finish_reason
    return out


def openai_normalize_error(status: int, body: Any, request: Any = None) -> AxAIServiceError:
    _core_coverage_mark("openai_normalize_error")
    message = body
    code = _core_none()
    body_is_object = _core_type_is(body, "object")
    if body_is_object:
        error_body = _core_get(body, "error", body)
        error_is_object = _core_type_is(error_body, "object")
        if error_is_object:
            body_text = _core_string_str(body)
            message_value = _core_get(error_body, "message", body_text)
            code_value = _core_get(error_body, "code", None)
            message = message_value
            code = code_value
        else:
            message_value = _core_string_str(error_body)
            message = message_value
    else:
        pass
    is_401 = _core_eq(status, 401)
    is_403 = _core_eq(status, 403)
    is_auth = _core_or(is_401, is_403)
    if is_auth:
        error = _core_ai_error_auth(message, status, code, body, request)
        return error
    else:
        pass
    is_408 = _core_eq(status, 408)
    is_504 = _core_eq(status, 504)
    is_timeout = _core_or(is_408, is_504)
    if is_timeout:
        error = _core_ai_error_timeout(message, status, code, body, request, True)
        return error
    else:
        pass
    is_429 = _core_eq(status, 429)
    is_500 = _core_eq(status, 500)
    is_502 = _core_eq(status, 502)
    is_503 = _core_eq(status, 503)
    is_529 = _core_eq(status, 529)
    retry_left = _core_or(is_429, is_500)
    retry_right = _core_or(is_502, is_503)
    retry_some = _core_or(retry_left, retry_right)
    retry_more = _core_or(retry_some, is_504)
    retryable = _core_or(retry_more, is_529)
    error = _core_ai_error_status(message, status, code, body, request, retryable)
    return error


def provider_normalize_profile(profile: str) -> str:
    _core_coverage_mark("provider_normalize_profile")
    normalized = _core_string_lower(profile)
    aliases = _core_json_parse("{\"openai\":\"openai\",\"openai-compatible\":\"openai-compatible\",\"openai_compatible\":\"openai-compatible\",\"compatible\":\"openai-compatible\",\"openai-responses\":\"openai-responses\",\"openai_responses\":\"openai-responses\",\"responses\":\"openai-responses\",\"anthropic\":\"anthropic\",\"claude\":\"anthropic\",\"google-gemini\":\"google-gemini\",\"google_gemini\":\"google-gemini\",\"gemini\":\"google-gemini\",\"webllm\":\"webllm\",\"azure-openai\":\"azure-openai\",\"azure_openai\":\"azure-openai\",\"azure\":\"azure-openai\",\"deepseek\":\"deepseek\",\"deepseek-responses\":\"deepseek-responses\",\"deepseek_responses\":\"deepseek-responses\",\"mistral\":\"mistral\",\"cohere\":\"cohere\",\"grok\":\"grok\",\"xai\":\"grok\",\"x-grok\":\"grok\",\"x_grok\":\"grok\",\"reka\":\"reka\",\"together\":\"together\",\"together-ai\":\"together\",\"together_ai\":\"together\",\"openrouter\":\"openrouter\",\"orcarouter\":\"orcarouter\",\"fireworks\":\"fireworks\",\"fireworks-ai\":\"fireworks\",\"huggingface-router\":\"huggingface-router\",\"huggingface\":\"huggingface-router\",\"hf-router\":\"huggingface-router\",\"amazon-bedrock\":\"amazon-bedrock\",\"bedrock\":\"amazon-bedrock\",\"azure-foundry\":\"azure-foundry\",\"azure-ai-foundry\":\"azure-foundry\",\"microsoft-foundry\":\"azure-foundry\",\"vertex-ai\":\"vertex-ai\",\"vertex-openai\":\"vertex-ai\",\"databricks\":\"databricks\",\"baseten\":\"baseten\",\"groq\":\"groq\",\"cerebras\":\"cerebras\",\"deepinfra\":\"deepinfra\",\"sambanova\":\"sambanova\",\"sambanova-cloud\":\"sambanova\",\"nebius\":\"nebius\",\"novita\":\"novita\",\"novita-ai\":\"novita\",\"hyperbolic\":\"hyperbolic\",\"siliconflow\":\"siliconflow\",\"friendli\":\"friendli\",\"friendli-ai\":\"friendli\",\"cloudflare-workers-ai\":\"cloudflare-workers-ai\",\"workers-ai\":\"cloudflare-workers-ai\",\"featherless\":\"featherless\",\"featherless-ai\":\"featherless\",\"nscale\":\"nscale\",\"ovhcloud\":\"ovhcloud\",\"ovh\":\"ovhcloud\",\"scaleway\":\"scaleway\",\"nvidia-nim\":\"nvidia-nim\",\"nim\":\"nvidia-nim\",\"runpod-vllm\":\"runpod-vllm\",\"runpod\":\"runpod-vllm\",\"sagemaker-vllm\":\"sagemaker-vllm\",\"sagemaker\":\"sagemaker-vllm\",\"vllm\":\"vllm\",\"ollama\":\"ollama\",\"lm-studio\":\"lm-studio\",\"lmstudio\":\"lm-studio\",\"llama-cpp\":\"llama-cpp\",\"llama.cpp\":\"llama-cpp\",\"localai\":\"localai\",\"local-ai\":\"localai\",\"baseten-engine\":\"baseten-engine\",\"truss\":\"baseten-engine\"}\n")
    provider_id = _core_get(aliases, normalized, "")
    return provider_id


def provider_profile_registry() -> Any:
    _core_coverage_mark("provider_profile_registry")
    registry = _core_json_parse("{\"registryVersion\":\"provider-profiles-v3\",\"supportedProfileIds\":[\"openai\",\"openai-compatible\",\"openai-responses\",\"anthropic\",\"google-gemini\",\"webllm\",\"azure-openai\",\"deepseek\",\"deepseek-responses\",\"mistral\",\"cohere\",\"grok\",\"reka\",\"together\",\"openrouter\",\"orcarouter\",\"fireworks\",\"huggingface-router\",\"amazon-bedrock\",\"azure-foundry\",\"vertex-ai\",\"databricks\",\"baseten\",\"groq\",\"cerebras\",\"deepinfra\",\"sambanova\",\"nebius\",\"novita\",\"hyperbolic\",\"siliconflow\",\"friendli\",\"cloudflare-workers-ai\",\"featherless\",\"nscale\",\"ovhcloud\",\"scaleway\",\"nvidia-nim\",\"runpod-vllm\",\"sagemaker-vllm\",\"vllm\",\"ollama\",\"lm-studio\",\"llama-cpp\",\"localai\",\"baseten-engine\"],\"profiles\":{\"openai\":{\"id\":\"openai\",\"aliases\":[\"openai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"openai-compatible\":{\"id\":\"openai-compatible\",\"aliases\":[\"openai-compatible\",\"openai_compatible\",\"compatible\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"openai-responses\":{\"id\":\"openai-responses\",\"aliases\":[\"openai-responses\",\"openai_responses\",\"responses\"],\"transport\":\"openai-responses\",\"generatedClient\":\"OpenAIResponsesClient\",\"catalogStatus\":\"descriptor-covered\"},\"anthropic\":{\"id\":\"anthropic\",\"aliases\":[\"anthropic\",\"claude\"],\"transport\":\"anthropic-messages\",\"generatedClient\":\"AnthropicClient\",\"catalogStatus\":\"descriptor-covered\"},\"google-gemini\":{\"id\":\"google-gemini\",\"aliases\":[\"google-gemini\",\"google_gemini\",\"gemini\"],\"transport\":\"gemini-generate-content\",\"generatedClient\":\"GoogleGeminiClient\",\"catalogStatus\":\"descriptor-covered\"},\"webllm\":{\"id\":\"webllm\",\"aliases\":[\"webllm\"],\"transport\":\"webllm\",\"generatedClient\":null,\"catalogStatus\":\"typescript-only\"},\"azure-openai\":{\"id\":\"azure-openai\",\"aliases\":[\"azure-openai\",\"azure_openai\",\"azure\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"deepseek\":{\"id\":\"deepseek\",\"aliases\":[\"deepseek\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"deepseek-responses\":{\"id\":\"deepseek-responses\",\"aliases\":[\"deepseek-responses\",\"deepseek_responses\"],\"transport\":\"openai-responses\",\"generatedClient\":\"OpenAIResponsesClient\",\"catalogStatus\":\"descriptor-covered\"},\"mistral\":{\"id\":\"mistral\",\"aliases\":[\"mistral\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"cohere\":{\"id\":\"cohere\",\"aliases\":[\"cohere\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"grok\":{\"id\":\"grok\",\"aliases\":[\"grok\",\"xai\",\"x-grok\",\"x_grok\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"reka\":{\"id\":\"reka\",\"aliases\":[\"reka\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"together\":{\"id\":\"together\",\"aliases\":[\"together\",\"together-ai\",\"together_ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"openrouter\":{\"id\":\"openrouter\",\"aliases\":[\"openrouter\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"orcarouter\":{\"id\":\"orcarouter\",\"aliases\":[\"orcarouter\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"fireworks\":{\"id\":\"fireworks\",\"aliases\":[\"fireworks\",\"fireworks-ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"huggingface-router\":{\"id\":\"huggingface-router\",\"aliases\":[\"huggingface-router\",\"huggingface\",\"hf-router\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"amazon-bedrock\":{\"id\":\"amazon-bedrock\",\"aliases\":[\"amazon-bedrock\",\"bedrock\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"azure-foundry\":{\"id\":\"azure-foundry\",\"aliases\":[\"azure-foundry\",\"azure-ai-foundry\",\"microsoft-foundry\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"vertex-ai\":{\"id\":\"vertex-ai\",\"aliases\":[\"vertex-ai\",\"vertex-openai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"databricks\":{\"id\":\"databricks\",\"aliases\":[\"databricks\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"baseten\":{\"id\":\"baseten\",\"aliases\":[\"baseten\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"groq\":{\"id\":\"groq\",\"aliases\":[\"groq\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"cerebras\":{\"id\":\"cerebras\",\"aliases\":[\"cerebras\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"deepinfra\":{\"id\":\"deepinfra\",\"aliases\":[\"deepinfra\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"sambanova\":{\"id\":\"sambanova\",\"aliases\":[\"sambanova\",\"sambanova-cloud\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"nebius\":{\"id\":\"nebius\",\"aliases\":[\"nebius\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"novita\":{\"id\":\"novita\",\"aliases\":[\"novita\",\"novita-ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"hyperbolic\":{\"id\":\"hyperbolic\",\"aliases\":[\"hyperbolic\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"siliconflow\":{\"id\":\"siliconflow\",\"aliases\":[\"siliconflow\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"friendli\":{\"id\":\"friendli\",\"aliases\":[\"friendli\",\"friendli-ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"cloudflare-workers-ai\":{\"id\":\"cloudflare-workers-ai\",\"aliases\":[\"cloudflare-workers-ai\",\"workers-ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"featherless\":{\"id\":\"featherless\",\"aliases\":[\"featherless\",\"featherless-ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"nscale\":{\"id\":\"nscale\",\"aliases\":[\"nscale\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"ovhcloud\":{\"id\":\"ovhcloud\",\"aliases\":[\"ovhcloud\",\"ovh\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"scaleway\":{\"id\":\"scaleway\",\"aliases\":[\"scaleway\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"nvidia-nim\":{\"id\":\"nvidia-nim\",\"aliases\":[\"nvidia-nim\",\"nim\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"runpod-vllm\":{\"id\":\"runpod-vllm\",\"aliases\":[\"runpod-vllm\",\"runpod\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"sagemaker-vllm\":{\"id\":\"sagemaker-vllm\",\"aliases\":[\"sagemaker-vllm\",\"sagemaker\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"vllm\":{\"id\":\"vllm\",\"aliases\":[\"vllm\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"ollama\":{\"id\":\"ollama\",\"aliases\":[\"ollama\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"lm-studio\":{\"id\":\"lm-studio\",\"aliases\":[\"lm-studio\",\"lmstudio\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"llama-cpp\":{\"id\":\"llama-cpp\",\"aliases\":[\"llama-cpp\",\"llama.cpp\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"localai\":{\"id\":\"localai\",\"aliases\":[\"localai\",\"local-ai\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"},\"baseten-engine\":{\"id\":\"baseten-engine\",\"aliases\":[\"baseten-engine\",\"truss\"],\"transport\":\"openai-chat\",\"generatedClient\":\"OpenAICompatibleClient\",\"catalogStatus\":\"descriptor-covered\"}},\"deferredCatalogProviderIds\":[]}\n")
    return registry


def provider_resolve_profile(profile: str) -> Any:
    _core_coverage_mark("provider_resolve_profile")
    normalized = _core_string_lower(profile)
    aliases = _core_json_parse("{\"openai\":\"openai\",\"openai-compatible\":\"openai-compatible\",\"openai_compatible\":\"openai-compatible\",\"compatible\":\"openai-compatible\",\"openai-responses\":\"openai-responses\",\"openai_responses\":\"openai-responses\",\"responses\":\"openai-responses\",\"anthropic\":\"anthropic\",\"claude\":\"anthropic\",\"google-gemini\":\"google-gemini\",\"google_gemini\":\"google-gemini\",\"gemini\":\"google-gemini\",\"webllm\":\"webllm\",\"azure-openai\":\"azure-openai\",\"azure_openai\":\"azure-openai\",\"azure\":\"azure-openai\",\"deepseek\":\"deepseek\",\"deepseek-responses\":\"deepseek-responses\",\"deepseek_responses\":\"deepseek-responses\",\"mistral\":\"mistral\",\"cohere\":\"cohere\",\"grok\":\"grok\",\"xai\":\"grok\",\"x-grok\":\"grok\",\"x_grok\":\"grok\",\"reka\":\"reka\",\"together\":\"together\",\"together-ai\":\"together\",\"together_ai\":\"together\",\"openrouter\":\"openrouter\",\"orcarouter\":\"orcarouter\",\"fireworks\":\"fireworks\",\"fireworks-ai\":\"fireworks\",\"huggingface-router\":\"huggingface-router\",\"huggingface\":\"huggingface-router\",\"hf-router\":\"huggingface-router\",\"amazon-bedrock\":\"amazon-bedrock\",\"bedrock\":\"amazon-bedrock\",\"azure-foundry\":\"azure-foundry\",\"azure-ai-foundry\":\"azure-foundry\",\"microsoft-foundry\":\"azure-foundry\",\"vertex-ai\":\"vertex-ai\",\"vertex-openai\":\"vertex-ai\",\"databricks\":\"databricks\",\"baseten\":\"baseten\",\"groq\":\"groq\",\"cerebras\":\"cerebras\",\"deepinfra\":\"deepinfra\",\"sambanova\":\"sambanova\",\"sambanova-cloud\":\"sambanova\",\"nebius\":\"nebius\",\"novita\":\"novita\",\"novita-ai\":\"novita\",\"hyperbolic\":\"hyperbolic\",\"siliconflow\":\"siliconflow\",\"friendli\":\"friendli\",\"friendli-ai\":\"friendli\",\"cloudflare-workers-ai\":\"cloudflare-workers-ai\",\"workers-ai\":\"cloudflare-workers-ai\",\"featherless\":\"featherless\",\"featherless-ai\":\"featherless\",\"nscale\":\"nscale\",\"ovhcloud\":\"ovhcloud\",\"ovh\":\"ovhcloud\",\"scaleway\":\"scaleway\",\"nvidia-nim\":\"nvidia-nim\",\"nim\":\"nvidia-nim\",\"runpod-vllm\":\"runpod-vllm\",\"runpod\":\"runpod-vllm\",\"sagemaker-vllm\":\"sagemaker-vllm\",\"sagemaker\":\"sagemaker-vllm\",\"vllm\":\"vllm\",\"ollama\":\"ollama\",\"lm-studio\":\"lm-studio\",\"lmstudio\":\"lm-studio\",\"llama-cpp\":\"llama-cpp\",\"llama.cpp\":\"llama-cpp\",\"localai\":\"localai\",\"local-ai\":\"localai\",\"baseten-engine\":\"baseten-engine\",\"truss\":\"baseten-engine\"}\n")
    is_known = _core_map_contains(aliases, normalized)
    provider_id = provider_normalize_profile(profile)
    resolved = {}
    resolved["id"] = provider_id
    resolved["known"] = is_known
    resolved["input"] = profile
    return resolved


def provider_model_catalog_summary() -> Any:
    _core_coverage_mark("provider_model_catalog_summary")
    summary = _core_json_parse("{\"catalogVersion\":\"provider-model-catalog-audit-v1\",\"deferredProviderIds\":[],\"descriptorCoveredProviderIds\":[\"openai\",\"openai-compatible\",\"openai-responses\",\"anthropic\",\"google-gemini\",\"azure-openai\",\"deepseek\",\"deepseek-responses\",\"mistral\",\"cohere\",\"grok\",\"reka\",\"together\",\"openrouter\",\"orcarouter\",\"fireworks\",\"huggingface-router\",\"amazon-bedrock\",\"azure-foundry\",\"vertex-ai\",\"databricks\",\"baseten\",\"groq\",\"cerebras\",\"deepinfra\",\"sambanova\",\"nebius\",\"novita\",\"hyperbolic\",\"siliconflow\",\"friendli\",\"cloudflare-workers-ai\",\"featherless\",\"nscale\",\"ovhcloud\",\"scaleway\",\"nvidia-nim\",\"runpod-vllm\",\"sagemaker-vllm\",\"vllm\",\"ollama\",\"lm-studio\",\"llama-cpp\",\"localai\",\"baseten-engine\"],\"filterOptions\":[\"all\",\"text\",\"embeddings\",\"code\",\"audio\"],\"nextMilestone\":\"Generated catalog provider clients match the active catalog\",\"providerCount\":46,\"providerNames\":[\"google-gemini\",\"webllm\",\"openai\",\"cohere\",\"mistral\",\"deepseek\",\"deepseek-responses\",\"openai-responses\",\"grok\",\"reka\",\"anthropic\",\"openai-compatible\",\"azure-openai\",\"together\",\"openrouter\",\"orcarouter\",\"fireworks\",\"huggingface-router\",\"amazon-bedrock\",\"azure-foundry\",\"vertex-ai\",\"databricks\",\"baseten\",\"groq\",\"cerebras\",\"deepinfra\",\"sambanova\",\"nebius\",\"novita\",\"hyperbolic\",\"siliconflow\",\"friendli\",\"cloudflare-workers-ai\",\"featherless\",\"nscale\",\"ovhcloud\",\"scaleway\",\"nvidia-nim\",\"runpod-vllm\",\"sagemaker-vllm\",\"vllm\",\"ollama\",\"lm-studio\",\"llama-cpp\",\"localai\",\"baseten-engine\"],\"semantics\":{\"codeMatchesTextFilter\":true,\"dynamicProvidersMayHaveEmptyModels\":true,\"metadataClonedPerCall\":true,\"modelSort\":\"price-then-name\",\"providerSort\":\"cheapest-model-then-display-name\"},\"source\":\"src/ax/ai/catalog.ts\"}")
    return summary


def _provider_model_catalog_registry() -> Any:
    _core_coverage_mark("_provider_model_catalog_registry")
    catalog = _core_json_parse("{\"all\":[{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-flash-thinking-exp-01-21\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-pro-exp-02-05\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-robotics-er-1.6-preview\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-embedding-001\",\"promptTokenCostPer1M\":0.15,\"provider\":\"google-gemini\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash-8b\",\"promptTokenCostPer1M\":0.0375,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-embedding-2\",\"promptTokenCostPer1M\":0.2,\"provider\":\"google-gemini\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash-lite\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.5-flash-lite\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-lite-latest\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-lite\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-lite-preview\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.0-pro\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.134,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-pro-image-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-2.5-flash\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.5-flash-lite\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.05,\"cacheWriteTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-flash-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-image-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"audio\":{\"input\":false,\"output\":true},\"capabilities\":{\"audioInput\":false,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-tts-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"audio\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"nano-banana-2\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"characterIsToken\":false,\"completionTokenCostPer1M\":7.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.6-flash\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"characterIsToken\":false,\"completionTokenCostPer1M\":7.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.7-flash\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":9,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.5-flash\",\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-2.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-pro-latest\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":12,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":200000,\"name\":\"gemini-3.1-pro-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-live-preview\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":8192,\"name\":\"gemini-2.5-flash-native-audio-preview-12-2025\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"}],\"name\":\"google-gemini\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-2b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-9b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"maxTokens\":4096,\"name\":\"Llama-3.1-70B-Instruct-q4f16_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Llama-3.1-8B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Llama-3.2-1B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":2048,\"name\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Mistral-7B-Instruct-v0.3-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Phi-3.5-mini-instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-0.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-1.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Qwen2.5-7B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"}],\"name\":\"webllm\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.02,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"text-embedding-3-small\",\"promptTokenCostPer1M\":0.02,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-ada-002\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.13,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-3-large\",\"promptTokenCostPer1M\":0.13,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.02,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.2,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.04,\"longContextCompletionTokenCostPer1M\":1.8,\"longContextPromptTokenCostPer1M\":0.4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-luna\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":12,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-terra\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"gpt-5.6\"],\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-sol\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-mini\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-2\",\"provider\":\"openai\",\"supported\":{\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":false},\"capabilities\":{\"audioInput\":true,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-whisper\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-translate\",\"provider\":\"openai\",\"type\":\"audio\"}],\"name\":\"openai\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-light\",\"promptTokenCostPer1M\":0.3,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-r\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"command-r-plus\",\"promptTokenCostPer1M\":3,\"provider\":\"cohere\",\"type\":\"text\"}],\"name\":\"cohere\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.15,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-nemo-latest\",\"promptTokenCostPer1M\":0.15,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-codestral-mamba\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-7b\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.3,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-nemo-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"codestral-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":true,\"name\":\"mistral-small-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.7,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mixtral-8x7b\",\"promptTokenCostPer1M\":0.7,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-large-latest\",\"promptTokenCostPer1M\":2,\"provider\":\"mistral\",\"type\":\"text\"}],\"name\":\"mistral\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"deepseek-chat\",\"deepseek-reasoner\"],\"cacheReadTokenCostPer1M\":0.0028,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.28,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":true,\"maxTokens\":384000,\"name\":\"deepseek-v4-flash\",\"promptTokenCostPer1M\":0.14,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.003625,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.87,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"maxTokens\":384000,\"name\":\"deepseek-v4-pro\",\"promptTokenCostPer1M\":0.435,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"deepseek\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek Responses\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"deepseek-chat\",\"deepseek-reasoner\"],\"cacheReadTokenCostPer1M\":0.0028,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.28,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":true,\"maxTokens\":384000,\"name\":\"deepseek-v4-flash\",\"promptTokenCostPer1M\":0.14,\"provider\":\"deepseek-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.003625,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.87,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"maxTokens\":384000,\"name\":\"deepseek-v4-pro\",\"promptTokenCostPer1M\":0.435,\"provider\":\"deepseek-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"deepseek-responses\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.02,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.2,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.04,\"longContextCompletionTokenCostPer1M\":1.8,\"longContextPromptTokenCostPer1M\":0.4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-luna\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":12,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-terra\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"gpt-5.6\"],\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-sol\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":80,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o3-pro\",\"promptTokenCostPer1M\":20,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":600,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o1-pro\",\"promptTokenCostPer1M\":150,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"openai-responses\"},{\"defaultModel\":\"grok-4.6\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"grok-4-1-fast-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-non-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4-1-fast-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini\",\"promptTokenCostPer1M\":0.3,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-multi-agent-0309\",\"grok-4.20-multi-agent-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-multi-agent\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-non-reasoning\",\"grok-4.20-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-non-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-reasoning\",\"grok-4.20-reasoning-latest\",\"grok-4.20\",\"grok-4.20-0309\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.3-latest\",\"grok-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.3\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini-fast\",\"promptTokenCostPer1M\":0.6,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.5-latest\",\"grok-build-latest\"],\"cacheReadTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":6,\"contextWindow\":500000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.5\",\"promptTokenCostPer1M\":2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3\",\"promptTokenCostPer1M\":3,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-fast\",\"promptTokenCostPer1M\":5,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"currency\":\"USD\",\"isDefault\":true,\"name\":\"grok-4.6\",\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-think-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"},{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"}],\"name\":\"grok\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-edge\",\"promptTokenCostPer1M\":0.4,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-flash\",\"promptTokenCostPer1M\":0.8,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"reka-core\",\"promptTokenCostPer1M\":3,\"provider\":\"reka\",\"type\":\"text\"}],\"name\":\"reka\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku-20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku@20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.24,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-instant-1.2\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.08,\"cacheWriteTokenCostPer1M\":1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku-latest\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku@20241022\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5@20251001\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":10,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":2,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":10,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":2,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-v2@20241022\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet@20240620\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet@20250219\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-sonnet-20240229\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5-20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5@20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4@20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5-20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5@20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":1,\"fastCacheWriteTokenCostPer1M\":12.5,\"fastCompletionTokenCostPer1M\":50,\"fastPromptTokenCostPer1M\":10,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-2.1\",\"promptTokenCostPer1M\":8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus-latest\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus@20240229\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1-20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1@20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4@20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"anthropic\"},{\"displayName\":\"OpenAI Compatible\",\"isDynamic\":true,\"models\":[],\"name\":\"openai-compatible\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"displayName\":\"Together AI\",\"isDynamic\":true,\"models\":[],\"name\":\"together\"},{\"displayName\":\"OpenRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"openrouter\"},{\"displayName\":\"OrcaRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"orcarouter\"},{\"displayName\":\"Fireworks AI\",\"isDynamic\":true,\"models\":[],\"name\":\"fireworks\"},{\"displayName\":\"Hugging Face Router\",\"isDynamic\":true,\"models\":[],\"name\":\"huggingface-router\"},{\"displayName\":\"Amazon Bedrock\",\"isDynamic\":true,\"models\":[],\"name\":\"amazon-bedrock\"},{\"displayName\":\"Azure AI Foundry\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-foundry\"},{\"displayName\":\"Vertex AI OpenAI Compatibility\",\"isDynamic\":true,\"models\":[],\"name\":\"vertex-ai\"},{\"displayName\":\"Databricks Model Serving\",\"isDynamic\":true,\"models\":[],\"name\":\"databricks\"},{\"displayName\":\"Baseten Model APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten\"},{\"displayName\":\"Groq\",\"isDynamic\":true,\"models\":[],\"name\":\"groq\"},{\"displayName\":\"Cerebras Inference\",\"isDynamic\":true,\"models\":[],\"name\":\"cerebras\"},{\"displayName\":\"DeepInfra\",\"isDynamic\":true,\"models\":[],\"name\":\"deepinfra\"},{\"displayName\":\"SambaNova Cloud\",\"isDynamic\":true,\"models\":[],\"name\":\"sambanova\"},{\"displayName\":\"Nebius AI Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"nebius\"},{\"displayName\":\"Novita AI\",\"isDynamic\":true,\"models\":[],\"name\":\"novita\"},{\"displayName\":\"Hyperbolic\",\"isDynamic\":true,\"models\":[],\"name\":\"hyperbolic\"},{\"displayName\":\"SiliconFlow\",\"isDynamic\":true,\"models\":[],\"name\":\"siliconflow\"},{\"displayName\":\"FriendliAI\",\"isDynamic\":true,\"models\":[],\"name\":\"friendli\"},{\"displayName\":\"Cloudflare Workers AI\",\"isDynamic\":true,\"models\":[],\"name\":\"cloudflare-workers-ai\"},{\"displayName\":\"Featherless AI\",\"isDynamic\":true,\"models\":[],\"name\":\"featherless\"},{\"displayName\":\"Nscale\",\"isDynamic\":true,\"models\":[],\"name\":\"nscale\"},{\"displayName\":\"OVHcloud AI Endpoints\",\"isDynamic\":true,\"models\":[],\"name\":\"ovhcloud\"},{\"displayName\":\"Scaleway Generative APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"scaleway\"},{\"displayName\":\"NVIDIA NIM\",\"isDynamic\":true,\"models\":[],\"name\":\"nvidia-nim\"},{\"displayName\":\"RunPod vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"runpod-vllm\"},{\"displayName\":\"SageMaker vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"sagemaker-vllm\"},{\"displayName\":\"vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"vllm\"},{\"displayName\":\"Ollama\",\"isDynamic\":true,\"models\":[],\"name\":\"ollama\"},{\"displayName\":\"LM Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"lm-studio\"},{\"displayName\":\"llama.cpp Server\",\"isDynamic\":true,\"models\":[],\"name\":\"llama-cpp\"},{\"displayName\":\"LocalAI\",\"isDynamic\":true,\"models\":[],\"name\":\"localai\"},{\"displayName\":\"Baseten Inference Engine\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten-engine\"}],\"audio\":[{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"audio\":{\"input\":false,\"output\":true},\"capabilities\":{\"audioInput\":false,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-tts-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-live-preview\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":8192,\"name\":\"gemini-2.5-flash-native-audio-preview-12-2025\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"}],\"name\":\"google-gemini\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-mini\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-2\",\"provider\":\"openai\",\"supported\":{\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":false},\"capabilities\":{\"audioInput\":true,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-whisper\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-translate\",\"provider\":\"openai\",\"type\":\"audio\"}],\"name\":\"openai\"},{\"displayName\":\"OpenAI Compatible\",\"isDynamic\":true,\"models\":[],\"name\":\"openai-compatible\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"openai-responses\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[],\"name\":\"anthropic\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[],\"name\":\"webllm\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek-responses\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[],\"name\":\"mistral\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[],\"name\":\"cohere\"},{\"defaultModel\":\"grok-4.6\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-think-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"},{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"}],\"name\":\"grok\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[],\"name\":\"reka\"},{\"displayName\":\"Together AI\",\"isDynamic\":true,\"models\":[],\"name\":\"together\"},{\"displayName\":\"OpenRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"openrouter\"},{\"displayName\":\"OrcaRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"orcarouter\"},{\"displayName\":\"Fireworks AI\",\"isDynamic\":true,\"models\":[],\"name\":\"fireworks\"},{\"displayName\":\"Hugging Face Router\",\"isDynamic\":true,\"models\":[],\"name\":\"huggingface-router\"},{\"displayName\":\"Amazon Bedrock\",\"isDynamic\":true,\"models\":[],\"name\":\"amazon-bedrock\"},{\"displayName\":\"Azure AI Foundry\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-foundry\"},{\"displayName\":\"Vertex AI OpenAI Compatibility\",\"isDynamic\":true,\"models\":[],\"name\":\"vertex-ai\"},{\"displayName\":\"Databricks Model Serving\",\"isDynamic\":true,\"models\":[],\"name\":\"databricks\"},{\"displayName\":\"Baseten Model APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten\"},{\"displayName\":\"Groq\",\"isDynamic\":true,\"models\":[],\"name\":\"groq\"},{\"displayName\":\"Cerebras Inference\",\"isDynamic\":true,\"models\":[],\"name\":\"cerebras\"},{\"displayName\":\"DeepInfra\",\"isDynamic\":true,\"models\":[],\"name\":\"deepinfra\"},{\"displayName\":\"SambaNova Cloud\",\"isDynamic\":true,\"models\":[],\"name\":\"sambanova\"},{\"displayName\":\"Nebius AI Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"nebius\"},{\"displayName\":\"Novita AI\",\"isDynamic\":true,\"models\":[],\"name\":\"novita\"},{\"displayName\":\"Hyperbolic\",\"isDynamic\":true,\"models\":[],\"name\":\"hyperbolic\"},{\"displayName\":\"SiliconFlow\",\"isDynamic\":true,\"models\":[],\"name\":\"siliconflow\"},{\"displayName\":\"FriendliAI\",\"isDynamic\":true,\"models\":[],\"name\":\"friendli\"},{\"displayName\":\"Cloudflare Workers AI\",\"isDynamic\":true,\"models\":[],\"name\":\"cloudflare-workers-ai\"},{\"displayName\":\"Featherless AI\",\"isDynamic\":true,\"models\":[],\"name\":\"featherless\"},{\"displayName\":\"Nscale\",\"isDynamic\":true,\"models\":[],\"name\":\"nscale\"},{\"displayName\":\"OVHcloud AI Endpoints\",\"isDynamic\":true,\"models\":[],\"name\":\"ovhcloud\"},{\"displayName\":\"Scaleway Generative APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"scaleway\"},{\"displayName\":\"NVIDIA NIM\",\"isDynamic\":true,\"models\":[],\"name\":\"nvidia-nim\"},{\"displayName\":\"RunPod vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"runpod-vllm\"},{\"displayName\":\"SageMaker vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"sagemaker-vllm\"},{\"displayName\":\"vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"vllm\"},{\"displayName\":\"Ollama\",\"isDynamic\":true,\"models\":[],\"name\":\"ollama\"},{\"displayName\":\"LM Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"lm-studio\"},{\"displayName\":\"llama.cpp Server\",\"isDynamic\":true,\"models\":[],\"name\":\"llama-cpp\"},{\"displayName\":\"LocalAI\",\"isDynamic\":true,\"models\":[],\"name\":\"localai\"},{\"displayName\":\"Baseten Inference Engine\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten-engine\"}],\"code\":[{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-codestral-mamba\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"codestral-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"code\"}],\"name\":\"mistral\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"}],\"name\":\"openai-responses\"},{\"displayName\":\"OpenAI Compatible\",\"isDynamic\":true,\"models\":[],\"name\":\"openai-compatible\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[],\"name\":\"anthropic\"},{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[],\"name\":\"google-gemini\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[],\"name\":\"webllm\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek-responses\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[],\"name\":\"cohere\"},{\"defaultModel\":\"grok-4.6\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[],\"name\":\"grok\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[],\"name\":\"reka\"},{\"displayName\":\"Together AI\",\"isDynamic\":true,\"models\":[],\"name\":\"together\"},{\"displayName\":\"OpenRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"openrouter\"},{\"displayName\":\"OrcaRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"orcarouter\"},{\"displayName\":\"Fireworks AI\",\"isDynamic\":true,\"models\":[],\"name\":\"fireworks\"},{\"displayName\":\"Hugging Face Router\",\"isDynamic\":true,\"models\":[],\"name\":\"huggingface-router\"},{\"displayName\":\"Amazon Bedrock\",\"isDynamic\":true,\"models\":[],\"name\":\"amazon-bedrock\"},{\"displayName\":\"Azure AI Foundry\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-foundry\"},{\"displayName\":\"Vertex AI OpenAI Compatibility\",\"isDynamic\":true,\"models\":[],\"name\":\"vertex-ai\"},{\"displayName\":\"Databricks Model Serving\",\"isDynamic\":true,\"models\":[],\"name\":\"databricks\"},{\"displayName\":\"Baseten Model APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten\"},{\"displayName\":\"Groq\",\"isDynamic\":true,\"models\":[],\"name\":\"groq\"},{\"displayName\":\"Cerebras Inference\",\"isDynamic\":true,\"models\":[],\"name\":\"cerebras\"},{\"displayName\":\"DeepInfra\",\"isDynamic\":true,\"models\":[],\"name\":\"deepinfra\"},{\"displayName\":\"SambaNova Cloud\",\"isDynamic\":true,\"models\":[],\"name\":\"sambanova\"},{\"displayName\":\"Nebius AI Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"nebius\"},{\"displayName\":\"Novita AI\",\"isDynamic\":true,\"models\":[],\"name\":\"novita\"},{\"displayName\":\"Hyperbolic\",\"isDynamic\":true,\"models\":[],\"name\":\"hyperbolic\"},{\"displayName\":\"SiliconFlow\",\"isDynamic\":true,\"models\":[],\"name\":\"siliconflow\"},{\"displayName\":\"FriendliAI\",\"isDynamic\":true,\"models\":[],\"name\":\"friendli\"},{\"displayName\":\"Cloudflare Workers AI\",\"isDynamic\":true,\"models\":[],\"name\":\"cloudflare-workers-ai\"},{\"displayName\":\"Featherless AI\",\"isDynamic\":true,\"models\":[],\"name\":\"featherless\"},{\"displayName\":\"Nscale\",\"isDynamic\":true,\"models\":[],\"name\":\"nscale\"},{\"displayName\":\"OVHcloud AI Endpoints\",\"isDynamic\":true,\"models\":[],\"name\":\"ovhcloud\"},{\"displayName\":\"Scaleway Generative APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"scaleway\"},{\"displayName\":\"NVIDIA NIM\",\"isDynamic\":true,\"models\":[],\"name\":\"nvidia-nim\"},{\"displayName\":\"RunPod vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"runpod-vllm\"},{\"displayName\":\"SageMaker vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"sagemaker-vllm\"},{\"displayName\":\"vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"vllm\"},{\"displayName\":\"Ollama\",\"isDynamic\":true,\"models\":[],\"name\":\"ollama\"},{\"displayName\":\"LM Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"lm-studio\"},{\"displayName\":\"llama.cpp Server\",\"isDynamic\":true,\"models\":[],\"name\":\"llama-cpp\"},{\"displayName\":\"LocalAI\",\"isDynamic\":true,\"models\":[],\"name\":\"localai\"},{\"displayName\":\"Baseten Inference Engine\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten-engine\"}],\"embeddings\":[{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.02,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"text-embedding-3-small\",\"promptTokenCostPer1M\":0.02,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-ada-002\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.13,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-3-large\",\"promptTokenCostPer1M\":0.13,\"provider\":\"openai\",\"type\":\"embeddings\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-embedding-001\",\"promptTokenCostPer1M\":0.15,\"provider\":\"google-gemini\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-embedding-2\",\"promptTokenCostPer1M\":0.2,\"provider\":\"google-gemini\",\"type\":\"embeddings\"}],\"name\":\"google-gemini\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"}],\"name\":\"cohere\"},{\"displayName\":\"OpenAI Compatible\",\"isDynamic\":true,\"models\":[],\"name\":\"openai-compatible\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"openai-responses\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[],\"name\":\"anthropic\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[],\"name\":\"webllm\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek-responses\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[],\"name\":\"mistral\"},{\"defaultModel\":\"grok-4.6\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[],\"name\":\"grok\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[],\"name\":\"reka\"},{\"displayName\":\"Together AI\",\"isDynamic\":true,\"models\":[],\"name\":\"together\"},{\"displayName\":\"OpenRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"openrouter\"},{\"displayName\":\"OrcaRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"orcarouter\"},{\"displayName\":\"Fireworks AI\",\"isDynamic\":true,\"models\":[],\"name\":\"fireworks\"},{\"displayName\":\"Hugging Face Router\",\"isDynamic\":true,\"models\":[],\"name\":\"huggingface-router\"},{\"displayName\":\"Amazon Bedrock\",\"isDynamic\":true,\"models\":[],\"name\":\"amazon-bedrock\"},{\"displayName\":\"Azure AI Foundry\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-foundry\"},{\"displayName\":\"Vertex AI OpenAI Compatibility\",\"isDynamic\":true,\"models\":[],\"name\":\"vertex-ai\"},{\"displayName\":\"Databricks Model Serving\",\"isDynamic\":true,\"models\":[],\"name\":\"databricks\"},{\"displayName\":\"Baseten Model APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten\"},{\"displayName\":\"Groq\",\"isDynamic\":true,\"models\":[],\"name\":\"groq\"},{\"displayName\":\"Cerebras Inference\",\"isDynamic\":true,\"models\":[],\"name\":\"cerebras\"},{\"displayName\":\"DeepInfra\",\"isDynamic\":true,\"models\":[],\"name\":\"deepinfra\"},{\"displayName\":\"SambaNova Cloud\",\"isDynamic\":true,\"models\":[],\"name\":\"sambanova\"},{\"displayName\":\"Nebius AI Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"nebius\"},{\"displayName\":\"Novita AI\",\"isDynamic\":true,\"models\":[],\"name\":\"novita\"},{\"displayName\":\"Hyperbolic\",\"isDynamic\":true,\"models\":[],\"name\":\"hyperbolic\"},{\"displayName\":\"SiliconFlow\",\"isDynamic\":true,\"models\":[],\"name\":\"siliconflow\"},{\"displayName\":\"FriendliAI\",\"isDynamic\":true,\"models\":[],\"name\":\"friendli\"},{\"displayName\":\"Cloudflare Workers AI\",\"isDynamic\":true,\"models\":[],\"name\":\"cloudflare-workers-ai\"},{\"displayName\":\"Featherless AI\",\"isDynamic\":true,\"models\":[],\"name\":\"featherless\"},{\"displayName\":\"Nscale\",\"isDynamic\":true,\"models\":[],\"name\":\"nscale\"},{\"displayName\":\"OVHcloud AI Endpoints\",\"isDynamic\":true,\"models\":[],\"name\":\"ovhcloud\"},{\"displayName\":\"Scaleway Generative APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"scaleway\"},{\"displayName\":\"NVIDIA NIM\",\"isDynamic\":true,\"models\":[],\"name\":\"nvidia-nim\"},{\"displayName\":\"RunPod vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"runpod-vllm\"},{\"displayName\":\"SageMaker vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"sagemaker-vllm\"},{\"displayName\":\"vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"vllm\"},{\"displayName\":\"Ollama\",\"isDynamic\":true,\"models\":[],\"name\":\"ollama\"},{\"displayName\":\"LM Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"lm-studio\"},{\"displayName\":\"llama.cpp Server\",\"isDynamic\":true,\"models\":[],\"name\":\"llama-cpp\"},{\"displayName\":\"LocalAI\",\"isDynamic\":true,\"models\":[],\"name\":\"localai\"},{\"displayName\":\"Baseten Inference Engine\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten-engine\"}],\"text\":[{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-flash-thinking-exp-01-21\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-pro-exp-02-05\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-robotics-er-1.6-preview\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash-8b\",\"promptTokenCostPer1M\":0.0375,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash-lite\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.5-flash-lite\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-lite-latest\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-lite\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-lite-preview\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.0-pro\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.134,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-pro-image-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-2.5-flash\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.5-flash-lite\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.05,\"cacheWriteTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-flash-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-image-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"nano-banana-2\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"characterIsToken\":false,\"completionTokenCostPer1M\":7.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.6-flash\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"characterIsToken\":false,\"completionTokenCostPer1M\":7.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.7-flash\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":9,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.5-flash\",\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-2.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-pro-latest\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":12,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":200000,\"name\":\"gemini-3.1-pro-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"google-gemini\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-2b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-9b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"maxTokens\":4096,\"name\":\"Llama-3.1-70B-Instruct-q4f16_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Llama-3.1-8B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Llama-3.2-1B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":2048,\"name\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Mistral-7B-Instruct-v0.3-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Phi-3.5-mini-instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-0.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-1.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Qwen2.5-7B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"}],\"name\":\"webllm\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.15,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-nemo-latest\",\"promptTokenCostPer1M\":0.15,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-codestral-mamba\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-7b\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.3,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-nemo-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"codestral-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":true,\"name\":\"mistral-small-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.7,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mixtral-8x7b\",\"promptTokenCostPer1M\":0.7,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-large-latest\",\"promptTokenCostPer1M\":2,\"provider\":\"mistral\",\"type\":\"text\"}],\"name\":\"mistral\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"deepseek-chat\",\"deepseek-reasoner\"],\"cacheReadTokenCostPer1M\":0.0028,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.28,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":true,\"maxTokens\":384000,\"name\":\"deepseek-v4-flash\",\"promptTokenCostPer1M\":0.14,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.003625,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.87,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"maxTokens\":384000,\"name\":\"deepseek-v4-pro\",\"promptTokenCostPer1M\":0.435,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"deepseek\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek Responses\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"deepseek-chat\",\"deepseek-reasoner\"],\"cacheReadTokenCostPer1M\":0.0028,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.28,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":true,\"maxTokens\":384000,\"name\":\"deepseek-v4-flash\",\"promptTokenCostPer1M\":0.14,\"provider\":\"deepseek-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.003625,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.87,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"maxTokens\":384000,\"name\":\"deepseek-v4-pro\",\"promptTokenCostPer1M\":0.435,\"provider\":\"deepseek-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":false,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"deepseek-responses\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.02,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.2,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.04,\"longContextCompletionTokenCostPer1M\":1.8,\"longContextPromptTokenCostPer1M\":0.4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-luna\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":12,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-terra\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"gpt-5.6\"],\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-sol\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.02,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.2,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.04,\"longContextCompletionTokenCostPer1M\":1.8,\"longContextPromptTokenCostPer1M\":0.4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-luna\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":12,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-terra\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"gpt-5.6\"],\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1050000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"maxTokens\":128000,\"name\":\"gpt-5.6-sol\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":80,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o3-pro\",\"promptTokenCostPer1M\":20,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":600,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o1-pro\",\"promptTokenCostPer1M\":150,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"openai-responses\"},{\"defaultModel\":\"grok-4.6\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"grok-4-1-fast-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-non-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4-1-fast-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini\",\"promptTokenCostPer1M\":0.3,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-multi-agent-0309\",\"grok-4.20-multi-agent-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-multi-agent\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-non-reasoning\",\"grok-4.20-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-non-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-reasoning\",\"grok-4.20-reasoning-latest\",\"grok-4.20\",\"grok-4.20-0309\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.3-latest\",\"grok-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.3\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini-fast\",\"promptTokenCostPer1M\":0.6,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.5-latest\",\"grok-build-latest\"],\"cacheReadTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":6,\"contextWindow\":500000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.5\",\"promptTokenCostPer1M\":2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3\",\"promptTokenCostPer1M\":3,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-fast\",\"promptTokenCostPer1M\":5,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"currency\":\"USD\",\"isDefault\":true,\"name\":\"grok-4.6\",\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"grok\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-light\",\"promptTokenCostPer1M\":0.3,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-r\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"command-r-plus\",\"promptTokenCostPer1M\":3,\"provider\":\"cohere\",\"type\":\"text\"}],\"name\":\"cohere\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-edge\",\"promptTokenCostPer1M\":0.4,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-flash\",\"promptTokenCostPer1M\":0.8,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"reka-core\",\"promptTokenCostPer1M\":3,\"provider\":\"reka\",\"type\":\"text\"}],\"name\":\"reka\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku-20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku@20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.24,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-instant-1.2\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.08,\"cacheWriteTokenCostPer1M\":1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku-latest\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku@20241022\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5@20251001\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":10,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":2,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":10,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":2,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-v2@20241022\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet@20240620\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet@20250219\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-sonnet-20240229\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5-20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5@20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4@20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5-20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5@20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":1,\"fastCacheWriteTokenCostPer1M\":12.5,\"fastCompletionTokenCostPer1M\":50,\"fastPromptTokenCostPer1M\":10,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-2.1\",\"promptTokenCostPer1M\":8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus-latest\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus@20240229\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1-20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1@20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4@20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"anthropic\"},{\"displayName\":\"OpenAI Compatible\",\"isDynamic\":true,\"models\":[],\"name\":\"openai-compatible\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"displayName\":\"Together AI\",\"isDynamic\":true,\"models\":[],\"name\":\"together\"},{\"displayName\":\"OpenRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"openrouter\"},{\"displayName\":\"OrcaRouter\",\"isDynamic\":true,\"models\":[],\"name\":\"orcarouter\"},{\"displayName\":\"Fireworks AI\",\"isDynamic\":true,\"models\":[],\"name\":\"fireworks\"},{\"displayName\":\"Hugging Face Router\",\"isDynamic\":true,\"models\":[],\"name\":\"huggingface-router\"},{\"displayName\":\"Amazon Bedrock\",\"isDynamic\":true,\"models\":[],\"name\":\"amazon-bedrock\"},{\"displayName\":\"Azure AI Foundry\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-foundry\"},{\"displayName\":\"Vertex AI OpenAI Compatibility\",\"isDynamic\":true,\"models\":[],\"name\":\"vertex-ai\"},{\"displayName\":\"Databricks Model Serving\",\"isDynamic\":true,\"models\":[],\"name\":\"databricks\"},{\"displayName\":\"Baseten Model APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten\"},{\"displayName\":\"Groq\",\"isDynamic\":true,\"models\":[],\"name\":\"groq\"},{\"displayName\":\"Cerebras Inference\",\"isDynamic\":true,\"models\":[],\"name\":\"cerebras\"},{\"displayName\":\"DeepInfra\",\"isDynamic\":true,\"models\":[],\"name\":\"deepinfra\"},{\"displayName\":\"SambaNova Cloud\",\"isDynamic\":true,\"models\":[],\"name\":\"sambanova\"},{\"displayName\":\"Nebius AI Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"nebius\"},{\"displayName\":\"Novita AI\",\"isDynamic\":true,\"models\":[],\"name\":\"novita\"},{\"displayName\":\"Hyperbolic\",\"isDynamic\":true,\"models\":[],\"name\":\"hyperbolic\"},{\"displayName\":\"SiliconFlow\",\"isDynamic\":true,\"models\":[],\"name\":\"siliconflow\"},{\"displayName\":\"FriendliAI\",\"isDynamic\":true,\"models\":[],\"name\":\"friendli\"},{\"displayName\":\"Cloudflare Workers AI\",\"isDynamic\":true,\"models\":[],\"name\":\"cloudflare-workers-ai\"},{\"displayName\":\"Featherless AI\",\"isDynamic\":true,\"models\":[],\"name\":\"featherless\"},{\"displayName\":\"Nscale\",\"isDynamic\":true,\"models\":[],\"name\":\"nscale\"},{\"displayName\":\"OVHcloud AI Endpoints\",\"isDynamic\":true,\"models\":[],\"name\":\"ovhcloud\"},{\"displayName\":\"Scaleway Generative APIs\",\"isDynamic\":true,\"models\":[],\"name\":\"scaleway\"},{\"displayName\":\"NVIDIA NIM\",\"isDynamic\":true,\"models\":[],\"name\":\"nvidia-nim\"},{\"displayName\":\"RunPod vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"runpod-vllm\"},{\"displayName\":\"SageMaker vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"sagemaker-vllm\"},{\"displayName\":\"vLLM\",\"isDynamic\":true,\"models\":[],\"name\":\"vllm\"},{\"displayName\":\"Ollama\",\"isDynamic\":true,\"models\":[],\"name\":\"ollama\"},{\"displayName\":\"LM Studio\",\"isDynamic\":true,\"models\":[],\"name\":\"lm-studio\"},{\"displayName\":\"llama.cpp Server\",\"isDynamic\":true,\"models\":[],\"name\":\"llama-cpp\"},{\"displayName\":\"LocalAI\",\"isDynamic\":true,\"models\":[],\"name\":\"localai\"},{\"displayName\":\"Baseten Inference Engine\",\"isDynamic\":true,\"models\":[],\"name\":\"baseten-engine\"}]}")
    return catalog


def provider_model_catalog(options: Any) -> Any:
    _core_coverage_mark("provider_model_catalog")
    registry = _provider_model_catalog_registry()
    type_raw = "all"
    options_is_string = _core_type_is(options, "string")
    if options_is_string:
        type_raw = options
    else:
        empty_map = {}
        opts = options
        opts_missing = _core_is_none(opts)
        if opts_missing:
            opts = empty_map
        else:
            pass
        candidate = _core_get(opts, "type", "all")
        candidate_is_list = _core_type_is(candidate, "list")
        if candidate_is_list:
            type_raw = _core_list_get(candidate, 0, "all")
        else:
            type_raw = candidate
    type_name = _core_string_lower(type_raw)
    selected = _core_get(registry, type_name, None)
    missing = _core_is_none(selected)
    if missing:
        selected = _core_get(registry, "all", None)
    else:
        pass
    return selected


def provider_estimate_cost(model_usage: Any, model_info_overrides: Any) -> number:
    _core_coverage_mark("provider_estimate_cost")
    has_usage = _core_truthy(model_usage)
    if has_usage:
        pass
    else:
        return 0
    model = _core_get(model_usage, "model", "")
    model_present = _core_truthy(model)
    if model_present:
        pass
    else:
        return 0
    ai_raw = _core_get(model_usage, "ai", "openai")
    ai_lower = _core_string_lower(ai_raw)
    provider_name = ai_lower
    is_openai_compatible = _core_eq(ai_lower, "openai-compatible")
    if is_openai_compatible:
        provider_name = "openai"
    else:
        pass
    is_google_name = _core_eq(ai_lower, "googlegeminiai")
    if is_google_name:
        provider_name = "google-gemini"
    else:
        pass
    model_info = _core_none()
    empty_aliases = []
    empty_model_info = []
    override_list = _core_coalesce(model_info_overrides, empty_model_info)
    for candidate in override_list:
        candidate_name = _core_get(candidate, "name", "")
        name_matches = _core_eq(candidate_name, model)
        aliases = _core_get(candidate, "aliases", empty_aliases)
        alias_matches = _core_contains(aliases, model)
        matches = _core_or(name_matches, alias_matches)
        if matches:
            model_info = candidate
        else:
            pass
    catalog = _provider_model_catalog_registry()
    providers = _core_get(catalog, "all", None)
    for provider in providers:
        catalog_provider_name = _core_get(provider, "name", "")
        provider_matches = _core_eq(catalog_provider_name, provider_name)
        if provider_matches:
            models = _core_get(provider, "models", None)
            for candidate in models:
                candidate_name = _core_get(candidate, "name", "")
                name_matches = _core_eq(candidate_name, model)
                aliases = _core_get(candidate, "aliases", empty_aliases)
                alias_matches = _core_contains(aliases, model)
                matches = _core_or(name_matches, alias_matches)
                missing_override = _core_is_none(model_info)
                use_catalog_candidate = _core_and(matches, missing_override)
                if use_catalog_candidate:
                    model_info = candidate
                else:
                    pass
        else:
            pass
    has_model_info = _core_truthy(model_info)
    if has_model_info:
        pass
    else:
        return 0
    tokens = _core_get(model_usage, "tokens", None)
    has_tokens = _core_truthy(tokens)
    if has_tokens:
        pass
    else:
        return 0
    prompt_snake = _core_get(tokens, "prompt_tokens", 0)
    prompt = _core_get(tokens, "promptTokens", prompt_snake)
    completion_snake = _core_get(tokens, "completion_tokens", 0)
    completion = _core_get(tokens, "completionTokens", completion_snake)
    thoughts_snake = _core_get(tokens, "thoughts_tokens", 0)
    thoughts = _core_get(tokens, "thoughtsTokens", thoughts_snake)
    cache_read_snake = _core_get(tokens, "cache_read_tokens", 0)
    cache_read = _core_get(tokens, "cacheReadTokens", cache_read_snake)
    cache_creation_snake = _core_get(tokens, "cache_creation_tokens", 0)
    cache_creation = _core_get(tokens, "cacheCreationTokens", cache_creation_snake)
    input_base = _core_add(prompt, cache_read)
    total_input = _core_add(input_base, cache_creation)
    threshold_raw = _core_get(model_info, "longContextThreshold", None)
    has_threshold = _core_is_not_none(threshold_raw)
    threshold = _core_coalesce(threshold_raw, 0)
    above_threshold = _core_gt(total_input, threshold)
    long_context = _core_and(has_threshold, above_threshold)
    speed = _core_get(tokens, "speed", "")
    fast = _core_eq(speed, "fast")
    standard_prompt_price = _core_get(model_info, "promptTokenCostPer1M", 0)
    standard_completion_price = _core_get(model_info, "completionTokenCostPer1M", 0)
    standard_cache_read_price = _core_get(model_info, "cacheReadTokenCostPer1M", standard_prompt_price)
    standard_cache_write_price = _core_get(model_info, "cacheWriteTokenCostPer1M", standard_prompt_price)
    service_tier_snake = _core_get(tokens, "service_tier", "")
    service_tier = _core_get(tokens, "serviceTier", service_tier_snake)
    empty_tier_pricing = {}
    tier_pricing_snake = _core_get(model_info, "service_tier_pricing", empty_tier_pricing)
    tier_pricing_all = _core_get(model_info, "serviceTierPricing", tier_pricing_snake)
    tier_pricing = _core_get(tier_pricing_all, service_tier, empty_tier_pricing)
    base_prompt_price = _core_get(tier_pricing, "promptTokenCostPer1M", standard_prompt_price)
    base_completion_price = _core_get(tier_pricing, "completionTokenCostPer1M", standard_completion_price)
    prompt_price = base_prompt_price
    completion_price = base_completion_price
    cache_read_price = _core_get(tier_pricing, "cacheReadTokenCostPer1M", standard_cache_read_price)
    cache_write_price = _core_get(tier_pricing, "cacheWriteTokenCostPer1M", standard_cache_write_price)
    if long_context:
        standard_long_prompt = _core_get(model_info, "longContextPromptTokenCostPer1M", standard_prompt_price)
        standard_long_completion = _core_get(model_info, "longContextCompletionTokenCostPer1M", standard_completion_price)
        standard_long_cache_read = _core_get(model_info, "longContextCacheReadTokenCostPer1M", standard_cache_read_price)
        standard_long_cache_write = _core_get(model_info, "longContextCacheWriteTokenCostPer1M", standard_cache_write_price)
        tier_long_prompt = _core_get(tier_pricing, "longContextPromptTokenCostPer1M", base_prompt_price)
        tier_long_completion = _core_get(tier_pricing, "longContextCompletionTokenCostPer1M", base_completion_price)
        tier_long_cache_read = _core_get(tier_pricing, "longContextCacheReadTokenCostPer1M", cache_read_price)
        tier_long_cache_write = _core_get(tier_pricing, "longContextCacheWriteTokenCostPer1M", cache_write_price)
        has_tier_prompt = _core_map_contains(tier_pricing, "promptTokenCostPer1M")
        has_tier_completion = _core_map_contains(tier_pricing, "completionTokenCostPer1M")
        has_tier_cache_read = _core_map_contains(tier_pricing, "cacheReadTokenCostPer1M")
        has_tier_cache_write = _core_map_contains(tier_pricing, "cacheWriteTokenCostPer1M")
        prompt_price = standard_long_prompt
        completion_price = standard_long_completion
        cache_read_price = standard_long_cache_read
        cache_write_price = standard_long_cache_write
        if has_tier_prompt:
            prompt_price = tier_long_prompt
        else:
            pass
        if has_tier_completion:
            completion_price = tier_long_completion
        else:
            pass
        if has_tier_cache_read:
            cache_read_price = tier_long_cache_read
        else:
            pass
        if has_tier_cache_write:
            cache_write_price = tier_long_cache_write
        else:
            pass
        has_tier_long_prompt = _core_map_contains(tier_pricing, "longContextPromptTokenCostPer1M")
        has_tier_long_completion = _core_map_contains(tier_pricing, "longContextCompletionTokenCostPer1M")
        has_tier_long_cache_read = _core_map_contains(tier_pricing, "longContextCacheReadTokenCostPer1M")
        has_tier_long_cache_write = _core_map_contains(tier_pricing, "longContextCacheWriteTokenCostPer1M")
        if has_tier_long_prompt:
            prompt_price = tier_long_prompt
        else:
            pass
        if has_tier_long_completion:
            completion_price = tier_long_completion
        else:
            pass
        if has_tier_long_cache_read:
            cache_read_price = tier_long_cache_read
        else:
            pass
        if has_tier_long_cache_write:
            cache_write_price = tier_long_cache_write
        else:
            pass
    else:
        pass
    if fast:
        prompt_price = _core_get(model_info, "fastPromptTokenCostPer1M", standard_prompt_price)
        completion_price = _core_get(model_info, "fastCompletionTokenCostPer1M", standard_completion_price)
        cache_read_price = _core_get(model_info, "fastCacheReadTokenCostPer1M", standard_cache_read_price)
        cache_write_price = _core_get(model_info, "fastCacheWriteTokenCostPer1M", standard_cache_write_price)
    else:
        pass
    total_output = _core_add(completion, thoughts)
    prompt_cost_raw = _core_mul(prompt, prompt_price)
    prompt_cost = _core_div(prompt_cost_raw, 1000000)
    completion_cost_raw = _core_mul(total_output, completion_price)
    completion_cost = _core_div(completion_cost_raw, 1000000)
    cache_read_cost_raw = _core_mul(cache_read, cache_read_price)
    cache_read_cost = _core_div(cache_read_cost_raw, 1000000)
    cache_write_cost_raw = _core_mul(cache_creation, cache_write_price)
    cache_write_cost = _core_div(cache_write_cost_raw, 1000000)
    input_cost = _core_add(prompt_cost, cache_read_cost)
    cache_cost = _core_add(input_cost, cache_write_cost)
    total_cost = _core_add(cache_cost, completion_cost)
    return total_cost


def provider_route_request_requirements(request: Any) -> Any:
    _core_coverage_mark("provider_route_request_requirements")
    requirements = {}
    requirements["hasImages"] = False
    requirements["hasAudio"] = False
    requirements["hasAudioOutput"] = False
    requirements["hasFiles"] = False
    requirements["hasUrls"] = False
    requirements["requiresFunctions"] = False
    requirements["requiresStreaming"] = False
    requirements["requiresCaching"] = False
    content_types = []
    requirements["contentTypes"] = content_types
    requirements["estimatedTokens"] = 0
    empty_list = []
    prompt = _core_get(request, "chatPrompt", empty_list)
    prompt_count_initial = _core_len(prompt)
    prompt_empty = _core_eq(prompt_count_initial, 0)
    if prompt_empty:
        prompt = _core_get(request, "chat_prompt", prompt)
    else:
        pass
    for message in prompt:
        content = _core_get(message, "content", None)
        content_is_list = _core_type_is(content, "list")
        if content_is_list:
            for part in content:
                part_type = _core_get(part, "type", "text")
                known_type = _core_contains(content_types, part_type)
                new_type = _core_not(known_type)
                if new_type:
                    content_types.append(part_type)
                else:
                    pass
                is_image = _core_eq(part_type, "image")
                if is_image:
                    requirements["hasImages"] = True
                    cached = _core_get(part, "cache", False)
                    if cached:
                        requirements["requiresCaching"] = True
                    else:
                        pass
                else:
                    pass
                is_audio = _core_eq(part_type, "audio")
                if is_audio:
                    requirements["hasAudio"] = True
                    cached_audio = _core_get(part, "cache", False)
                    if cached_audio:
                        requirements["requiresCaching"] = True
                    else:
                        pass
                else:
                    pass
                is_file = _core_eq(part_type, "file")
                if is_file:
                    requirements["hasFiles"] = True
                    cached_file = _core_get(part, "cache", False)
                    if cached_file:
                        requirements["requiresCaching"] = True
                    else:
                        pass
                else:
                    pass
                is_url = _core_eq(part_type, "url")
                if is_url:
                    requirements["hasUrls"] = True
                    cached_url = _core_get(part, "cache", False)
                    if cached_url:
                        requirements["requiresCaching"] = True
                    else:
                        pass
                else:
                    pass
                cached_part = _core_get(part, "cache", False)
                if cached_part:
                    requirements["requiresCaching"] = True
                else:
                    pass
        else:
            pass
        message_cached = _core_get(message, "cache", False)
        if message_cached:
            requirements["requiresCaching"] = True
        else:
            pass
    functions = _core_get(request, "functions", empty_list)
    functions_count = _core_len(functions)
    has_functions = _core_gt(functions_count, 0)
    if has_functions:
        requirements["requiresFunctions"] = True
    else:
        pass
    model_config = _core_get(request, "modelConfig", None)
    model_config_missing = _core_is_none(model_config)
    if model_config_missing:
        model_config = _core_get(request, "model_config", None)
    else:
        pass
    stream = _core_get(model_config, "stream", False)
    if stream:
        requirements["requiresStreaming"] = True
    else:
        pass
    audio_config = _core_get(model_config, "audio", None)
    audio_output = _core_get(audio_config, "output", None)
    audio_output_enabled = _core_get(audio_output, "enabled", False)
    if audio_output_enabled:
        requirements["hasAudioOutput"] = True
    else:
        pass
    capabilities = _core_get(request, "capabilities", None)
    requires_images = _core_get(capabilities, "requiresImages", False)
    if requires_images:
        requirements["hasImages"] = True
    else:
        pass
    requires_audio = _core_get(capabilities, "requiresAudio", False)
    if requires_audio:
        requirements["hasAudio"] = True
    else:
        pass
    requires_audio_output = _core_get(capabilities, "requiresAudioOutput", False)
    if requires_audio_output:
        requirements["hasAudioOutput"] = True
    else:
        pass
    requires_files = _core_get(capabilities, "requiresFiles", False)
    if requires_files:
        requirements["hasFiles"] = True
    else:
        pass
    requires_web_search = _core_get(capabilities, "requiresWebSearch", False)
    if requires_web_search:
        requirements["hasUrls"] = True
    else:
        pass
    return requirements


def _provider_features_support(features: Any, path: str) -> bool:
    _core_coverage_mark("_provider_features_support")
    media = _core_get(features, "media", None)
    caching = _core_get(features, "caching", None)
    is_functions = _core_eq(path, "functions")
    if is_functions:
        value = _core_get(features, "functions", False)
        return value
    else:
        pass
    is_streaming = _core_eq(path, "streaming")
    if is_streaming:
        value_streaming = _core_get(features, "streaming", False)
        return value_streaming
    else:
        pass
    is_images = _core_eq(path, "images")
    if is_images:
        images = _core_get(media, "images", None)
        value_images = _core_get(images, "supported", False)
        return value_images
    else:
        pass
    is_audio = _core_eq(path, "audio")
    if is_audio:
        audio = _core_get(media, "audio", None)
        value_audio = _core_get(audio, "supported", False)
        return value_audio
    else:
        pass
    is_files = _core_eq(path, "files")
    if is_files:
        files = _core_get(media, "files", None)
        value_files = _core_get(files, "supported", False)
        return value_files
    else:
        pass
    is_urls = _core_eq(path, "urls")
    if is_urls:
        urls = _core_get(media, "urls", None)
        value_urls = _core_get(urls, "supported", False)
        return value_urls
    else:
        pass
    is_caching = _core_eq(path, "caching")
    if is_caching:
        value_caching = _core_get(caching, "supported", False)
        return value_caching
    else:
        pass
    return False


def provider_route_preprocess_request(features: Any, request: Any) -> Any:
    _core_coverage_mark("provider_route_preprocess_request")
    supports_images = _provider_features_support(features, "images")
    does_not_support_images = _core_not(supports_images)
    if does_not_support_images:
        return request
    else:
        pass
    has_camel_prompt = _core_map_contains(request, "chatPrompt")
    has_snake_prompt = _core_map_contains(request, "chat_prompt")
    has_any_prompt = _core_or(has_camel_prompt, has_snake_prompt)
    missing_prompt = _core_not(has_any_prompt)
    if missing_prompt:
        return request
    else:
        pass
    prompt_key = "chatPrompt"
    prompt = _core_get(request, "chatPrompt", None)
    missing_camel_prompt = _core_not(has_camel_prompt)
    if missing_camel_prompt:
        prompt_key = "chat_prompt"
        prompt = _core_get(request, "chat_prompt", None)
    else:
        pass
    prompt_is_list = _core_type_is(prompt, "list")
    prompt_not_list = _core_not(prompt_is_list)
    if prompt_not_list:
        return request
    else:
        pass
    processed_prompt = []
    for message in prompt:
        message_seed = {}
        message_copy = _core_map_merge(message_seed, message)
        content = _core_get(message, "content", None)
        content_is_list = _core_type_is(content, "list")
        if content_is_list:
            processed_content = []
            for part in content:
                part_type = _core_get(part, "type", "text")
                is_image = _core_eq(part_type, "image")
                if is_image:
                    image_seed = {}
                    image_copy = _core_map_merge(image_seed, part)
                    processed_content.append(image_copy)
                else:
                    processed_content.append(part)
            message_copy["content"] = processed_content
        else:
            pass
        processed_prompt.append(message_copy)
    request_seed = {}
    out = _core_map_merge(request_seed, request)
    out[prompt_key] = processed_prompt
    return out


def _provider_route_score(provider: Any, requirements: Any) -> Any:
    _core_coverage_mark("_provider_route_score")
    features = _core_get(provider, "features", None)
    score = 10
    missing = []
    supported = []
    needs_images = _core_get(requirements, "hasImages", False)
    if needs_images:
        ok_images = _provider_features_support(features, "images")
        if ok_images:
            score = _core_add(score, 25)
            supported.append("Images")
        else:
            missing.append("Image support")
    else:
        pass
    needs_audio = _core_get(requirements, "hasAudio", False)
    if needs_audio:
        ok_audio = _provider_features_support(features, "audio")
        if ok_audio:
            score = _core_add(score, 25)
            supported.append("Audio")
        else:
            missing.append("Audio support")
    else:
        pass
    needs_files = _core_get(requirements, "hasFiles", False)
    if needs_files:
        ok_files = _provider_features_support(features, "files")
        if ok_files:
            score = _core_add(score, 25)
            supported.append("Files")
        else:
            missing.append("File support")
    else:
        pass
    needs_urls = _core_get(requirements, "hasUrls", False)
    if needs_urls:
        ok_urls = _provider_features_support(features, "urls")
        if ok_urls:
            score = _core_add(score, 25)
            supported.append("URLs")
        else:
            missing.append("URL/Web search support")
    else:
        pass
    needs_functions = _core_get(requirements, "requiresFunctions", False)
    if needs_functions:
        ok_functions = _provider_features_support(features, "functions")
        if ok_functions:
            score = _core_add(score, 15)
            supported.append("Functions")
        else:
            missing.append("Function calling")
    else:
        pass
    needs_streaming = _core_get(requirements, "requiresStreaming", False)
    if needs_streaming:
        ok_streaming = _provider_features_support(features, "streaming")
        if ok_streaming:
            score = _core_add(score, 10)
            supported.append("Streaming")
        else:
            missing.append("Streaming responses")
    else:
        pass
    needs_caching = _core_get(requirements, "requiresCaching", False)
    if needs_caching:
        ok_caching = _provider_features_support(features, "caching")
        if ok_caching:
            score = _core_add(score, 8)
            supported.append("Caching")
        else:
            missing.append("Content caching")
    else:
        pass
    thinking = _core_get(features, "thinking", False)
    if thinking:
        score = _core_add(score, 2)
    else:
        pass
    multi_turn = _core_get(features, "multiTurn", None)
    multi_turn_missing = _core_is_none(multi_turn)
    if multi_turn_missing:
        multi_turn = _core_get(features, "multi_turn", False)
    else:
        pass
    if multi_turn:
        score = _core_add(score, 2)
    else:
        pass
    missing_count = _core_len(missing)
    penalty = _core_mul(missing_count, -10)
    score = _core_add(score, penalty)
    score = _core_add(score, 0)
    out = {}
    out["provider"] = provider
    out["score"] = score
    out["missingCapabilities"] = missing
    out["supportedCapabilities"] = supported
    return out


def provider_route_recommendation(providers: Any, request: Any, options: Any) -> Any:
    _core_coverage_mark("provider_route_recommendation")
    provider_count = _core_len(providers)
    has_providers = _core_gt(provider_count, 0)
    no_providers = _core_not(has_providers)
    if no_providers:
        error = _core_runtime_error("Provider selection failed: No providers available")
        raise error
    else:
        pass
    requirements = provider_route_request_requirements(request)
    best = _core_list_get(providers, 0, None)
    best_score = -999999
    best_missing = []
    for provider in providers:
        score_entry = _provider_route_score(provider, requirements)
        score = _core_get(score_entry, "score", 0)
        better = _core_gt(score, best_score)
        if better:
            best_score = score
            best = provider
            best_missing = _core_get(score_entry, "missingCapabilities", best_missing)
        else:
            pass
    require_exact = _core_get(options, "requireExactMatch", False)
    allow_degradation = _core_get(options, "allowDegradation", True)
    missing_count = _core_len(best_missing)
    has_missing = _core_gt(missing_count, 0)
    if require_exact:
        if has_missing:
            missing_text = _core_string_join(", ", best_missing)
            message = _core_string_format("Provider selection failed: No providers fully support the request requirements: {}", missing_text)
            error_exact = _core_runtime_error(message)
            raise error_exact
        else:
            pass
    else:
        pass
    degradation_disallowed = _core_not(allow_degradation)
    if degradation_disallowed:
        if has_missing:
            best_name_for_error = _core_get(best, "name", "provider")
            missing_text_no_degrade = _core_string_join(", ", best_missing)
            message_no_degrade = _core_string_format("Provider selection failed: Best available provider ({}) is missing: {}", best_name_for_error, missing_text_no_degrade)
            error_no_degrade = _core_runtime_error(message_no_degrade)
            raise error_no_degrade
        else:
            pass
    else:
        pass
    features = _core_get(best, "features", None)
    processing = []
    degradations = []
    warnings = []
    needs_images = _core_get(requirements, "hasImages", False)
    if needs_images:
        ok_images = _provider_features_support(features, "images")
        missing_images = _core_not(ok_images)
        if missing_images:
            degradations.append("Images will be converted to text descriptions")
            processing.append("Image-to-text conversion")
        else:
            pass
    else:
        pass
    needs_audio = _core_get(requirements, "hasAudio", False)
    if needs_audio:
        ok_audio = _provider_features_support(features, "audio")
        missing_audio = _core_not(ok_audio)
        if missing_audio:
            degradations.append("Audio will be transcribed to text")
            processing.append("Audio-to-text transcription")
        else:
            pass
    else:
        pass
    needs_files = _core_get(requirements, "hasFiles", False)
    if needs_files:
        ok_files = _provider_features_support(features, "files")
        missing_files = _core_not(ok_files)
        if missing_files:
            degradations.append("File content will be extracted to text")
            processing.append("File-to-text extraction")
        else:
            pass
    else:
        pass
    needs_urls = _core_get(requirements, "hasUrls", False)
    if needs_urls:
        ok_urls = _provider_features_support(features, "urls")
        missing_urls = _core_not(ok_urls)
        if missing_urls:
            degradations.append("URL content will be pre-fetched")
            processing.append("URL content fetching")
        else:
            pass
    else:
        pass
    needs_streaming = _core_get(requirements, "requiresStreaming", False)
    if needs_streaming:
        ok_streaming = _provider_features_support(features, "streaming")
        missing_streaming = _core_not(ok_streaming)
        if missing_streaming:
            warnings.append("Streaming not supported - will use non-streaming mode")
        else:
            pass
    else:
        pass
    needs_caching = _core_get(requirements, "requiresCaching", False)
    if needs_caching:
        ok_caching = _provider_features_support(features, "caching")
        missing_caching = _core_not(ok_caching)
        if missing_caching:
            warnings.append("Content caching not supported")
        else:
            pass
    else:
        pass
    out = {}
    out["provider"] = best
    provider_name = _core_get(best, "name", "")
    out["providerName"] = provider_name
    out["processingApplied"] = processing
    out["degradations"] = degradations
    out["warnings"] = warnings
    out["requirements"] = requirements
    return out


def _provider_route_any_supports(providers: Any, path: str) -> bool:
    _core_coverage_mark("_provider_route_any_supports")
    ok = False
    for provider in providers:
        features = _core_get(provider, "features", None)
        supported = _provider_features_support(features, path)
        if supported:
            ok = True
        else:
            pass
    return ok


def provider_route_validation(providers: Any, request: Any, processing: Any, options: Any) -> Any:
    _core_coverage_mark("provider_route_validation")
    issues = []
    recommendations = []
    result = {}
    recommendation = provider_route_recommendation(providers, request, options)
    degradations = _core_get(recommendation, "degradations", issues)
    for degradation in degradations:
        issues.append(degradation)
    warnings = _core_get(recommendation, "warnings", issues)
    for warning in warnings:
        issues.append(warning)
    degradation_count = _core_len(degradations)
    has_degradations = _core_gt(degradation_count, 0)
    if has_degradations:
        recommendations.append("Consider using a provider that natively supports all media types")
    else:
        pass
    requirements = _core_get(recommendation, "requirements", None)
    needs_images = _core_get(requirements, "hasImages", False)
    if needs_images:
        image_processor = _core_get(processing, "imageToText", None)
        has_image_processor = _core_is_not_none(image_processor)
        has_image_provider = _provider_route_any_supports(providers, "images")
        no_image_processor = _core_not(has_image_processor)
        no_image_provider = _core_not(has_image_provider)
        image_problem = _core_and(no_image_processor, no_image_provider)
        if image_problem:
            issues.append("No image processing service available and no providers support images")
            recommendations.append("Add imageToText processing service or use image-capable provider")
        else:
            pass
    else:
        pass
    needs_audio = _core_get(requirements, "hasAudio", False)
    if needs_audio:
        audio_processor = _core_get(processing, "audioToText", None)
        has_audio_processor = _core_is_not_none(audio_processor)
        has_audio_provider = _provider_route_any_supports(providers, "audio")
        no_audio_processor = _core_not(has_audio_processor)
        no_audio_provider = _core_not(has_audio_provider)
        audio_problem = _core_and(no_audio_processor, no_audio_provider)
        if audio_problem:
            issues.append("No audio processing service available and no providers support audio")
            recommendations.append("Add audioToText processing service or use audio-capable provider")
        else:
            pass
    else:
        pass
    issue_count = _core_len(issues)
    no_issues = _core_eq(issue_count, 0)
    can_handle = _core_or(no_issues, has_degradations)
    result["canHandle"] = can_handle
    result["issues"] = issues
    result["recommendations"] = recommendations
    return result


def provider_balancer_retry_policy(options: Any) -> Any:
    _core_coverage_mark("provider_balancer_retry_policy")
    out = {}
    strategy = _core_get(options, "strategy", "metric")
    out["strategy"] = strategy
    max_retries = _core_get(options, "maxRetries", None)
    max_retries_missing = _core_is_none(max_retries)
    if max_retries_missing:
        max_retries = _core_get(options, "max_retries", 3)
    else:
        pass
    out["maxRetries"] = max_retries
    initial_backoff = _core_get(options, "initialBackoffMs", None)
    initial_backoff_missing = _core_is_none(initial_backoff)
    if initial_backoff_missing:
        initial_backoff = _core_get(options, "initial_backoff_ms", 1000)
    else:
        pass
    out["initialBackoffMs"] = initial_backoff
    max_backoff = _core_get(options, "maxBackoffMs", None)
    max_backoff_missing = _core_is_none(max_backoff)
    if max_backoff_missing:
        max_backoff = _core_get(options, "max_backoff_ms", 32000)
    else:
        pass
    out["maxBackoffMs"] = max_backoff
    debug = _core_get(options, "debug", True)
    out["debug"] = debug
    return out


def provider_balancer_metric_score(metrics: Any) -> number:
    _core_coverage_mark("provider_balancer_metric_score")
    latency = _core_get(metrics, "latency", None)
    chat = _core_get(latency, "chat", None)
    mean = _core_get(chat, "mean", 0)
    return mean


def provider_balancer_candidate_allowed(features: Any, request: Any) -> bool:
    _core_coverage_mark("provider_balancer_candidate_allowed")
    format = _core_get(request, "responseFormat", None)
    format_missing = _core_is_none(format)
    if format_missing:
        format = _core_get(request, "response_format", None)
    else:
        pass
    format_type = _core_get(format, "type", "")
    requires_structured = _core_eq(format_type, "json_schema")
    if requires_structured:
        structured = _core_get(features, "structuredOutputs", None)
        structured_missing = _core_is_none(structured)
        if structured_missing:
            structured = _core_get(features, "structured_outputs", False)
        else:
            pass
        no_structured = _core_not(structured)
        if no_structured:
            return False
        else:
            pass
    else:
        pass
    capabilities = _core_get(request, "capabilities", None)
    media = _core_get(features, "media", None)
    requires_images = _core_get(capabilities, "requiresImages", None)
    requires_images_missing = _core_is_none(requires_images)
    if requires_images_missing:
        requires_images = _core_get(capabilities, "requires_images", False)
    else:
        pass
    if requires_images:
        images = _core_get(media, "images", None)
        images_ok = _core_get(images, "supported", False)
        images_bad = _core_not(images_ok)
        if images_bad:
            return False
        else:
            pass
    else:
        pass
    requires_audio = _core_get(capabilities, "requiresAudio", None)
    requires_audio_missing = _core_is_none(requires_audio)
    if requires_audio_missing:
        requires_audio = _core_get(capabilities, "requires_audio", False)
    else:
        pass
    if requires_audio:
        audio = _core_get(media, "audio", None)
        audio_ok = _core_get(audio, "supported", False)
        audio_bad = _core_not(audio_ok)
        if audio_bad:
            return False
        else:
            pass
    else:
        pass
    return True


def provider_balancer_adaptive_policy(strategy: Any) -> Any:
    _core_coverage_mark("provider_balancer_adaptive_policy")
    deadline = _core_get(strategy, "deadlineMs", None)
    deadline_missing = _core_is_none(deadline)
    if deadline_missing:
        deadline = _core_get(strategy, "deadline_ms", 0)
    else:
        pass
    deadline_bad = _core_lte(deadline, 0)
    if deadline_bad:
        error = _core_runtime_error("Adaptive deadlineMs must be finite and greater than zero.")
        raise error
    else:
        pass
    bad_outcome = _core_get(strategy, "badOutcomeCost", None)
    bad_outcome_missing = _core_is_none(bad_outcome)
    if bad_outcome_missing:
        bad_outcome = _core_get(strategy, "bad_outcome_cost", -1)
    else:
        pass
    bad_outcome_bad = _core_lt(bad_outcome, 0)
    if bad_outcome_bad:
        error = _core_runtime_error("Adaptive badOutcomeCost must be finite and non-negative.")
        raise error
    else:
        pass
    out = {}
    out["type"] = "adaptive"
    out["deadlineMs"] = deadline
    out["badOutcomeCost"] = bad_outcome
    namespace = _core_get(strategy, "namespace", "default")
    out["namespace"] = namespace
    tokens = _core_get(strategy, "expectedTokens", None)
    tokens_missing = _core_is_none(tokens)
    if tokens_missing:
        tokens = _core_get(strategy, "expected_tokens", None)
    else:
        pass
    out["expectedTokens"] = tokens
    return out


def provider_balancer_route_stats() -> Any:
    _core_coverage_mark("provider_balancer_route_stats")
    out = {}
    out["version"] = 1
    out["observations"] = 0
    out["successes"] = 0
    out["failureEwma"] = 0.05
    out["logLatencyMean"] = 0
    out["logLatencyM2"] = 0
    return out


def provider_balancer_observe_route(stats: Any, observation: Any) -> Any:
    _core_coverage_mark("provider_balancer_observe_route")
    missing = _core_is_none(stats)
    if missing:
        stats = provider_balancer_route_stats()
    else:
        pass
    outcome = _core_get(observation, "outcome", "failure")
    failed = _core_eq(outcome, "failure")
    failed_number = _core_add(0, 0)
    if failed:
        failed_number = _core_add(1, 0)
    else:
        pass
    failure_ewma = _core_get(stats, "failureEwma", 0.05)
    old_weighted = _core_mul(0.8, failure_ewma)
    new_weighted = _core_mul(0.2, failed_number)
    next_failure = _core_add(old_weighted, new_weighted)
    observations = _core_get(stats, "observations", 0)
    next_observations = _core_add(observations, 1)
    successes = _core_get(stats, "successes", 0)
    mean = _core_get(stats, "logLatencyMean", 0)
    m2 = _core_get(stats, "logLatencyM2", 0)
    out = {}
    out["version"] = 1
    out["observations"] = next_observations
    out["successes"] = successes
    out["failureEwma"] = next_failure
    out["logLatencyMean"] = mean
    out["logLatencyM2"] = m2
    if failed:
        return out
    else:
        pass
    latency = _core_get(observation, "latencyMs", None)
    latency_missing = _core_is_none(latency)
    if latency_missing:
        latency = _core_get(observation, "latency_ms", 1)
    else:
        pass
    too_small = _core_lt(latency, 1)
    if too_small:
        latency = _core_add(1, 0)
    else:
        pass
    log_latency = _core_math_log(latency)
    next_successes = _core_add(successes, 1)
    negative_mean = _core_mul(-1, mean)
    delta = _core_add(log_latency, negative_mean)
    delta_share = _core_div(delta, next_successes)
    next_mean = _core_add(mean, delta_share)
    negative_next_mean = _core_mul(-1, next_mean)
    delta_after = _core_add(log_latency, negative_next_mean)
    m2_increment = _core_mul(delta, delta_after)
    next_m2 = _core_add(m2, m2_increment)
    out["successes"] = next_successes
    out["logLatencyMean"] = next_mean
    out["logLatencyM2"] = next_m2
    return out


def _provider_balancer_nonzero_random() -> number:
    _core_coverage_mark("_provider_balancer_nonzero_random")
    value = _core_math_random()
    low = _core_lt(value, 0.0000000000000002220446049250313)
    if low:
        return 0.0000000000000002220446049250313
    else:
        pass
    high = _core_gt(value, 0.9999999999999998)
    if high:
        return 0.9999999999999998
    else:
        pass
    return value


def _provider_balancer_standard_normal() -> number:
    _core_coverage_mark("_provider_balancer_standard_normal")
    u1 = _provider_balancer_nonzero_random()
    u2 = _provider_balancer_nonzero_random()
    log_u1 = _core_math_log(u1)
    negative_two_log = _core_mul(-2, log_u1)
    radius = _core_math_sqrt(negative_two_log)
    angle = _core_mul(6.283185307179586, u2)
    cosine = _core_math_cos(angle)
    sample = _core_mul(radius, cosine)
    return sample


def _provider_balancer_gamma_sample(shape: number, scale: number) -> number:
    _core_coverage_mark("_provider_balancer_gamma_sample")
    third = _core_div(1, 3)
    negative_third = _core_mul(-1, third)
    d = _core_add(shape, negative_third)
    nine_d = _core_mul(9, d)
    sqrt_nine_d = _core_math_sqrt(nine_d)
    c = _core_div(1, sqrt_nine_d)
    attempts = []
    attempts.append(0)
    attempts.append(1)
    attempts.append(2)
    attempts.append(3)
    attempts.append(4)
    attempts.append(5)
    attempts.append(6)
    attempts.append(7)
    attempts.append(8)
    attempts.append(9)
    attempts.append(10)
    attempts.append(11)
    attempts.append(12)
    attempts.append(13)
    attempts.append(14)
    attempts.append(15)
    for attempt in attempts:
        x = _provider_balancer_standard_normal()
        cx = _core_mul(c, x)
        base = _core_add(1, cx)
        base_bad = _core_lte(base, 0)
        if base_bad:
            continue
        else:
            pass
        value = _core_math_pow(base, 3)
        u = _provider_balancer_nonzero_random()
        x2 = _core_math_pow(x, 2)
        x4 = _core_math_pow(x, 4)
        penalty = _core_mul(0.0331, x4)
        negative_penalty = _core_mul(-1, penalty)
        fast_threshold = _core_add(1, negative_penalty)
        fast_accept = _core_lt(u, fast_threshold)
        if fast_accept:
            dv = _core_mul(d, value)
            sample = _core_mul(dv, scale)
            return sample
        else:
            pass
        log_u = _core_math_log(u)
        half_x2 = _core_mul(0.5, x2)
        negative_value = _core_mul(-1, value)
        one_minus_value = _core_add(1, negative_value)
        log_value = _core_math_log(value)
        inside = _core_add(one_minus_value, log_value)
        d_inside = _core_mul(d, inside)
        rhs = _core_add(half_x2, d_inside)
        accept = _core_lt(log_u, rhs)
        if accept:
            dv = _core_mul(d, value)
            sample = _core_mul(dv, scale)
            return sample
        else:
            pass
    fallback = _core_mul(shape, scale)
    return fallback


def _provider_balancer_normal_cdf(value: number) -> number:
    _core_coverage_mark("_provider_balancer_normal_cdf")
    sign = _core_add(1, 0)
    negative = _core_lt(value, 0)
    if negative:
        sign = _core_add(-1, 0)
    else:
        pass
    absolute = _core_math_abs(value)
    sqrt_two = _core_math_sqrt(2)
    x = _core_div(absolute, sqrt_two)
    scaled_x = _core_mul(0.3275911, x)
    denom = _core_add(1, scaled_x)
    t = _core_div(1, denom)
    p1 = _core_mul(1.061405429, t)
    p1 = _core_add(p1, -1.453152027)
    p2 = _core_mul(p1, t)
    p2 = _core_add(p2, 1.421413741)
    p3 = _core_mul(p2, t)
    p3 = _core_add(p3, -0.284496736)
    p4 = _core_mul(p3, t)
    p4 = _core_add(p4, 0.254829592)
    polynomial = _core_mul(p4, t)
    negative_x = _core_mul(-1, x)
    negative_x2 = _core_mul(negative_x, x)
    exponential = _core_math_exp(negative_x2)
    poly_exp = _core_mul(polynomial, exponential)
    negative_poly_exp = _core_mul(-1, poly_exp)
    one_minus = _core_add(1, negative_poly_exp)
    erf = _core_mul(sign, one_minus)
    one_plus_erf = _core_add(1, erf)
    cdf = _core_div(one_plus_erf, 2)
    return cdf


def provider_balancer_sample_health(stats: Any, deadline_ms: number) -> Any:
    _core_coverage_mark("provider_balancer_sample_health")
    missing = _core_is_none(stats)
    if missing:
        stats = provider_balancer_route_stats()
    else:
        pass
    deadline_too_small = _core_lt(deadline_ms, 1)
    if deadline_too_small:
        deadline_ms = _core_add(1, 0)
    else:
        pass
    half_deadline = _core_div(deadline_ms, 2)
    prior_mean = _core_math_log(half_deadline)
    count = _core_get(stats, "successes", 0)
    posterior_strength = _core_add(1, count)
    count_mean = _core_get(stats, "logLatencyMean", 0)
    weighted_mean = _core_mul(count, count_mean)
    mean_sum = _core_add(prior_mean, weighted_mean)
    posterior_mean = _core_div(mean_sum, posterior_strength)
    half_count = _core_div(count, 2)
    posterior_alpha = _core_add(2, half_count)
    negative_prior = _core_mul(-1, prior_mean)
    mean_delta = _core_add(count_mean, negative_prior)
    mean_delta2 = _core_math_pow(mean_delta, 2)
    count_delta2 = _core_mul(count, mean_delta2)
    twice_strength = _core_mul(2, posterior_strength)
    mean_adjustment = _core_div(count_delta2, twice_strength)
    m2 = _core_get(stats, "logLatencyM2", 0)
    half_m2 = _core_div(m2, 2)
    posterior_beta = _core_add(0.4804530139182014, half_m2)
    posterior_beta = _core_add(posterior_beta, mean_adjustment)
    scale = _core_div(1, posterior_beta)
    precision = _provider_balancer_gamma_sample(posterior_alpha, scale)
    variance = _core_div(1, precision)
    variance_over_strength = _core_div(variance, posterior_strength)
    mean_stddev = _core_math_sqrt(variance_over_strength)
    normal = _provider_balancer_standard_normal()
    mean_noise = _core_mul(normal, mean_stddev)
    sampled_mean = _core_add(posterior_mean, mean_noise)
    log_deadline = _core_math_log(deadline_ms)
    negative_sampled_mean = _core_mul(-1, sampled_mean)
    z_numerator = _core_add(log_deadline, negative_sampled_mean)
    variance_stddev = _core_math_sqrt(variance)
    z = _core_div(z_numerator, variance_stddev)
    cdf = _provider_balancer_normal_cdf(z)
    negative_cdf = _core_mul(-1, cdf)
    late = _core_add(1, negative_cdf)
    failure = _core_get(stats, "failureEwma", 0.05)
    out = {}
    out["failureProbability"] = failure
    out["deadlineMissProbability"] = late
    return out


def provider_balancer_adaptive_score(estimated_cost: number, bad_outcome_cost: number, failure_probability: number, deadline_miss_probability: number) -> number:
    _core_coverage_mark("provider_balancer_adaptive_score")
    negative_failure = _core_mul(-1, failure_probability)
    success_probability = _core_add(1, negative_failure)
    successful_late = _core_mul(success_probability, deadline_miss_probability)
    bad_probability = _core_add(failure_probability, successful_late)
    bad_cost = _core_mul(bad_outcome_cost, bad_probability)
    score = _core_add(estimated_cost, bad_cost)
    return score


def provider_balancer_validate_route_key(route_key: str, seen_keys: Any) -> str:
    _core_coverage_mark("provider_balancer_validate_route_key")
    key = str(route_key).strip()
    empty = _core_eq(key, "")
    if empty:
        error = _core_runtime_error("Adaptive route keys must be non-empty.")
        raise error
    else:
        pass
    duplicate = _core_contains(seen_keys, key)
    if duplicate:
        error = _core_runtime_error("Adaptive route keys must be unique.")
        raise error
    else:
        pass
    return key


def provider_balancer_rank_candidates(candidates: Any) -> Any:
    _core_coverage_mark("provider_balancer_rank_candidates")
    ranked = []
    used = {}
    for slot in candidates:
        best = {}
        has_best = False
        best_score = 0
        best_order = 0
        for candidate in candidates:
            route_key = _core_get(candidate, "routeKey", "")
            already_used = _core_map_contains(used, route_key)
            if already_used:
                continue
            else:
                pass
            score = _core_get(candidate, "score", 0)
            order = _core_get(candidate, "order", 0)
            lower_score = _core_lt(score, best_score)
            equal_score = _core_eq(score, best_score)
            lower_order = _core_lt(order, best_order)
            stable_tie = _core_and(equal_score, lower_order)
            score_or_tie = _core_or(lower_score, stable_tie)
            no_best = _core_not(has_best)
            better = _core_or(no_best, score_or_tie)
            if better:
                best = candidate
                best_score = score
                best_order = order
                has_best = True
            else:
                pass
        missing = _core_not(has_best)
        if missing:
            continue
        else:
            pass
        best_key = _core_get(best, "routeKey", "")
        used[best_key] = True
        ranked.append(best)
    return ranked


def provider_routing_stats(providers: Any) -> Any:
    _core_coverage_mark("provider_routing_stats")
    matrix = {}
    functions = []
    streaming = []
    images = []
    audio = []
    files = []
    urls = []
    caching = []
    for provider in providers:
        name = _core_get(provider, "name", "")
        features = _core_get(provider, "features", None)
        ok_functions = _provider_features_support(features, "functions")
        if ok_functions:
            functions.append(name)
        else:
            pass
        ok_streaming = _provider_features_support(features, "streaming")
        if ok_streaming:
            streaming.append(name)
        else:
            pass
        ok_images = _provider_features_support(features, "images")
        if ok_images:
            images.append(name)
        else:
            pass
        ok_audio = _provider_features_support(features, "audio")
        if ok_audio:
            audio.append(name)
        else:
            pass
        ok_files = _provider_features_support(features, "files")
        if ok_files:
            files.append(name)
        else:
            pass
        ok_urls = _provider_features_support(features, "urls")
        if ok_urls:
            urls.append(name)
        else:
            pass
        ok_caching = _provider_features_support(features, "caching")
        if ok_caching:
            caching.append(name)
        else:
            pass
    functions_count = _core_len(functions)
    has_functions = _core_gt(functions_count, 0)
    if has_functions:
        matrix["Functions"] = functions
    else:
        pass
    streaming_count = _core_len(streaming)
    has_streaming = _core_gt(streaming_count, 0)
    if has_streaming:
        matrix["Streaming"] = streaming
    else:
        pass
    images_count = _core_len(images)
    has_images = _core_gt(images_count, 0)
    if has_images:
        matrix["Images"] = images
    else:
        pass
    audio_count = _core_len(audio)
    has_audio = _core_gt(audio_count, 0)
    if has_audio:
        matrix["Audio"] = audio
    else:
        pass
    files_count = _core_len(files)
    has_files = _core_gt(files_count, 0)
    if has_files:
        matrix["Files"] = files
    else:
        pass
    urls_count = _core_len(urls)
    has_urls = _core_gt(urls_count, 0)
    if has_urls:
        matrix["URLs"] = urls
    else:
        pass
    caching_count = _core_len(caching)
    has_caching = _core_gt(caching_count, 0)
    if has_caching:
        matrix["Caching"] = caching
    else:
        pass
    first = _core_list_get(providers, 0, None)
    recommended = _core_get(first, "name", "None")
    out = {}
    total = _core_len(providers)
    out["totalProviders"] = total
    out["capabilityMatrix"] = matrix
    out["recommendedProvider"] = recommended
    return out


def provider_descriptor(profile: str) -> Any:
    _core_coverage_mark("provider_descriptor")
    provider_id = provider_normalize_profile(profile)
    descriptors = _core_json_parse("{\"openai\":{\"id\":\"openai\",\"name\":\"OpenAI\",\"aliases\":[\"openai\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.openai.com/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"gpt-5-mini\",\"embedModel\":\"text-embedding-3-small\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":true,\"multiTurn\":true,\"images\":true,\"audio\":true,\"audioOutput\":true,\"structuredOutputModes\":[\"native\",\"function\",\"json_object\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"transcribe\":{\"path\":\"/audio/transcriptions\",\"dialect\":\"openai-transcription\",\"method\":\"POST\",\"body\":\"multipart\",\"stream\":false},\"speak\":{\"path\":\"/audio/speech\",\"dialect\":\"openai-speech\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"},\"realtime\":{\"path\":\"/realtime\",\"dialect\":\"openai-realtime\",\"modelMatch\":{\"prefix\":[\"gpt-realtime\"]},\"url\":\"wss://api.openai.com/v1/realtime\",\"grammar\":\"openai_realtime_compatible\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"alloy\",\"ash\",\"ballad\",\"coral\",\"echo\",\"sage\",\"shimmer\",\"verse\"],\"defaultVoice\":\"alloy\"}},\"validation\":{\"structuredOutputWithAudio\":false},\"method\":\"WS\",\"body\":\"json\",\"stream\":true},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://platform.openai.com/docs/api-reference/chat\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"default\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"openai\",\"baseUrl\":\"https://api.openai.com/v1\",\"authRequired\":true,\"defaultModel\":\"gpt-5-mini\",\"defaultEmbedModel\":\"text-embedding-3-small\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\",\"json_object\"],\"thinking\":true,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"],\"realtime\":true,\"output\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"openai-compatible\":{\"id\":\"openai-compatible\",\"name\":\"OpenAI Compatible\",\"aliases\":[\"openai-compatible\",\"openai_compatible\",\"compatible\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://platform.openai.com/docs/api-reference/chat\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"openai-compatible\",\"baseUrl\":null,\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"openai-responses\":{\"id\":\"openai-responses\",\"name\":\"OpenAI Responses\",\"aliases\":[\"openai-responses\",\"openai_responses\",\"responses\"],\"transport\":\"openai-responses\",\"baseURL\":\"https://api.openai.com/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"gpt-5-mini\",\"embedModel\":\"text-embedding-3-small\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":true,\"multiTurn\":true,\"images\":true,\"audio\":true,\"audioOutput\":true,\"structuredOutputModes\":[\"native\",\"function\",\"json_object\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/responses\",\"dialect\":\"openai-responses\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"transcribe\":{\"path\":\"/audio/transcriptions\",\"dialect\":\"openai-transcription\",\"method\":\"POST\",\"body\":\"multipart\",\"stream\":false},\"speak\":{\"path\":\"/audio/speech\",\"dialect\":\"openai-speech\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"},\"realtime\":{\"path\":\"/realtime\",\"dialect\":\"openai-realtime\",\"modelMatch\":{\"prefix\":[\"gpt-realtime\"]},\"url\":\"wss://api.openai.com/v1/realtime\",\"grammar\":\"openai_realtime_compatible\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"alloy\",\"ash\",\"ballad\",\"coral\",\"echo\",\"sage\",\"shimmer\",\"verse\"],\"defaultVoice\":\"alloy\"}},\"validation\":{\"structuredOutputWithAudio\":false},\"method\":\"WS\",\"body\":\"json\",\"stream\":true},\"stream_chat\":{\"path\":\"/responses\",\"dialect\":\"openai-responses\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://platform.openai.com/docs/api-reference/responses\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"default\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"openai-responses\",\"baseUrl\":\"https://api.openai.com/v1\",\"authRequired\":true,\"defaultModel\":\"gpt-5-mini\",\"defaultEmbedModel\":\"text-embedding-3-small\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\",\"json_object\"],\"thinking\":true,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"],\"realtime\":true,\"output\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"anthropic\":{\"id\":\"anthropic\",\"name\":\"Anthropic\",\"aliases\":[\"anthropic\",\"claude\"],\"transport\":\"anthropic-messages\",\"baseURL\":\"https://api.anthropic.com\",\"requiresApiURL\":false,\"auth\":\"x-api-key\",\"headers\":{\"anthropic-version\":\"2023-06-01\",\"anthropic-beta\":\"structured-outputs-2025-11-13, web-search-2025-03-05\"},\"defaults\":{\"model\":\"claude-sonnet-4-5\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":true,\"multiTurn\":true,\"images\":true,\"caching\":{\"types\":[\"ephemeral\"],\"cacheBreakpoints\":true},\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/v1/messages\",\"dialect\":\"anthropic-messages\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/v1/messages\",\"dialect\":\"anthropic-messages\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.anthropic.com/en/api/messages\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"anthropic\",\"baseUrl\":\"https://api.anthropic.com\",\"authRequired\":true,\"defaultModel\":\"claude-sonnet-4-5\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":true,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":true,\"types\":[\"ephemeral\"],\"cache_breakpoints\":true}}},\"google-gemini\":{\"id\":\"google-gemini\",\"name\":\"Google Gemini\",\"aliases\":[\"google-gemini\",\"google_gemini\",\"gemini\"],\"transport\":\"gemini-generate-content\",\"baseURL\":\"https://generativelanguage.googleapis.com/v1beta\",\"requiresApiURL\":false,\"auth\":\"api_key_header\",\"defaults\":{\"model\":\"gemini-3.5-flash\",\"embedModel\":\"gemini-embedding-2\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":true,\"multiTurn\":true,\"images\":true,\"audio\":true,\"audioOutput\":true,\"files\":{\"uploadMethod\":\"cloud\"},\"caching\":{\"types\":[\"persistent\"]},\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/models/{model}:generateContent\",\"dialect\":\"gemini-generate-content\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/models/{model}:streamGenerateContent?alt=sse\",\"dialect\":\"gemini-generate-content\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true},\"embed\":{\"path\":\"/models/{model}:batchEmbedContents\",\"dialect\":\"gemini-generate-content\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"transcribe\":{\"path\":\"/models/{model}:generateContent\",\"dialect\":\"gemini-generate-content\",\"method\":\"POST\",\"body\":\"multipart\",\"stream\":false},\"speak\":{\"path\":\"/models/{model}:generateContent\",\"dialect\":\"gemini-generate-content\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"},\"realtime\":{\"path\":\"/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent\",\"dialect\":\"gemini-live-bidi\",\"modelMatch\":{\"prefix\":[\"gemini-live\"],\"contains\":[\"native-audio\",\"-live-\"]},\"url\":\"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent\",\"grammar\":\"gemini_live_bidi\",\"defaultModel\":\"gemini-2.5-flash-native-audio-preview-12-2025\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":16000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"Kore\",\"Puck\",\"Charon\",\"Fenrir\",\"Aoede\"],\"defaultVoice\":\"Kore\"}},\"validation\":{\"pcmInputOnly\":true,\"rejectStructuredOutputWithAudio\":true},\"method\":\"WS\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://ai.google.dev/api/generate-content\",\"https://ai.google.dev/gemini-api/docs/optimization\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":null,\"standard\":\"standard\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"google-gemini\",\"baseUrl\":\"https://generativelanguage.googleapis.com/v1beta\",\"authRequired\":true,\"apiKeyHeader\":\"x-goog-api-key\",\"defaultModel\":\"gemini-3.5-flash\",\"defaultEmbedModel\":\"gemini-embedding-2\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":true,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"],\"realtime\":true,\"output\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"]}},\"files\":{\"supported\":true,\"formats\":[\"application/pdf\",\"text/plain\"],\"upload_method\":\"cloud\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":true,\"types\":[\"persistent\"]}}},\"webllm\":{\"id\":\"webllm\",\"name\":\"WebLLM\",\"aliases\":[\"webllm\"],\"transport\":\"webllm\",\"baseURL\":null,\"requiresApiURL\":false,\"auth\":\"none\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"\",\"dialect\":\"webllm\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"\",\"dialect\":\"webllm\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://webllm.mlc.ai/docs/\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"webllm\",\"baseUrl\":null,\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"azure-openai\":{\"id\":\"azure-openai\",\"name\":\"Azure OpenAI\",\"aliases\":[\"azure-openai\",\"azure_openai\",\"azure\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":false,\"auth\":\"api_key_header\",\"defaults\":{\"model\":\"gpt-5-mini\",\"embedModel\":\"text-embedding-3-small\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":true,\"multiTurn\":true,\"images\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"endpoint\":{\"scheme\":\"https\",\"hostField\":\"resourceName\",\"hostSuffix\":\".openai.azure.com\",\"path\":\"/openai/deployments/{deploymentName}\",\"fields\":{\"resourceName\":[\"resource_name\",\"resourceName\"],\"deploymentName\":[\"deployment_name\",\"deploymentName\"],\"version\":[\"api_version\",\"apiVersion\",\"version\"]},\"required\":[\"resourceName\",\"deploymentName\"],\"defaults\":{\"version\":\"2024-02-15-preview\"},\"normalizers\":{\"version\":\"api-version\"},\"apiVersionField\":\"version\"},\"capabilityGates\":{\"structuredOutputs\":{\"option\":\"version\",\"min\":\"2024-08-01\"}},\"modelRules\":[],\"sources\":[\"https://learn.microsoft.com/en-us/azure/ai-services/openai/reference\",\"https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"default\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"azure-openai\",\"baseUrl\":null,\"authRequired\":true,\"apiKeyHeader\":\"api-key\",\"apiVersion\":\"2024-02-15-preview\",\"defaultModel\":\"gpt-5-mini\",\"defaultEmbedModel\":\"text-embedding-3-small\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":true,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"deepseek\":{\"id\":\"deepseek\",\"name\":\"DeepSeek\",\"aliases\":[\"deepseek\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.deepseek.com\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"deepseek-v4-flash\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\",\"json_object\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"exact\":[\"deepseek-v4-flash\",\"deepseek-v4-pro\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"structuredOutputModes\":[\"function\"]},\"request\":{\"reasoning\":\"thinking-object\",\"toolChoice\":\"unforced\",\"effortMap\":{\"none\":null,\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"max\",\"xhigh\":\"max\",\"max\":\"max\"},\"dropWhenThinking\":[\"temperature\",\"top_p\",\"presence_penalty\",\"frequency_penalty\"],\"defaultThinkingLevel\":\"max\"},\"response\":{\"reasoningFields\":[\"reasoning_content\",\"reasoning\"]},\"replay\":{\"assistantReasoningField\":\"reasoning_content\"}},{\"match\":{\"exact\":[\"deepseek-reasoner\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"structuredOutputModes\":[\"function\"]},\"request\":{\"toolChoice\":\"unforced\"},\"response\":{\"reasoningFields\":[\"reasoning_content\",\"reasoning\"]},\"replay\":{\"assistantReasoningField\":\"reasoning_content\"}}],\"sources\":[\"https://api-docs.deepseek.com/guides/thinking_mode/\"],\"reviewedAt\":\"2026-08-18\",\"provider\":\"deepseek\",\"baseUrl\":\"https://api.deepseek.com\",\"authRequired\":true,\"defaultModel\":\"deepseek-v4-flash\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\",\"json_object\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"deepseek-responses\":{\"id\":\"deepseek-responses\",\"name\":\"DeepSeek Responses\",\"aliases\":[\"deepseek-responses\",\"deepseek_responses\"],\"transport\":\"openai-responses\",\"baseURL\":\"https://api.deepseek.com\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"deepseek-v4-flash\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":true,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/responses\",\"dialect\":\"openai-responses\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/responses\",\"dialect\":\"openai-responses\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"request\":{\"dropFields\":[\"include\",\"previous_response_id\",\"store\",\"parallel_tool_calls\"],\"reasoningObjectFields\":[\"effort\"]},\"modelRules\":[],\"sources\":[\"https://api-docs.deepseek.com/api/create-chat-completion\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"deepseek-responses\",\"baseUrl\":\"https://api.deepseek.com\",\"authRequired\":true,\"defaultModel\":\"deepseek-v4-flash\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":true,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"mistral\":{\"id\":\"mistral\",\"name\":\"Mistral AI\",\"aliases\":[\"mistral\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.mistral.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"mistral-small-latest\",\"embedModel\":\"mistral-embed\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"images\":true,\"audio\":true,\"audioOutput\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"transcribe\":{\"path\":\"/audio/transcriptions\",\"dialect\":\"openai-transcription\",\"method\":\"POST\",\"body\":\"multipart\",\"stream\":false},\"speak\":{\"path\":\"/audio/speech\",\"dialect\":\"mistral-speech\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"request\":{\"renameFields\":{\"max_completion_tokens\":\"max_tokens\"},\"imageURLShape\":\"object\",\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"standard_only\",\"priority\":\"auto\"}},\"modelRules\":[],\"sources\":[\"https://docs.mistral.ai/api/\",\"https://docs.mistral.ai/inference/priority-tier\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"mistral\",\"baseUrl\":\"https://api.mistral.ai/v1\",\"authRequired\":true,\"defaultModel\":\"mistral-small-latest\",\"defaultEmbedModel\":\"mistral-embed\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"],\"realtime\":false,\"output\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"cohere\":{\"id\":\"cohere\",\"name\":\"Cohere\",\"aliases\":[\"cohere\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.cohere.ai/compatibility/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"command-r-plus\",\"embedModel\":\"embed-english-v3.0\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.cohere.com/reference/compatibility-api\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"cohere\",\"baseUrl\":\"https://api.cohere.ai/compatibility/v1\",\"authRequired\":true,\"defaultModel\":\"command-r-plus\",\"defaultEmbedModel\":\"embed-english-v3.0\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"grok\":{\"id\":\"grok\",\"name\":\"xAI Grok\",\"aliases\":[\"grok\",\"xai\",\"x-grok\",\"x_grok\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.x.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"grok-4.6\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"images\":true,\"audio\":true,\"audioOutput\":true,\"webSearch\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"transcribe\":{\"path\":\"/stt\",\"dialect\":\"xai-transcription\",\"method\":\"POST\",\"body\":\"multipart\",\"stream\":false},\"speak\":{\"path\":\"/tts\",\"dialect\":\"xai-speech\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"},\"realtime\":{\"path\":\"/realtime\",\"dialect\":\"xai-realtime\",\"modelMatch\":{\"prefix\":[\"grok-voice\"]},\"url\":\"wss://api.x.ai/v1/realtime\",\"grammar\":\"openai_realtime_compatible\",\"defaultModel\":\"grok-voice-think-fast-1.0\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"eve\",\"ara\",\"rex\",\"sal\",\"leo\"],\"defaultVoice\":\"eve\"}},\"validation\":{\"structuredOutputWithAudio\":false},\"method\":\"WS\",\"body\":\"json\",\"stream\":true},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"request\":{\"optionDialect\":\"search-parameters\",\"serviceTierMap\":{\"auto\":null,\"standard\":\"default\",\"priority\":\"priority\"}},\"modelRules\":[{\"match\":{\"exact\":[\"grok-4.6\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"structuredOutputs\":true,\"structuredOutputModes\":[\"native\",\"function\"]},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":null,\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"xhigh\",\"xhigh\":\"xhigh\",\"max\":\"xhigh\"},\"unsupportedThinkingLevels\":{\"none\":\"xAI Grok 4.6 reasoning cannot be disabled\"},\"dropFields\":[\"presence_penalty\",\"frequency_penalty\",\"stop\"]}},{\"match\":{\"exact\":[\"grok-4.5\",\"grok-4.5-latest\",\"grok-build-latest\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"structuredOutputs\":true,\"structuredOutputModes\":[\"native\",\"function\"]},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":null,\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"high\",\"xhigh\":\"high\",\"max\":\"high\"},\"unsupportedThinkingLevels\":{\"none\":\"xAI Grok 4.5 reasoning cannot be disabled\"},\"dropFields\":[\"presence_penalty\",\"frequency_penalty\",\"stop\"]}},{\"match\":{\"exact\":[\"grok-4.3\",\"grok-4.3-latest\",\"grok-latest\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"showThoughts\":true,\"structuredOutputs\":true,\"structuredOutputModes\":[\"native\",\"function\"]},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":\"none\",\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"high\",\"xhigh\":\"high\",\"max\":\"high\"},\"dropFields\":[\"presence_penalty\",\"frequency_penalty\",\"stop\"]}}],\"sources\":[\"https://docs.x.ai/developers/model-capabilities/text/reasoning\",\"https://docs.x.ai/developers/models/grok-4.5\",\"https://docs.x.ai/developers/advanced-api-usage/priority-processing\"],\"reviewedAt\":\"2026-08-18\",\"provider\":\"grok\",\"baseUrl\":\"https://api.x.ai/v1\",\"authRequired\":true,\"defaultModel\":\"grok-4.6\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"]},\"audio\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"],\"realtime\":true,\"output\":{\"supported\":true,\"formats\":[\"wav\",\"mp3\",\"pcm16\"]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":true,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"reka\":{\"id\":\"reka\",\"name\":\"Reka\",\"aliases\":[\"reka\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.reka.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"reka-core\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.reka.ai/\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"reka\",\"baseUrl\":\"https://api.reka.ai/v1\",\"authRequired\":true,\"defaultModel\":\"reka-core\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"together\":{\"id\":\"together\",\"name\":\"Together AI\",\"aliases\":[\"together\",\"together-ai\",\"together_ai\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.together.xyz/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"native\",\"function\",\"json_object\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"prefix\":[\"deepseek-ai/DeepSeek-V4\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"structuredOutputModes\":[\"function\"]},\"request\":{\"reasoning\":\"effort\",\"toolChoice\":\"unforced\",\"effortMap\":{\"none\":null,\"minimal\":\"high\",\"low\":\"high\",\"medium\":\"high\",\"high\":\"max\",\"highest\":\"max\",\"xhigh\":\"max\",\"max\":\"max\"},\"defaultThinkingLevel\":\"max\"},\"response\":{\"reasoningFields\":[\"reasoning\",\"reasoning_content\"]},\"replay\":{\"assistantReasoningField\":\"reasoning\"}}],\"sources\":[\"https://docs.together.ai/docs/inference/chat/reasoning\"],\"reviewedAt\":\"2026-08-18\",\"provider\":\"together\",\"baseUrl\":\"https://api.together.xyz/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\",\"json_object\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"openrouter\":{\"id\":\"openrouter\",\"name\":\"OpenRouter\",\"aliases\":[\"openrouter\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://openrouter.ai/api/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"prefix\":[\"deepseek/\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"structuredOutputModes\":[\"function\"]},\"request\":{\"reasoning\":\"openrouter\",\"toolChoice\":\"unforced\",\"effortMap\":{\"none\":\"none\",\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"max\",\"xhigh\":\"xhigh\",\"max\":\"max\"},\"defaultThinkingLevel\":\"max\"},\"response\":{\"reasoningFields\":[\"reasoning\",\"reasoning_content\"],\"reasoningDetailsFields\":[\"reasoning_details\"]},\"replay\":{\"assistantReasoningField\":\"reasoning\",\"assistantReasoningDetailsField\":\"reasoning_details\"}}],\"sources\":[\"https://openrouter.ai/docs/guides/best-practices/reasoning-tokens\",\"https://openrouter.ai/docs/guides/features/service-tiers\"],\"reviewedAt\":\"2026-08-18\",\"request\":{\"serviceTierMap\":{\"auto\":null,\"standard\":null,\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"openrouter\",\"baseUrl\":\"https://openrouter.ai/api/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"orcarouter\":{\"id\":\"orcarouter\",\"name\":\"OrcaRouter\",\"aliases\":[\"orcarouter\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.orcarouter.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"orcarouter/auto\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://www.orcarouter.ai\"],\"reviewedAt\":\"2026-08-19\",\"provider\":\"orcarouter\",\"baseUrl\":\"https://api.orcarouter.ai/v1\",\"authRequired\":true,\"defaultModel\":\"orcarouter/auto\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"fireworks\":{\"id\":\"fireworks\",\"name\":\"Fireworks AI\",\"aliases\":[\"fireworks\",\"fireworks-ai\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.fireworks.ai/inference/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"embed\":{\"path\":\"/embeddings\",\"dialect\":\"openai-embeddings\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"contains\":[\"deepseek-v4\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"structuredOutputModes\":[\"function\"]},\"request\":{\"reasoning\":\"effort\",\"toolChoice\":\"unforced\",\"effortMap\":{\"none\":\"none\",\"minimal\":\"high\",\"low\":\"high\",\"medium\":\"high\",\"high\":\"high\",\"highest\":\"max\",\"xhigh\":\"max\",\"max\":\"max\"},\"defaultThinkingLevel\":\"max\"},\"response\":{\"reasoningFields\":[\"reasoning_content\",\"reasoning\"]},\"replay\":{\"assistantReasoningField\":\"reasoning_content\"}}],\"sources\":[\"https://docs.fireworks.ai/api-reference/post-chatcompletions\",\"https://docs.fireworks.ai/guides/reasoning\"],\"reviewedAt\":\"2026-08-18\",\"request\":{\"serviceTierMap\":{\"auto\":null,\"standard\":\"default\",\"priority\":\"priority\"}},\"provider\":\"fireworks\",\"baseUrl\":\"https://api.fireworks.ai/inference/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"huggingface-router\":{\"id\":\"huggingface-router\",\"name\":\"Hugging Face Router\",\"aliases\":[\"huggingface-router\",\"huggingface\",\"hf-router\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://router.huggingface.co/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://huggingface.co/docs/inference-providers/en/index\",\"https://huggingface.co/docs/inference-providers/en/tasks/chat-completion\"],\"reviewedAt\":\"2026-08-18\",\"provider\":\"huggingface-router\",\"baseUrl\":\"https://router.huggingface.co/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"amazon-bedrock\":{\"id\":\"amazon-bedrock\",\"name\":\"Amazon Bedrock\",\"aliases\":[\"amazon-bedrock\",\"bedrock\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html\",\"https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":null,\"standard\":\"default\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"amazon-bedrock\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"azure-foundry\":{\"id\":\"azure-foundry\",\"name\":\"Azure AI Foundry\",\"aliases\":[\"azure-foundry\",\"azure-ai-foundry\",\"microsoft-foundry\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"api_key_header\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat\",\"https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"default\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"azure-foundry\",\"baseUrl\":null,\"authRequired\":true,\"apiKeyHeader\":\"api-key\",\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"vertex-ai\":{\"id\":\"vertex-ai\",\"name\":\"Vertex AI OpenAI Compatibility\",\"aliases\":[\"vertex-ai\",\"vertex-openai\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"exact\":[\"google/gemma-4-26b-a4b-it-maas\"]},\"capabilities\":{\"structuredOutputs\":false,\"structuredOutputModes\":[\"json_object\",\"function\"],\"thinking\":true},\"request\":{\"defaultThinkingLevel\":\"max\",\"thinkingBoolean\":{\"path\":[\"chat_template_kwargs\",\"enable_thinking\"]}},\"response\":{\"reasoningFields\":[\"reasoning_content\"]},\"replay\":{\"assistantReasoningField\":\"reasoning_content\"}},{\"match\":{\"prefix\":[\"google/gemini-\",\"gemini-\"]},\"capabilities\":{\"structuredOutputs\":true,\"structuredOutputModes\":[\"native\",\"function\",\"json_object\"]}}],\"sources\":[\"https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library\",\"https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/structured-output\",\"https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/thinking\"],\"reviewedAt\":\"2026-08-18\",\"provider\":\"vertex-ai\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"databricks\":{\"id\":\"databricks\",\"name\":\"Databricks Model Serving\",\"aliases\":[\"databricks\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.databricks.com/aws/en/machine-learning/model-serving/query-chat-models\",\"https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/priority-mode\"],\"reviewedAt\":\"2026-08-17\",\"request\":{\"serviceTierMap\":{\"auto\":null,\"standard\":\"default\",\"priority\":\"priority\"}},\"provider\":\"databricks\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"baseten\":{\"id\":\"baseten\",\"name\":\"Baseten Model APIs\",\"aliases\":[\"baseten\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://inference.baseten.co/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.baseten.co/inference/model-apis/overview\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"baseten\",\"baseUrl\":\"https://inference.baseten.co/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"groq\":{\"id\":\"groq\",\"name\":\"Groq\",\"aliases\":[\"groq\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.groq.com/openai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"exact\":[\"openai/gpt-oss-20b\",\"openai/gpt-oss-120b\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":null,\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"high\",\"xhigh\":\"high\",\"max\":\"high\"},\"unsupportedThinkingLevels\":{\"none\":\"Groq GPT-OSS reasoning does not support the none effort level\"}}},{\"match\":{\"exact\":[\"qwen/qwen3.6-27b\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":\"none\",\"minimal\":\"default\",\"low\":\"default\",\"medium\":\"default\",\"high\":\"default\",\"highest\":\"default\",\"xhigh\":\"default\",\"max\":\"default\"}}}],\"sources\":[\"https://console.groq.com/docs/reasoning\",\"https://console.groq.com/docs/api-reference\",\"https://console.groq.com/docs/service-tiers\"],\"reviewedAt\":\"2026-08-18\",\"request\":{\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"on_demand\",\"flex\":\"flex\",\"priority\":\"performance\"}},\"provider\":\"groq\",\"baseUrl\":\"https://api.groq.com/openai/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"cerebras\":{\"id\":\"cerebras\",\"name\":\"Cerebras Inference\",\"aliases\":[\"cerebras\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.cerebras.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":true,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"native\",\"function\"],\"serviceTiers\":[\"standard\",\"flex\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"exact\":[\"gpt-oss-120b\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":null,\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"high\",\"xhigh\":\"high\",\"max\":\"high\"},\"unsupportedThinkingLevels\":{\"none\":\"Cerebras GPT-OSS reasoning does not support the none effort level\"}}},{\"match\":{\"exact\":[\"gemma-4-31b\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":\"none\",\"minimal\":\"high\",\"low\":\"high\",\"medium\":\"high\",\"high\":\"high\",\"highest\":\"high\",\"xhigh\":\"high\",\"max\":\"high\"}}}],\"sources\":[\"https://inference-docs.cerebras.ai/capabilities/reasoning\",\"https://inference-docs.cerebras.ai/api-reference/chat-completions\",\"https://inference-docs.cerebras.ai/capabilities/service-tiers\"],\"reviewedAt\":\"2026-08-18\",\"request\":{\"serviceTierMap\":{\"auto\":\"auto\",\"standard\":\"default\",\"flex\":\"flex\",\"priority\":\"priority\"}},\"provider\":\"cerebras\",\"baseUrl\":\"https://api.cerebras.ai/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"structured_output_modes\":[\"native\",\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"flex\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"deepinfra\":{\"id\":\"deepinfra\",\"name\":\"DeepInfra\",\"aliases\":[\"deepinfra\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.deepinfra.com/v1/openai\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[\"standard\",\"priority\"]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[{\"match\":{\"prefix\":[\"deepseek-ai/DeepSeek-R1\"]},\"capabilities\":{\"thinking\":true,\"thinkingBudget\":true},\"request\":{\"reasoning\":\"effort\",\"defaultThinkingLevel\":\"max\",\"effortMap\":{\"none\":\"none\",\"minimal\":\"low\",\"low\":\"low\",\"medium\":\"medium\",\"high\":\"high\",\"highest\":\"high\",\"xhigh\":\"high\",\"max\":\"high\"}}}],\"sources\":[\"https://docs.deepinfra.com/chat/reasoning\",\"https://docs.deepinfra.com/api-reference/introduction\",\"https://docs.deepinfra.com/chat/overview\"],\"reviewedAt\":\"2026-08-18\",\"request\":{\"serviceTierMap\":{\"auto\":null,\"standard\":null,\"priority\":\"priority\"}},\"provider\":\"deepinfra\",\"baseUrl\":\"https://api.deepinfra.com/v1/openai\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[\"standard\",\"priority\"],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"sambanova\":{\"id\":\"sambanova\",\"name\":\"SambaNova Cloud\",\"aliases\":[\"sambanova\",\"sambanova-cloud\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.sambanova.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.sambanova.ai/docs/en/api-reference/overview\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"sambanova\",\"baseUrl\":\"https://api.sambanova.ai/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"nebius\":{\"id\":\"nebius\",\"name\":\"Nebius AI Studio\",\"aliases\":[\"nebius\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.tokenfactory.nebius.com/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://api.studio.nebius.com/docs\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"nebius\",\"baseUrl\":\"https://api.tokenfactory.nebius.com/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"novita\":{\"id\":\"novita\",\"name\":\"Novita AI\",\"aliases\":[\"novita\",\"novita-ai\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.novita.ai/v3/openai\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://novita.ai/docs/guides/llm-api\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"novita\",\"baseUrl\":\"https://api.novita.ai/v3/openai\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"hyperbolic\":{\"id\":\"hyperbolic\",\"name\":\"Hyperbolic\",\"aliases\":[\"hyperbolic\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.hyperbolic.xyz/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.hyperbolic.xyz/docs/inference-api\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"hyperbolic\",\"baseUrl\":\"https://api.hyperbolic.xyz/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"siliconflow\":{\"id\":\"siliconflow\",\"name\":\"SiliconFlow\",\"aliases\":[\"siliconflow\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.siliconflow.com/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.siliconflow.com/en/userguide/quickstart\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"siliconflow\",\"baseUrl\":\"https://api.siliconflow.com/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"friendli\":{\"id\":\"friendli\",\"name\":\"FriendliAI\",\"aliases\":[\"friendli\",\"friendli-ai\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.friendli.ai/serverless/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://friendli.ai/docs/guides/tool-calling\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"friendli\",\"baseUrl\":\"https://api.friendli.ai/serverless/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"cloudflare-workers-ai\":{\"id\":\"cloudflare-workers-ai\",\"name\":\"Cloudflare Workers AI\",\"aliases\":[\"cloudflare-workers-ai\",\"workers-ai\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"cloudflare-workers-ai\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"featherless\":{\"id\":\"featherless\",\"name\":\"Featherless AI\",\"aliases\":[\"featherless\",\"featherless-ai\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.featherless.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://featherless.ai/docs/quickstart-guide\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"featherless\",\"baseUrl\":\"https://api.featherless.ai/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"nscale\":{\"id\":\"nscale\",\"name\":\"Nscale\",\"aliases\":[\"nscale\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.nscale.com/docs/use-cases/chat\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"nscale\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"ovhcloud\":{\"id\":\"ovhcloud\",\"name\":\"OVHcloud AI Endpoints\",\"aliases\":[\"ovhcloud\",\"ovh\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"ovhcloud\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"scaleway\":{\"id\":\"scaleway\",\"name\":\"Scaleway Generative APIs\",\"aliases\":[\"scaleway\"],\"transport\":\"openai-chat\",\"baseURL\":\"https://api.scaleway.ai/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://www.scaleway.com/en/developers/api/generative-apis\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"scaleway\",\"baseUrl\":\"https://api.scaleway.ai/v1\",\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"nvidia-nim\":{\"id\":\"nvidia-nim\",\"name\":\"NVIDIA NIM\",\"aliases\":[\"nvidia-nim\",\"nim\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.nvidia.com/nim/large-language-models/latest/getting-started.html\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"nvidia-nim\",\"baseUrl\":null,\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"runpod-vllm\":{\"id\":\"runpod-vllm\",\"name\":\"RunPod vLLM\",\"aliases\":[\"runpod-vllm\",\"runpod\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.runpod.io/serverless/vllm/openai-compatibility\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"runpod-vllm\",\"baseUrl\":null,\"authRequired\":true,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"sagemaker-vllm\":{\"id\":\"sagemaker-vllm\",\"name\":\"SageMaker vLLM\",\"aliases\":[\"sagemaker-vllm\",\"sagemaker\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints-openai-compatible.html\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"sagemaker-vllm\",\"baseUrl\":null,\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"vllm\":{\"id\":\"vllm\",\"name\":\"vLLM\",\"aliases\":[\"vllm\"],\"transport\":\"openai-chat\",\"baseURL\":\"http://localhost:8000/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.vllm.ai/en/latest/serving/openai_compatible_server/\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"vllm\",\"baseUrl\":\"http://localhost:8000/v1\",\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"ollama\":{\"id\":\"ollama\",\"name\":\"Ollama\",\"aliases\":[\"ollama\"],\"transport\":\"openai-chat\",\"baseURL\":\"http://localhost:11434/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.ollama.com/api/openai-compatibility\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"ollama\",\"baseUrl\":\"http://localhost:11434/v1\",\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"lm-studio\":{\"id\":\"lm-studio\",\"name\":\"LM Studio\",\"aliases\":[\"lm-studio\",\"lmstudio\"],\"transport\":\"openai-chat\",\"baseURL\":\"http://localhost:1234/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://lmstudio.ai/docs/developer/openai-compat\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"lm-studio\",\"baseUrl\":\"http://localhost:1234/v1\",\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"llama-cpp\":{\"id\":\"llama-cpp\",\"name\":\"llama.cpp Server\",\"aliases\":[\"llama-cpp\",\"llama.cpp\"],\"transport\":\"openai-chat\",\"baseURL\":\"http://localhost:8080/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"llama-cpp\",\"baseUrl\":\"http://localhost:8080/v1\",\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"localai\":{\"id\":\"localai\",\"name\":\"LocalAI\",\"aliases\":[\"localai\",\"local-ai\"],\"transport\":\"openai-chat\",\"baseURL\":\"http://localhost:8080/v1\",\"requiresApiURL\":false,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://localai.io/features/openai-functions/\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"localai\",\"baseUrl\":\"http://localhost:8080/v1\",\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"baseten-engine\":{\"id\":\"baseten-engine\",\"name\":\"Baseten Inference Engine\",\"aliases\":[\"baseten-engine\",\"truss\"],\"transport\":\"openai-chat\",\"baseURL\":null,\"requiresApiURL\":true,\"auth\":\"bearer\",\"defaults\":{\"model\":\"\"},\"capabilities\":{\"functions\":true,\"streaming\":true,\"structuredOutputs\":false,\"thinking\":false,\"multiTurn\":true,\"structuredOutputModes\":[\"function\"],\"serviceTiers\":[]},\"operations\":{\"chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"path\":\"/chat/completions\",\"dialect\":\"openai-chat\",\"method\":\"POST\",\"body\":\"json\",\"stream\":true}},\"modelRules\":[],\"sources\":[\"https://docs.baseten.co/development/model/deployment/inference\"],\"reviewedAt\":\"2026-08-17\",\"provider\":\"baseten-engine\",\"baseUrl\":null,\"authRequired\":false,\"defaultModel\":\"\",\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":false,\"structured_output_modes\":[\"function\"],\"thinking\":false,\"multi_turn\":true,\"service_tiers\":[],\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"realtime\":false,\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}}}\n")
    empty = {}
    descriptor = _core_get(descriptors, provider_id, empty)
    return descriptor


def provider_resolve_descriptor(profile: str, options: Any) -> Any:
    _core_coverage_mark("provider_resolve_descriptor")
    descriptor = provider_descriptor(profile)
    provider_id = provider_normalize_profile(profile)
    generic_base_snake = _core_get(options, "base_url", None)
    generic_base_camel = _core_get(options, "baseUrl", generic_base_snake)
    generic_base = _core_get(options, "apiURL", generic_base_camel)
    has_generic_base_override = _core_truthy(generic_base)
    if has_generic_base_override:
        descriptor["baseUrl"] = generic_base
    else:
        pass
    endpoint_config = _core_get(descriptor, "endpoint", None)
    has_endpoint_config = _core_truthy(endpoint_config)
    no_generic_override = _core_not(has_generic_base_override)
    resolve_endpoint = _core_and(has_endpoint_config, no_generic_override)
    if resolve_endpoint:
        field_aliases = _core_get(endpoint_config, "fields", None)
        field_names = _core_map_keys(field_aliases)
        field_defaults = _core_get(endpoint_config, "defaults", None)
        normalizers = _core_get(endpoint_config, "normalizers", None)
        field_values = {}
        for field_name in field_names:
            aliases = _core_get(field_aliases, field_name, None)
            field_value = _core_none()
            for alias in aliases:
                candidate = _core_get(options, alias, None)
                has_candidate = _core_truthy(candidate)
                if has_candidate:
                    field_value = candidate
                else:
                    pass
            has_field_value = _core_truthy(field_value)
            if has_field_value:
                pass
            else:
                field_value = _core_get(field_defaults, field_name, None)
            normalizer = _core_get(normalizers, field_name, None)
            api_version_normalizer = _core_eq(normalizer, "api-version")
            if api_version_normalizer:
                has_api_version_prefix = _core_string_starts_with(field_value, "api-version=")
                if has_api_version_prefix:
                    field_value = _core_string_replace(field_value, "api-version=", "")
                else:
                    pass
            else:
                pass
            field_values[field_name] = field_value
        required_fields = _core_get(endpoint_config, "required", None)
        for required_field in required_fields:
            required_value = _core_get(field_values, required_field, None)
            has_required_value = _core_truthy(required_value)
            missing_required_value = _core_not(has_required_value)
            if missing_required_value:
                message = _core_string_format("deployment profile {} requires endpoint option {}", provider_id, required_field)
                error = _core_ai_error_unsupported(message)
                raise error
            else:
                pass
        host_field = _core_get(endpoint_config, "hostField", None)
        host_value = _core_get(field_values, host_field, None)
        scheme = _core_get(endpoint_config, "scheme", "https")
        host_suffix = _core_get(endpoint_config, "hostSuffix", "")
        host = _core_string_format("{}://{}{}", scheme, host_value, host_suffix)
        endpoint_path = _core_get(endpoint_config, "path", "")
        for field_name in field_names:
            open_brace = "{"
            close_brace = "}"
            token = _core_string_format("{}{}{}", open_brace, field_name, close_brace)
            field_value = _core_get(field_values, field_name, None)
            endpoint_path = _core_string_replace(endpoint_path, token, field_value)
        endpoint_base_url = _core_string_format("{}{}", host, endpoint_path)
        descriptor["baseUrl"] = endpoint_base_url
        api_version_field = _core_get(endpoint_config, "apiVersionField", None)
        has_api_version_field = _core_truthy(api_version_field)
        if has_api_version_field:
            api_version = _core_get(field_values, api_version_field, None)
            descriptor["apiVersion"] = api_version
        else:
            pass
    else:
        pass
    project_snake = _core_get(options, "project_id", None)
    project = _core_get(options, "projectId", project_snake)
    region = _core_get(options, "region", None)
    project_present = _core_truthy(project)
    region_present = _core_truthy(region)
    is_vertex = _core_and(project_present, region_present)
    if is_vertex:
        transport = _core_get(descriptor, "transport", "openai-chat")
        is_gemini = _core_eq(transport, "gemini-generate-content")
        is_anthropic = _core_eq(transport, "anthropic-messages")
        vertex_provider = _core_or(is_gemini, is_anthropic)
        if vertex_provider:
            host = resolve_vertex_ai_host(region)
            base_override_snake = _core_get(options, "base_url", None)
            base_override = _core_get(options, "baseUrl", base_override_snake)
            has_base_override = _core_truthy(base_override)
            base_url = base_override
            if has_base_override:
                pass
            else:
                beta = _core_get(options, "beta", False)
                use_beta = _core_truthy(beta)
                version = "v1"
                if use_beta:
                    version = "v1beta1"
                else:
                    pass
                base_url = _core_string_format("https://{}/{}", host, version)
            descriptor["baseUrl"] = base_url
            descriptor["auth"] = "bearer"
            _core_map_delete(descriptor, "apiKeyQuery")
            _core_map_delete(descriptor, "apiKeyHeader")
            operations = _core_get(descriptor, "operations", None)
            resource_parent = _core_string_format("projects/{}/locations/{}", project, region)
            parent = _core_string_format("/{}", resource_parent)
            if is_gemini:
                endpoint_snake = _core_get(options, "endpoint_id", None)
                endpoint = _core_get(options, "endpointId", endpoint_snake)
                has_endpoint = _core_truthy(endpoint)
                model_prefix_raw = _core_string_format("{}/publishers/google/models/MODEL_TOKEN", parent)
                model_prefix = _core_string_replace(model_prefix_raw, "MODEL_TOKEN", "{model}")
                embed_prefix = model_prefix
                if has_endpoint:
                    model_prefix = _core_string_format("{}/endpoints/{}", parent, endpoint)
                    embed_prefix = model_prefix
                else:
                    pass
                chat_path = _core_string_format("{}:generateContent", model_prefix)
                stream_path = _core_string_format("{}:streamGenerateContent?alt=sse", model_prefix)
                embed_path = _core_string_format("{}:predict", embed_prefix)
                chat = _core_get(operations, "chat", None)
                stream_chat = _core_get(operations, "stream_chat", None)
                embed = _core_get(operations, "embed", None)
                transcribe = _core_get(operations, "transcribe", None)
                speak = _core_get(operations, "speak", None)
                chat["path"] = chat_path
                stream_chat["path"] = stream_path
                embed["path"] = embed_path
                transcribe["path"] = chat_path
                speak["path"] = chat_path
                headers = {}
                descriptor["headers"] = headers
                descriptor["vertex"] = True
                descriptor["vertexParent"] = resource_parent
                cache_base_url = _core_string_format("https://{}/v1", host)
                if has_base_override:
                    cache_base_url = base_override
                else:
                    pass
                descriptor["vertexCacheBaseUrl"] = cache_base_url
            else:
                model_path_raw = _core_string_format("{}/publishers/anthropic/models/MODEL_TOKEN:rawPredict", parent)
                model_path = _core_string_replace(model_path_raw, "MODEL_TOKEN", "{model}")
                stream_model_path_raw = _core_string_format("{}/publishers/anthropic/models/MODEL_TOKEN:streamRawPredict?alt=sse", parent)
                stream_model_path = _core_string_replace(stream_model_path_raw, "MODEL_TOKEN", "{model}")
                chat = _core_get(operations, "chat", None)
                stream_chat = _core_get(operations, "stream_chat", None)
                chat["path"] = model_path
                stream_chat["path"] = stream_model_path
                headers = {}
                headers["anthropic-beta"] = "web-search-2025-03-05"
                descriptor["headers"] = headers
                descriptor["vertex"] = True
            descriptor["operations"] = operations
        else:
            pass
    else:
        pass
    return descriptor


def resolve_vertex_ai_host(region: str) -> str:
    _core_coverage_mark("resolve_vertex_ai_host")
    is_global = _core_eq(region, "global")
    if is_global:
        return "aiplatform.googleapis.com"
    else:
        pass
    is_us = _core_eq(region, "us")
    is_eu = _core_eq(region, "eu")
    is_multi = _core_or(is_us, is_eu)
    if is_multi:
        multi_host = _core_string_format("aiplatform.{}.rep.googleapis.com", region)
        return multi_host
    else:
        pass
    regional_host = _core_string_format("{}-aiplatform.googleapis.com", region)
    return regional_host


def provider_operation_descriptor(profile: str, operation: str) -> Any:
    _core_coverage_mark("provider_operation_descriptor")
    descriptor = provider_descriptor(profile)
    operations = _core_get(descriptor, "operations", None)
    operation_desc = _core_get(operations, operation, None)
    missing = _core_is_none(operation_desc)
    if missing:
        message = _core_string_format("provider operation is not supported: {}", operation)
        error = _core_ai_error_unsupported(message)
        raise error
    else:
        pass
    return operation_desc


def provider_resolve_operation_descriptor(profile: str, operation: str, options: Any) -> Any:
    _core_coverage_mark("provider_resolve_operation_descriptor")
    descriptor = provider_resolve_descriptor(profile, options)
    operations = _core_get(descriptor, "operations", None)
    operation_desc = _core_get(operations, operation, None)
    missing = _core_is_none(operation_desc)
    if missing:
        message = _core_string_format("provider operation is not supported: {}", operation)
        error = _core_ai_error_unsupported(message)
        raise error
    else:
        pass
    return operation_desc


def _provider_realtime_audio_descriptor(profile: str) -> Any:
    _core_coverage_mark("_provider_realtime_audio_descriptor")
    operation = provider_operation_descriptor(profile, "realtime")
    return operation


def provider_realtime_ws_url(profile: str, model: str, api_key: str) -> Any:
    _core_coverage_mark("provider_realtime_ws_url")
    descriptor = _provider_realtime_audio_descriptor(profile)
    grammar = _core_get(descriptor, "grammar", "openai_realtime_compatible")
    base = _core_get(descriptor, "url", "")
    out = {}
    headers = {}
    is_gemini = _core_eq(grammar, "gemini_live_bidi")
    if is_gemini:
        gemini_url = _core_string_format("{}?key={}", base, api_key)
        out["url"] = gemini_url
        out["headers"] = headers
        return out
    else:
        pass
    openai_url = _core_string_format("{}?model={}", base, model)
    auth = _core_string_format("Bearer {}", api_key)
    headers["Authorization"] = auth
    out["url"] = openai_url
    out["headers"] = headers
    return out


def provider_should_use_realtime(profile: str, model: str, request: Any, options: Any) -> bool:
    _core_coverage_mark("provider_should_use_realtime")
    descriptor = provider_resolve_descriptor(profile, options)
    operations = _core_get(descriptor, "operations", None)
    realtime_op = _core_get(operations, "realtime", None)
    has_realtime = _core_is_not_none(realtime_op)
    empty_match = {}
    model_match = _core_get(realtime_op, "modelMatch", empty_match)
    has_model_match = _core_truthy(model_match)
    matches_model = True
    if has_model_match:
        matches_model = _provider_model_matches(model_match, model)
    else:
        pass
    audio = _core_get(request, "audio", None)
    output = _core_get(audio, "output", None)
    enabled = _core_get(output, "enabled", None)
    explicitly_disabled = _core_eq(enabled, False)
    audio_ok = _core_not(explicitly_disabled)
    operation_matches = _core_and(has_realtime, matches_model)
    result = _core_and(operation_matches, audio_ok)
    if result:
        grammar = _core_get(realtime_op, "grammar", "")
        is_gemini_live = _core_eq(grammar, "gemini_live_bidi")
        if is_gemini_live:
            is_vertex = _core_get(descriptor, "vertex", False)
            service_tier = _gemini_service_tier_impl(request, options, is_vertex, True)
        else:
            pass
    else:
        pass
    return result


def provider_build_realtime_audio_setup(profile: str, request: Any, options: Any) -> Any:
    _core_coverage_mark("provider_build_realtime_audio_setup")
    descriptor = provider_resolve_descriptor(profile, options)
    is_vertex = _core_get(descriptor, "vertex", False)
    operations = _core_get(descriptor, "operations", None)
    descriptor = _core_get(operations, "realtime", None)
    grammar = _core_get(descriptor, "grammar", "openai_realtime_compatible")
    is_gemini_live = _core_eq(grammar, "gemini_live_bidi")
    if is_gemini_live:
        service_tier = _gemini_service_tier_impl(request, options, is_vertex, True)
        setup = _gemini_live_bidi_build_setup(descriptor, request)
        return setup
    else:
        pass
    openai_setup = _openai_realtime_compatible_build_setup(descriptor, request)
    return openai_setup


def provider_build_realtime_audio_input(profile: str, request: Any) -> list[Any]:
    _core_coverage_mark("provider_build_realtime_audio_input")
    descriptor = _provider_realtime_audio_descriptor(profile)
    grammar = _core_get(descriptor, "grammar", "openai_realtime_compatible")
    is_gemini_live = _core_eq(grammar, "gemini_live_bidi")
    if is_gemini_live:
        input = _gemini_live_bidi_build_input(descriptor, request)
        return input
    else:
        pass
    openai_input = _openai_realtime_compatible_build_input(descriptor, request)
    return openai_input


def _openai_realtime_compatible_build_setup(descriptor: Any, request: Any) -> Any:
    _core_coverage_mark("_openai_realtime_compatible_build_setup")
    audio_descriptor = _core_get(descriptor, "audio", None)
    output_audio_descriptor = _core_get(audio_descriptor, "output", None)
    default_voice = _core_get(output_audio_descriptor, "defaultVoice", "alloy")
    request_audio = _core_get(request, "audio", None)
    request_output_audio = _core_get(request_audio, "output", None)
    request_voice = _core_get(request_output_audio, "voice", default_voice)
    voice_id = _core_get(request_voice, "id", request_voice)
    output_rate = _core_get(request_output_audio, "sampleRate", None)
    output_rate_snake = _core_get(request_output_audio, "sample_rate", output_rate)
    default_output_rate = _core_get(output_audio_descriptor, "sampleRate", 24000)
    output_sample_rate = _core_get(request_output_audio, "rate", output_rate_snake)
    has_output_sample_rate = _core_is_not_none(output_sample_rate)
    if has_output_sample_rate:
        pass
    else:
        output_sample_rate = default_output_rate
    input_audio_descriptor = _core_get(audio_descriptor, "input", None)
    request_input_audio = _core_get(request_audio, "input", None)
    input_rate = _core_get(request_input_audio, "sampleRate", None)
    input_rate_snake = _core_get(request_input_audio, "sample_rate", input_rate)
    default_input_rate = _core_get(input_audio_descriptor, "sampleRate", 24000)
    input_sample_rate = _core_get(request_input_audio, "rate", input_rate_snake)
    has_input_sample_rate = _core_is_not_none(input_sample_rate)
    if has_input_sample_rate:
        pass
    else:
        input_sample_rate = default_input_rate
    session = {}
    session["type"] = "realtime"
    default_model = _core_get(descriptor, "defaultModel", None)
    model = _core_get(request, "model", default_model)
    session["model"] = model
    output_modalities = _core_json_parse("[\"audio\"]")
    session["output_modalities"] = output_modalities
    audio = {}
    input = {}
    input_format = {}
    input_format["type"] = "audio/pcm"
    input_format["rate"] = input_sample_rate
    input["format"] = input_format
    audio["input"] = input
    output = {}
    output_format = {}
    output_format["type"] = "audio/pcm"
    output_format["rate"] = output_sample_rate
    output["format"] = output_format
    output["voice"] = voice_id
    audio["output"] = output
    session["audio"] = audio
    instructions = _realtime_request_system_instruction_impl(request)
    has_instructions = _core_truthy(instructions)
    if has_instructions:
        session["instructions"] = instructions
    else:
        pass
    out = {}
    out["type"] = "session.update"
    out["session"] = session
    return out


def _openai_realtime_compatible_build_input(descriptor: Any, request: Any) -> list[Any]:
    _core_coverage_mark("_openai_realtime_compatible_build_input")
    events = []
    messages = _realtime_request_user_messages_impl(request)
    for message in messages:
        content = _core_get(message, "content", "")
        parts = _openai_realtime_content_parts_impl(content)
        item = {}
        item["type"] = "message"
        item["role"] = "user"
        item["content"] = parts
        event = {}
        event["type"] = "conversation.item.create"
        event["item"] = item
        events.append(event)
    response = {}
    response_modalities = _core_json_parse("[\"audio\"]")
    response["output_modalities"] = response_modalities
    response_event = {}
    response_event["type"] = "response.create"
    response_event["response"] = response
    events.append(response_event)
    return events


def _gemini_live_bidi_build_setup(descriptor: Any, request: Any) -> Any:
    _core_coverage_mark("_gemini_live_bidi_build_setup")
    response_format = _core_get(request, "response_format", None)
    has_response_format = _core_truthy(response_format)
    if has_response_format:
        error = _core_ai_error_unsupported("Gemini Live audio does not support structured response formats")
        raise error
    else:
        pass
    default_model = _core_get(descriptor, "defaultModel", "gemini-2.5-flash-native-audio-preview-12-2025")
    request_model = _core_get(request, "model", default_model)
    model_prefix = _core_contains(request_model, "models/")
    model = request_model
    if model_prefix:
        pass
    else:
        model = _core_string_format("models/{}", request_model)
    audio_descriptor = _core_get(descriptor, "audio", None)
    output_audio_descriptor = _core_get(audio_descriptor, "output", None)
    request_audio = _core_get(request, "audio", None)
    request_output_audio = _core_get(request_audio, "output", None)
    default_voice = _core_get(output_audio_descriptor, "defaultVoice", "Kore")
    voice = _core_get(request_output_audio, "voice", default_voice)
    voice_name = _core_get(voice, "name", voice)
    setup = {}
    setup["model"] = model
    generation_config = {}
    modalities = _core_json_parse("[\"AUDIO\"]")
    generation_config["responseModalities"] = modalities
    speech_config = {}
    voice_config = {}
    prebuilt_voice = {}
    prebuilt_voice["voiceName"] = voice_name
    voice_config["prebuiltVoiceConfig"] = prebuilt_voice
    speech_config["voiceConfig"] = voice_config
    generation_config["speechConfig"] = speech_config
    empty_model_config = {}
    model_config = _core_get(request, "model_config", empty_model_config)
    _gemini_apply_thinking_config_impl(generation_config, request_model, model_config)
    setup["generationConfig"] = generation_config
    include_transcript = _core_get(request_output_audio, "transcript", True)
    if include_transcript:
        transcript = {}
        setup["outputAudioTranscription"] = transcript
    else:
        pass
    instructions = _realtime_request_system_instruction_impl(request)
    has_instructions = _core_truthy(instructions)
    if has_instructions:
        part = {}
        part["text"] = instructions
        parts = []
        parts.append(part)
        system_instruction = {}
        system_instruction["parts"] = parts
        setup["systemInstruction"] = system_instruction
    else:
        pass
    out = {}
    out["setup"] = setup
    return out


def _gemini_live_bidi_build_input(descriptor: Any, request: Any) -> list[Any]:
    _core_coverage_mark("_gemini_live_bidi_build_input")
    events = []
    messages = _realtime_request_user_messages_impl(request)
    for message in messages:
        content = _core_get(message, "content", "")
        is_list = _core_type_is(content, "list")
        text_parts = []
        audio_events = []
        if is_list:
            for part in content:
                part_type = _core_get(part, "type", "text")
                is_text = _core_eq(part_type, "text")
                if is_text:
                    text_part = {}
                    text = _core_get(part, "text", "")
                    text_part["text"] = text
                    text_parts.append(text_part)
                else:
                    pass
                is_audio = _core_eq(part_type, "audio")
                if is_audio:
                    format = _core_get(part, "format", "pcm16")
                    format_lower = _core_string_lower(format)
                    is_pcm16 = _core_eq(format_lower, "pcm16")
                    is_pcm = _core_eq(format_lower, "pcm")
                    valid_pcm = _core_or(is_pcm16, is_pcm)
                    if valid_pcm:
                        pass
                    else:
                        error = _core_ai_error_unsupported("Gemini Live audio input must be PCM")
                        raise error
                    data = _core_get(part, "data", "")
                    sample_rate = _core_get(part, "sampleRate", None)
                    sample_rate_snake = _core_get(part, "sample_rate", sample_rate)
                    sample_rate_final = sample_rate_snake
                    has_sample_rate = _core_is_not_none(sample_rate_final)
                    if has_sample_rate:
                        pass
                    else:
                        sample_rate_final = 16000
                    mime = _core_string_format("audio/pcm;rate={}", sample_rate_final)
                    audio = {}
                    audio["data"] = data
                    audio["mimeType"] = mime
                    realtime_input = {}
                    realtime_input["audio"] = audio
                    audio_event = {}
                    audio_event["realtimeInput"] = realtime_input
                    audio_events.append(audio_event)
                else:
                    pass
        else:
            text_part = {}
            text_part["text"] = content
            text_parts.append(text_part)
        audio_count = _core_len(audio_events)
        msg_has_audio = _core_gt(audio_count, 0)
        text_count = _core_len(text_parts)
        has_text = _core_gt(text_count, 0)
        if has_text:
            turn = {}
            turn["role"] = "user"
            turn["parts"] = text_parts
            turns = []
            turns.append(turn)
            client_content = {}
            client_content["turns"] = turns
            turn_complete = _core_not(msg_has_audio)
            client_content["turnComplete"] = turn_complete
            content_event = {}
            content_event["clientContent"] = client_content
            events.append(content_event)
        else:
            pass
        for audio_event in audio_events:
            events.append(audio_event)
        if msg_has_audio:
            stream_end = {}
            stream_end["audioStreamEnd"] = True
            end_event = {}
            end_event["realtimeInput"] = stream_end
            events.append(end_event)
        else:
            pass
    return events


def _realtime_request_system_instruction_impl(request: Any) -> str:
    _core_coverage_mark("_realtime_request_system_instruction_impl")
    direct = _core_get(request, "instructions", None)
    has_direct = _core_truthy(direct)
    if has_direct:
        return direct
    else:
        pass
    empty_prompt = []
    prompt = _core_get(request, "chat_prompt", empty_prompt)
    parts = []
    for message in prompt:
        role = _core_get(message, "role", None)
        is_system = _core_eq(role, "system")
        if is_system:
            content = _core_get(message, "content", "")
            parts.append(content)
        else:
            pass
    out = _core_string_join("\n", parts)
    return out


def _realtime_request_user_messages_impl(request: Any) -> list[Any]:
    _core_coverage_mark("_realtime_request_user_messages_impl")
    empty_prompt = []
    prompt = _core_get(request, "chat_prompt", empty_prompt)
    out = []
    for message in prompt:
        role = _core_get(message, "role", None)
        is_user = _core_eq(role, "user")
        if is_user:
            out.append(message)
        else:
            pass
    count = _core_len(out)
    has_out = _core_gt(count, 0)
    if has_out:
        pass
    else:
        input = _core_get(request, "input", None)
        has_input = _core_is_not_none(input)
        if has_input:
            message = {}
            message["role"] = "user"
            message["content"] = input
            out.append(message)
        else:
            pass
    return out


def _openai_realtime_content_parts_impl(content: Any) -> list[Any]:
    _core_coverage_mark("_openai_realtime_content_parts_impl")
    parts = []
    is_list = _core_type_is(content, "list")
    if is_list:
        for part in content:
            type = _core_get(part, "type", "text")
            is_audio = _core_eq(type, "audio")
            if is_audio:
                audio_part = {}
                audio_part["type"] = "input_audio"
                input_audio = {}
                data = _core_get(part, "data", "")
                input_audio["data"] = data
                format = _core_get(part, "format", "pcm16")
                input_audio["format"] = format
                audio_part["input_audio"] = input_audio
                parts.append(audio_part)
            else:
                text_part = {}
                text_part["type"] = "input_text"
                text = _core_get(part, "text", "")
                text_part["text"] = text
                parts.append(text_part)
    else:
        part = {}
        part["type"] = "input_text"
        part["text"] = content
        parts.append(part)
    return parts


def _provider_model_matches(match: Any, model: str) -> bool:
    _core_coverage_mark("_provider_model_matches")
    empty_values = []
    exact = _core_get(match, "exact", empty_values)
    exact_match = _core_contains(exact, model)
    if exact_match:
        return True
    else:
        pass
    prefixes = _core_get(match, "prefix", empty_values)
    for prefix in prefixes:
        prefix_match = _core_string_starts_with(model, prefix)
        if prefix_match:
            return True
        else:
            pass
    contains_values = _core_get(match, "contains", empty_values)
    model_lower = _core_string_lower(model)
    for part in contains_values:
        part_lower = _core_string_lower(part)
        contains_match = _core_contains(model_lower, part_lower)
        if contains_match:
            return True
        else:
            pass
    return False


def _provider_resolve_model_rule(profile: str, model: str) -> Any:
    _core_coverage_mark("_provider_resolve_model_rule")
    descriptor = provider_descriptor(profile)
    empty_rules = []
    rules = _core_get(descriptor, "modelRules", empty_rules)
    for rule in rules:
        empty_match = {}
        match = _core_get(rule, "match", empty_match)
        matched = _provider_model_matches(match, model)
        if matched:
            return rule
        else:
            pass
    empty = {}
    return empty


def provider_resolve_features(profile: str, model: str, options: Any) -> Any:
    _core_coverage_mark("provider_resolve_features")
    descriptor = provider_descriptor(profile)
    empty_map = {}
    base_features = _core_get(descriptor, "features", empty_map)
    features = _core_map_merge(empty_map, base_features)
    rule = _provider_resolve_model_rule(profile, model)
    capabilities = _core_get(rule, "capabilities", empty_map)
    capability_keys = _core_map_keys(capabilities)
    for key in capability_keys:
        value = _core_get(capabilities, key, None)
        is_structured_outputs = _core_eq(key, "structuredOutputs")
        is_structured_modes = _core_eq(key, "structuredOutputModes")
        is_multi_turn = _core_eq(key, "multiTurn")
        is_thinking_budget = _core_eq(key, "thinkingBudget")
        is_show_thoughts = _core_eq(key, "showThoughts")
        if is_structured_outputs:
            features["structured_outputs"] = value
        else:
            if is_structured_modes:
                features["structured_output_modes"] = value
            else:
                if is_multi_turn:
                    features["multi_turn"] = value
                else:
                    if is_thinking_budget:
                        features["has_thinking_budget"] = value
                    else:
                        if is_show_thoughts:
                            features["has_show_thoughts"] = value
                        else:
                            features[key] = value
    model_info_snake = _core_get(options, "model_info", None)
    empty_list = []
    model_info = _core_get(options, "modelInfo", model_info_snake)
    model_info_missing = _core_is_none(model_info)
    if model_info_missing:
        model_info = empty_list
    else:
        pass
    for item in model_info:
        item_name = _core_get(item, "name", "")
        matches_name = _core_eq(item_name, model)
        matches_alias = False
        aliases = _core_get(item, "aliases", empty_list)
        for alias in aliases:
            alias_match = _core_eq(alias, model)
            if alias_match:
                matches_alias = True
            else:
                pass
        matches = _core_or(matches_name, matches_alias)
        if matches:
            supported = _core_get(item, "supported", empty_map)
            override_modes_snake = _core_get(supported, "structured_output_modes", None)
            override_modes = _core_get(supported, "structuredOutputModes", override_modes_snake)
            has_override_modes = _core_is_not_none(override_modes)
            if has_override_modes:
                features["structured_output_modes"] = override_modes
                has_native = False
                for override_mode in override_modes:
                    override_native = _core_eq(override_mode, "native")
                    if override_native:
                        has_native = True
                    else:
                        pass
                features["structured_outputs"] = has_native
            else:
                pass
            override_native_snake = _core_get(supported, "structured_outputs", None)
            override_native = _core_get(supported, "structuredOutputs", override_native_snake)
            has_override_native = _core_is_not_none(override_native)
            no_override_modes = _core_not(has_override_modes)
            apply_native_override = _core_and(has_override_native, no_override_modes)
            if apply_native_override:
                features["structured_outputs"] = override_native
                current_modes = _core_get(features, "structured_output_modes", empty_list)
                modes_without_native = []
                for current_mode in current_modes:
                    current_is_native = _core_eq(current_mode, "native")
                    current_is_not_native = _core_not(current_is_native)
                    if current_is_not_native:
                        modes_without_native.append(current_mode)
                    else:
                        pass
                if override_native:
                    modes_with_native = []
                    modes_with_native.append("native")
                    for non_native_mode in modes_without_native:
                        modes_with_native.append(non_native_mode)
                    features["structured_output_modes"] = modes_with_native
                else:
                    features["structured_output_modes"] = modes_without_native
            else:
                pass
            thinking_budget_snake = _core_get(supported, "thinking_budget", None)
            thinking_budget = _core_get(supported, "thinkingBudget", thinking_budget_snake)
            has_thinking_budget = _core_is_not_none(thinking_budget)
            if has_thinking_budget:
                features["has_thinking_budget"] = thinking_budget
            else:
                pass
            show_thoughts_snake = _core_get(supported, "show_thoughts", None)
            show_thoughts = _core_get(supported, "showThoughts", show_thoughts_snake)
            has_show_thoughts = _core_is_not_none(show_thoughts)
            if has_show_thoughts:
                features["has_show_thoughts"] = show_thoughts
            else:
                pass
            has_thinking_override = _core_or(has_thinking_budget, has_show_thoughts)
            if has_thinking_override:
                thinking_budget_enabled = _core_get(features, "has_thinking_budget", False)
                show_thoughts_enabled = _core_get(features, "has_show_thoughts", False)
                thinking_enabled = _core_or(thinking_budget_enabled, show_thoughts_enabled)
                features["thinking"] = thinking_enabled
            else:
                pass
            service_tiers_snake = _core_get(supported, "service_tiers", None)
            service_tiers = _core_get(supported, "serviceTiers", service_tiers_snake)
            has_service_tiers = _core_is_not_none(service_tiers)
            if has_service_tiers:
                features["service_tiers"] = service_tiers
            else:
                pass
        else:
            pass
    return features


def _provider_reasoning_field(profile: str, model: str) -> str:
    _core_coverage_mark("_provider_reasoning_field")
    rule = _provider_resolve_model_rule(profile, model)
    empty_response = {}
    response = _core_get(rule, "response", empty_response)
    empty_fields = []
    fields = _core_get(response, "reasoningFields", empty_fields)
    field = _core_list_get(fields, 0, "none")
    return field


def _provider_reasoning_details_field(profile: str, model: str) -> str:
    _core_coverage_mark("_provider_reasoning_details_field")
    rule = _provider_resolve_model_rule(profile, model)
    empty_response = {}
    response = _core_get(rule, "response", empty_response)
    empty_fields = []
    fields = _core_get(response, "reasoningDetailsFields", empty_fields)
    field = _core_list_get(fields, 0, "none")
    return field


def _provider_reasoning_replay_field(profile: str, model: str) -> str:
    _core_coverage_mark("_provider_reasoning_replay_field")
    rule = _provider_resolve_model_rule(profile, model)
    empty_replay = {}
    replay = _core_get(rule, "replay", empty_replay)
    response_field = _provider_reasoning_field(profile, model)
    field = _core_get(replay, "assistantReasoningField", response_field)
    return field


def _provider_reasoning_details_replay_field(profile: str, model: str) -> str:
    _core_coverage_mark("_provider_reasoning_details_replay_field")
    rule = _provider_resolve_model_rule(profile, model)
    empty_replay = {}
    replay = _core_get(rule, "replay", empty_replay)
    response_field = _provider_reasoning_details_field(profile, model)
    field = _core_get(replay, "assistantReasoningDetailsField", response_field)
    return field


def _provider_apply_request_rules(payload: Any, request: Any, rules: Any) -> Any:
    _core_coverage_mark("_provider_apply_request_rules")
    empty_map = {}
    empty_list = []
    model_config = _core_get(request, "model_config", empty_map)
    budget_snake = _core_get(model_config, "thinking_token_budget", None)
    budget = _core_get(model_config, "thinkingTokenBudget", budget_snake)
    payload_effort = _core_get(payload, "reasoning_effort", None)
    configured_effort = _core_coalesce(budget, payload_effort)
    default_thinking_level = _core_get(rules, "defaultThinkingLevel", None)
    requested_effort = _core_coalesce(configured_effort, default_thinking_level)
    unsupported_thinking_levels = _core_get(rules, "unsupportedThinkingLevels", empty_map)
    unsupported_thinking_level = _core_map_contains(unsupported_thinking_levels, requested_effort)
    if unsupported_thinking_level:
        unsupported_thinking_message = _core_get(unsupported_thinking_levels, requested_effort, None)
        unsupported_thinking_error = _core_ai_error_unsupported(unsupported_thinking_message)
        raise unsupported_thinking_error
    else:
        pass
    effort_map = _core_get(rules, "effortMap", empty_map)
    has_requested_effort = _core_is_not_none(requested_effort)
    has_effort_mapping = _core_map_contains(effort_map, requested_effort)
    mapped_effort = _core_get(effort_map, requested_effort, None)
    effective_effort = requested_effort
    if has_effort_mapping:
        effective_effort = mapped_effort
        mapped_is_none = _core_is_none(mapped_effort)
        if mapped_is_none:
            _core_map_delete(payload, "reasoning_effort")
        else:
            payload["reasoning_effort"] = mapped_effort
    else:
        pass
    effective_is_none_value = _core_eq(effective_effort, "none")
    effective_is_missing = _core_is_none(effective_effort)
    effective_is_present = _core_not(effective_is_missing)
    effective_disabled = _core_or(effective_is_none_value, effective_is_missing)
    effective_enabled = _core_not(effective_disabled)
    has_reasoning = _core_and(has_requested_effort, effective_enabled)
    has_serializable_reasoning_effort = _core_and(has_requested_effort, effective_is_present)
    thinking_boolean = _core_get(rules, "thinkingBoolean", empty_map)
    thinking_boolean_path = _core_get(thinking_boolean, "path", empty_list)
    has_thinking_boolean = _core_truthy(thinking_boolean_path)
    if has_thinking_boolean:
        thinking_object_name = _core_list_get(thinking_boolean_path, 0, "")
        thinking_field_name = _core_list_get(thinking_boolean_path, 1, "")
        thinking_nested = _core_get(payload, thinking_object_name, empty_map)
        thinking_nested_copy = _core_map_merge(empty_map, thinking_nested)
        thinking_nested_copy[thinking_field_name] = effective_enabled
        payload[thinking_object_name] = thinking_nested_copy
    else:
        pass
    reasoning_mode = _core_get(rules, "reasoning", "")
    is_thinking_object_mode = _core_eq(reasoning_mode, "thinking-object")
    if is_thinking_object_mode:
        thinking = {}
        if has_reasoning:
            thinking["type"] = "enabled"
        else:
            thinking["type"] = "disabled"
        payload["thinking"] = thinking
    else:
        pass
    is_openrouter_mode = _core_eq(reasoning_mode, "openrouter")
    if is_openrouter_mode:
        if has_serializable_reasoning_effort:
            reasoning = {}
            effort = _core_get(payload, "reasoning_effort", requested_effort)
            reasoning["effort"] = effort
            payload["reasoning"] = reasoning
        else:
            pass
        _core_map_delete(payload, "reasoning_effort")
    else:
        pass
    tool_choice_mode = _core_get(rules, "toolChoice", "")
    unforced = _core_eq(tool_choice_mode, "unforced")
    if unforced:
        tool_choice = _core_get(payload, "tool_choice", None)
        choice_none = _core_eq(tool_choice, "none")
        if choice_none:
            _core_map_delete(payload, "tools")
        else:
            pass
        choice_required = _core_eq(tool_choice, "required")
        choice_is_object = _core_type_is(tool_choice, "object")
        ax_generated = False
        if choice_is_object:
            choice_function = _core_get(tool_choice, "function", empty_map)
            choice_name = _core_get(choice_function, "name", "")
            ax_generated = _core_eq(choice_name, "__axOutput")
        else:
            pass
        not_ax_generated = _core_not(ax_generated)
        object_not_ax = _core_and(choice_is_object, not_ax_generated)
        caller_forced = _core_or(choice_required, object_not_ax)
        if caller_forced:
            error = _core_ai_error_unsupported("deployment profile does not support explicitly forced tool choices")
            raise error
        else:
            pass
        _core_map_delete(payload, "tool_choice")
    else:
        pass
    drop_when_thinking = _core_get(rules, "dropWhenThinking", empty_list)
    if has_reasoning:
        for field in drop_when_thinking:
            _core_map_delete(payload, field)
    else:
        pass
    drop_fields = _core_get(rules, "dropFields", empty_list)
    for field in drop_fields:
        _core_map_delete(payload, field)
    copy_fields = _core_get(rules, "copyFields", empty_map)
    copy_keys = _core_map_keys(copy_fields)
    for source in copy_keys:
        has_source = _core_map_contains(payload, source)
        if has_source:
            target = _core_get(copy_fields, source, None)
            value = _core_get(payload, source, None)
            payload[target] = value
        else:
            pass
    rename_fields = _core_get(rules, "renameFields", empty_map)
    rename_keys = _core_map_keys(rename_fields)
    for source in rename_keys:
        has_source = _core_map_contains(payload, source)
        if has_source:
            target = _core_get(rename_fields, source, None)
            value = _core_get(payload, source, None)
            payload[target] = value
            _core_map_delete(payload, source)
        else:
            pass
    enum_maps = _core_get(rules, "enumMaps", empty_map)
    enum_fields = _core_map_keys(enum_maps)
    for field in enum_fields:
        field_map = _core_get(enum_maps, field, None)
        value = _core_get(payload, field, None)
        has_value = _core_is_not_none(value)
        has_mapping = _core_map_contains(field_map, value)
        should_map = _core_and(has_value, has_mapping)
        if should_map:
            mapped_value = _core_get(field_map, value, None)
            payload[field] = mapped_value
        else:
            pass
    construct_objects = _core_get(rules, "constructObjects", empty_map)
    object_targets = _core_map_keys(construct_objects)
    for target in object_targets:
        field_sources = _core_get(construct_objects, target, None)
        nested_fields = _core_map_keys(field_sources)
        nested = {}
        for nested_field in nested_fields:
            source = _core_get(field_sources, nested_field, None)
            has_source = _core_map_contains(payload, source)
            if has_source:
                value = _core_get(payload, source, None)
                nested[nested_field] = value
            else:
                pass
        has_nested = _core_truthy(nested)
        if has_nested:
            payload[target] = nested
        else:
            pass
    reasoning_object_fields = _core_get(rules, "reasoningObjectFields", empty_list)
    has_reasoning_object_fields = _core_truthy(reasoning_object_fields)
    if has_reasoning_object_fields:
        reasoning_object = _core_get(payload, "reasoning", None)
        reasoning_is_object = _core_type_is(reasoning_object, "object")
        if reasoning_is_object:
            filtered_reasoning = {}
            for field in reasoning_object_fields:
                has_field = _core_map_contains(reasoning_object, field)
                if has_field:
                    value = _core_get(reasoning_object, field, None)
                    filtered_reasoning[field] = value
                else:
                    pass
            payload["reasoning"] = filtered_reasoning
        else:
            pass
    else:
        pass
    image_shape = _core_get(rules, "imageURLShape", "")
    image_object = _core_eq(image_shape, "object")
    if image_object:
        payload = _provider_apply_image_url_object_shape(payload)
    else:
        pass
    option_dialect = _core_get(rules, "optionDialect", "")
    search_parameters = _core_eq(option_dialect, "search-parameters")
    if search_parameters:
        payload = _provider_apply_search_parameters_option(payload, request, model_config)
    else:
        pass
    return payload


def _provider_apply_service_tier(profile: str, payload: Any, request: Any, options: Any, features: Any, profile_rules: Any, model_rules: Any) -> Any:
    _core_coverage_mark("_provider_apply_service_tier")
    empty_map = {}
    empty_list = []
    model_config_snake = _core_get(request, "model_config", empty_map)
    model_config = _core_get(request, "modelConfig", model_config_snake)
    payload_tier = _core_get(payload, "service_tier", None)
    model_tier_snake = _core_get(model_config, "service_tier", None)
    model_tier = _core_get(model_config, "serviceTier", model_tier_snake)
    option_tier_snake = _core_get(options, "service_tier", None)
    option_tier = _core_get(options, "serviceTier", option_tier_snake)
    configured_tier = _core_coalesce(model_tier, payload_tier)
    requested_tier = _core_coalesce(option_tier, configured_tier)
    _core_map_delete(payload, "service_tier")
    has_tier = _core_is_not_none(requested_tier)
    if has_tier:
        pass
    else:
        return payload
    normalized_tier = requested_tier
    is_default = _core_eq(requested_tier, "default")
    is_on_demand = _core_eq(requested_tier, "on_demand")
    is_standard_only = _core_eq(requested_tier, "standard_only")
    default_or_on_demand = _core_or(is_default, is_on_demand)
    is_standard_alias = _core_or(default_or_on_demand, is_standard_only)
    if is_standard_alias:
        normalized_tier = "standard"
    else:
        pass
    is_performance = _core_eq(requested_tier, "performance")
    if is_performance:
        normalized_tier = "priority"
    else:
        pass
    is_auto = _core_eq(normalized_tier, "auto")
    supported_tiers = _core_get(features, "service_tiers", empty_list)
    is_supported = False
    for supported_tier in supported_tiers:
        tier_matches = _core_eq(supported_tier, normalized_tier)
        if tier_matches:
            is_supported = True
        else:
            pass
    valid_tier = _core_or(is_auto, is_supported)
    invalid_tier = _core_not(valid_tier)
    if invalid_tier:
        model = _core_get(request, "model", "")
        message = _core_string_format("service tier {} is not verified for profile {} model {}", normalized_tier, profile, model)
        error = _core_ai_error_unsupported(message)
        raise error
    else:
        pass
    profile_map = _core_get(profile_rules, "serviceTierMap", empty_map)
    model_map = _core_get(model_rules, "serviceTierMap", empty_map)
    mapping = profile_map
    model_has_mapping = _core_map_contains(model_map, normalized_tier)
    if model_has_mapping:
        mapping = model_map
    else:
        pass
    has_mapping = _core_map_contains(mapping, normalized_tier)
    mapped_tier = normalized_tier
    if has_mapping:
        mapped_tier = _core_get(mapping, normalized_tier, None)
    else:
        if is_auto:
            mapped_tier = _core_none()
        else:
            pass
    has_mapped_tier = _core_is_not_none(mapped_tier)
    if has_mapped_tier:
        payload["service_tier"] = mapped_tier
    else:
        pass
    return payload


def provider_build_chat_request(profile: str, request: AxChatRequest, options: Any) -> Any:
    _core_coverage_mark("provider_build_chat_request")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_resolve_descriptor(provider_id, options)
    transport = _core_get(descriptor, "transport", "openai-chat")
    is_responses = _core_eq(transport, "openai-responses")
    is_gemini = _core_eq(transport, "gemini-generate-content")
    is_anthropic = _core_eq(transport, "anthropic-messages")
    model = _core_get(request, "model", "")
    reasoning_content_mode = _provider_reasoning_replay_field(provider_id, model)
    reasoning_details_mode = _provider_reasoning_details_replay_field(provider_id, model)
    payload = {}
    if is_responses:
        responses_payload = openai_responses_build_chat_request(request)
        payload = responses_payload
    else:
        if is_gemini:
            is_vertex = _core_get(descriptor, "vertex", False)
            gemini_payload = _gemini_build_chat_request(request, options, is_vertex)
            payload = gemini_payload
        else:
            if is_anthropic:
                anthropic_payload = _anthropic_build_chat_request(request)
                is_vertex = _core_get(descriptor, "vertex", False)
                if is_vertex:
                    _core_map_delete(anthropic_payload, "model")
                    anthropic_payload["anthropic_version"] = "vertex-2023-10-16"
                else:
                    pass
                payload = anthropic_payload
            else:
                is_official_openai = _core_eq(provider_id, "openai")
                compatible_payload = _openai_build_chat_request_impl(request, options, is_official_openai, reasoning_content_mode, reasoning_details_mode)
                payload = compatible_payload
    empty_rules = {}
    empty_list = []
    profile_rules = _core_get(descriptor, "request", empty_rules)
    payload = _provider_apply_request_rules(payload, request, profile_rules)
    model_rule = _provider_resolve_model_rule(provider_id, model)
    model_rules = _core_get(model_rule, "request", empty_rules)
    payload = _provider_apply_request_rules(payload, request, model_rules)
    features = provider_resolve_features(provider_id, model, options)
    payload = _provider_apply_service_tier(provider_id, payload, request, options, features, profile_rules, model_rules)
    response_format = _core_get(payload, "response_format", empty_rules)
    response_format_type = _core_get(response_format, "type", "")
    is_json_schema = _core_eq(response_format_type, "json_schema")
    if is_json_schema:
        native_support = _core_get(features, "structured_outputs", False)
        native_unsupported = _core_not(native_support)
        if native_unsupported:
            native_message = _core_string_format("native JSON Schema output is not supported by profile {} model {}", provider_id, model)
            native_error = _core_ai_error_unsupported(native_message)
            raise native_error
        else:
            pass
    else:
        pass
    is_json_object = _core_eq(response_format_type, "json_object")
    if is_json_object:
        structured_modes = _core_get(features, "structured_output_modes", empty_list)
        supports_json_object = False
        for structured_mode in structured_modes:
            mode_is_json_object = _core_eq(structured_mode, "json_object")
            if mode_is_json_object:
                supports_json_object = True
            else:
                pass
        json_object_unsupported = _core_not(supports_json_object)
        if json_object_unsupported:
            json_object_message = _core_string_format("JSON object output is not supported by profile {} model {}", provider_id, model)
            json_object_error = _core_ai_error_unsupported(json_object_message)
            raise json_object_error
        else:
            pass
    else:
        pass
    return payload


def _provider_apply_image_url_object_shape(payload: Any) -> Any:
    _core_coverage_mark("_provider_apply_image_url_object_shape")
    empty_list = []
    messages = _core_get(payload, "messages", empty_list)
    for message in messages:
        content = _core_get(message, "content", None)
        content_is_list = _core_type_is(content, "list")
        if content_is_list:
            for part in content:
                part_type = _core_get(part, "type", "")
                is_image_url = _core_eq(part_type, "image_url")
                if is_image_url:
                    empty_image = {}
                    image = _core_get(part, "image_url", empty_image)
                    url = _core_get(image, "url", None)
                    next_image = {}
                    next_image["url"] = url
                    part["image_url"] = next_image
                else:
                    pass
        else:
            pass
    return payload


def _provider_apply_search_parameters_option(payload: Any, request: Any, model_config: Any) -> Any:
    _core_coverage_mark("_provider_apply_search_parameters_option")
    empty_map = {}
    search_snake = _core_get(request, "search_parameters", None)
    search_camel = _core_get(request, "searchParameters", search_snake)
    search_config_snake = _core_get(model_config, "search_parameters", search_camel)
    search = _core_get(model_config, "searchParameters", search_config_snake)
    has_search = _core_is_not_none(search)
    if has_search:
        search_payload = {}
        mode = _core_get(search, "mode", None)
        return_citations = _core_get(search, "returnCitations", None)
        return_citations_snake = _core_get(search, "return_citations", return_citations)
        from_date = _core_get(search, "fromDate", None)
        from_date_snake = _core_get(search, "from_date", from_date)
        to_date = _core_get(search, "toDate", None)
        to_date_snake = _core_get(search, "to_date", to_date)
        max_results = _core_get(search, "maxSearchResults", None)
        max_results_snake = _core_get(search, "max_search_results", max_results)
        sources = _core_get(search, "sources", None)
        has_mode = _core_is_not_none(mode)
        if has_mode:
            search_payload["mode"] = mode
        else:
            pass
        has_return_citations = _core_is_not_none(return_citations_snake)
        if has_return_citations:
            search_payload["return_citations"] = return_citations_snake
        else:
            pass
        has_from_date = _core_is_not_none(from_date_snake)
        if has_from_date:
            search_payload["from_date"] = from_date_snake
        else:
            pass
        has_to_date = _core_is_not_none(to_date_snake)
        if has_to_date:
            search_payload["to_date"] = to_date_snake
        else:
            pass
        has_max_results = _core_is_not_none(max_results_snake)
        if has_max_results:
            search_payload["max_search_results"] = max_results_snake
        else:
            pass
        if sources:
            mapped_sources = []
            for source in sources:
                mapped_source = {}
                source_type = _core_get(source, "type", None)
                source_country = _core_get(source, "country", None)
                excluded_websites_camel = _core_get(source, "excludedWebsites", None)
                excluded_websites = _core_get(source, "excluded_websites", excluded_websites_camel)
                allowed_websites_camel = _core_get(source, "allowedWebsites", None)
                allowed_websites = _core_get(source, "allowed_websites", allowed_websites_camel)
                safe_search_camel = _core_get(source, "safeSearch", None)
                safe_search = _core_get(source, "safe_search", safe_search_camel)
                x_handles_camel = _core_get(source, "xHandles", None)
                x_handles = _core_get(source, "x_handles", x_handles_camel)
                links = _core_get(source, "links", None)
                has_source_type = _core_is_not_none(source_type)
                if has_source_type:
                    mapped_source["type"] = source_type
                else:
                    pass
                has_source_country = _core_is_not_none(source_country)
                if has_source_country:
                    mapped_source["country"] = source_country
                else:
                    pass
                has_excluded_websites = _core_is_not_none(excluded_websites)
                if has_excluded_websites:
                    mapped_source["excluded_websites"] = excluded_websites
                else:
                    pass
                has_allowed_websites = _core_is_not_none(allowed_websites)
                if has_allowed_websites:
                    mapped_source["allowed_websites"] = allowed_websites
                else:
                    pass
                has_safe_search = _core_is_not_none(safe_search)
                if has_safe_search:
                    mapped_source["safe_search"] = safe_search
                else:
                    pass
                has_x_handles = _core_is_not_none(x_handles)
                if has_x_handles:
                    mapped_source["x_handles"] = x_handles
                else:
                    pass
                has_links = _core_is_not_none(links)
                if has_links:
                    mapped_source["links"] = links
                else:
                    pass
                mapped_sources.append(mapped_source)
            search_payload["sources"] = mapped_sources
        else:
            pass
        payload["search_parameters"] = search_payload
    else:
        pass
    return payload


def provider_build_embed_request(profile: str, request: AxEmbedRequest, options: Any) -> Any:
    _core_coverage_mark("provider_build_embed_request")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_resolve_descriptor(provider_id, options)
    transport = _core_get(descriptor, "transport", "openai-chat")
    is_gemini = _core_eq(transport, "gemini-generate-content")
    is_anthropic = _core_eq(transport, "anthropic-messages")
    payload = {}
    if is_gemini:
        is_vertex = _core_get(descriptor, "vertex", False)
        gemini_payload = {}
        if is_vertex:
            vertex_payload = _gemini_build_vertex_embed_request(request, options)
            gemini_payload = vertex_payload
        else:
            developer_payload = _gemini_build_embed_request(request)
            gemini_payload = developer_payload
        payload = gemini_payload
    else:
        if is_anthropic:
            error = _core_ai_error_unsupported("embed is not supported by Anthropic provider")
            raise error
        else:
            openai_payload = openai_build_embed_request(request)
            payload = openai_payload
    return payload


def provider_normalize_chat_response(profile: str, raw: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("provider_normalize_chat_response")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_descriptor(provider_id)
    transport = _core_get(descriptor, "transport", "openai-chat")
    is_responses = _core_eq(transport, "openai-responses")
    is_gemini = _core_eq(transport, "gemini-generate-content")
    is_anthropic = _core_eq(transport, "anthropic-messages")
    reasoning_content_mode = _provider_reasoning_field(provider_id, model)
    reasoning_details_mode = _provider_reasoning_details_field(provider_id, model)
    response = {}
    if is_responses:
        responses_response = openai_responses_normalize_chat_response(raw, ai_name, model)
        response = responses_response
    else:
        if is_gemini:
            gemini_response = _gemini_normalize_chat_response(raw, ai_name, model)
            response = gemini_response
        else:
            if is_anthropic:
                anthropic_response = _anthropic_normalize_chat_response(raw, ai_name, model)
                response = anthropic_response
            else:
                compatible_response = _openai_normalize_chat_response_impl(raw, ai_name, model, reasoning_content_mode, reasoning_details_mode)
                response = compatible_response
    return response


def provider_normalize_stream_delta(profile: str, raw: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("provider_normalize_stream_delta")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_descriptor(provider_id)
    transport = _core_get(descriptor, "transport", "openai-chat")
    is_responses = _core_eq(transport, "openai-responses")
    is_gemini = _core_eq(transport, "gemini-generate-content")
    is_anthropic = _core_eq(transport, "anthropic-messages")
    reasoning_content_mode = _provider_reasoning_field(provider_id, model)
    reasoning_details_mode = _provider_reasoning_details_field(provider_id, model)
    response = {}
    if is_responses:
        responses_response = openai_responses_normalize_stream_delta(raw, state, ai_name, model)
        response = responses_response
    else:
        if is_gemini:
            gemini_response = _gemini_normalize_chat_response(raw, ai_name, model)
            response = gemini_response
        else:
            if is_anthropic:
                anthropic_response = _anthropic_normalize_stream_delta(raw, state, ai_name, model)
                response = anthropic_response
            else:
                compatible_response = _openai_normalize_stream_delta_impl(raw, state, ai_name, model, reasoning_content_mode, reasoning_details_mode)
                response = compatible_response
    return response


def provider_classify_stream_error_status(profile: str, event: Any) -> Any:
    _core_coverage_mark("provider_classify_stream_error_status")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_descriptor(provider_id)
    transport = _core_get(descriptor, "transport", "openai-chat")
    none = _core_none()
    status = none
    is_anthropic = _core_eq(transport, "anthropic-messages")
    if is_anthropic:
        event_is_object = _core_type_is(event, "object")
        if event_is_object:
            type = _core_get(event, "type", "")
            is_error = _core_eq(type, "error")
            if is_error:
                error_body = _core_get(event, "error", None)
                error_type = _core_get(error_body, "type", "")
                mapped = _anthropic_error_type_to_status(error_type)
                status = mapped
            else:
                pass
        else:
            pass
    else:
        pass
    return status


def is_retryable_status(status: int) -> bool:
    _core_coverage_mark("is_retryable_status")
    is_408 = _core_eq(status, 408)
    is_429 = _core_eq(status, 429)
    is_500 = _core_eq(status, 500)
    is_502 = _core_eq(status, 502)
    is_503 = _core_eq(status, 503)
    is_504 = _core_eq(status, 504)
    is_529 = _core_eq(status, 529)
    r1 = _core_or(is_408, is_429)
    r2 = _core_or(is_500, is_502)
    r3 = _core_or(is_503, is_504)
    r4 = _core_or(r1, r2)
    r5 = _core_or(r3, is_529)
    retryable = _core_or(r4, r5)
    return retryable


def default_retry_config() -> Any:
    _core_coverage_mark("default_retry_config")
    config = {}
    config["max_retries"] = 3
    config["initial_delay_ms"] = 1000
    config["max_delay_ms"] = 60000
    config["backoff_factor"] = 2
    return config


def retry_opt_value(map: Any, camel: str, snake: str, fallback: Any) -> Any:
    _core_coverage_mark("retry_opt_value")
    camel_val = _core_get(map, camel, None)
    has_camel = _core_is_not_none(camel_val)
    if has_camel:
        return camel_val
    else:
        pass
    snake_val = _core_get(map, snake, None)
    has_snake = _core_is_not_none(snake_val)
    if has_snake:
        return snake_val
    else:
        pass
    return fallback


def resolve_stream_retry(options: Any) -> Any:
    _core_coverage_mark("resolve_stream_retry")
    cfg = default_retry_config()
    def_max = _core_get(cfg, "max_retries", None)
    def_initial = _core_get(cfg, "initial_delay_ms", None)
    def_max_delay = _core_get(cfg, "max_delay_ms", None)
    def_backoff = _core_get(cfg, "backoff_factor", None)
    retry = _core_get(options, "retry", None)
    max_retries = retry_opt_value(retry, "maxRetries", "max_retries", def_max)
    initial = retry_opt_value(retry, "initialDelayMs", "initial_delay_ms", def_initial)
    max_delay = retry_opt_value(retry, "maxDelayMs", "max_delay_ms", def_max_delay)
    backoff = retry_opt_value(retry, "backoffFactor", "backoff_factor", def_backoff)
    out = {}
    out["max_retries"] = max_retries
    out["initial_delay_ms"] = initial
    out["max_delay_ms"] = max_delay
    out["backoff_factor"] = backoff
    return out


def provider_normalize_embed_response(profile: str, raw: Any, ai_name: str, model: str) -> AxEmbedResponse:
    _core_coverage_mark("provider_normalize_embed_response")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_descriptor(provider_id)
    transport = _core_get(descriptor, "transport", "openai-chat")
    is_gemini = _core_eq(transport, "gemini-generate-content")
    response = {}
    if is_gemini:
        gemini_response = _gemini_normalize_embed_response(raw, ai_name, model)
        response = gemini_response
    else:
        openai_response = openai_normalize_embed_response(raw, ai_name, model)
        response = openai_response
    return response


def provider_build_transcribe_request(profile: str, request: Any) -> Any:
    _core_coverage_mark("provider_build_transcribe_request")
    provider_id = provider_normalize_profile(profile)
    operation = provider_operation_descriptor(provider_id, "transcribe")
    dialect = _core_get(operation, "dialect", "openai-transcription")
    is_gemini = _core_eq(dialect, "gemini-generate-content")
    is_xai = _core_eq(dialect, "xai-transcription")
    payload = {}
    if is_gemini:
        gemini_payload = _gemini_build_transcribe_request(request)
        payload = gemini_payload
    else:
        if is_xai:
            xai_payload = _grok_build_transcribe_request(request)
            payload = xai_payload
        else:
            responses_payload = openai_responses_build_transcribe_request(request)
            payload = responses_payload
    return payload


def provider_build_speak_request(profile: str, request: Any) -> Any:
    _core_coverage_mark("provider_build_speak_request")
    provider_id = provider_normalize_profile(profile)
    operation = provider_operation_descriptor(provider_id, "speak")
    dialect = _core_get(operation, "dialect", "openai-speech")
    is_gemini = _core_eq(dialect, "gemini-generate-content")
    is_xai = _core_eq(dialect, "xai-speech")
    payload = {}
    if is_gemini:
        gemini_payload = _gemini_build_speak_request(request)
        payload = gemini_payload
    else:
        if is_xai:
            xai_payload = _grok_build_speak_request(request)
            payload = xai_payload
        else:
            responses_payload = openai_responses_build_speak_request(request)
            payload = responses_payload
    return payload


def provider_normalize_transcribe_response(profile: str, raw: Any) -> Any:
    _core_coverage_mark("provider_normalize_transcribe_response")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_descriptor(provider_id)
    operations = _core_get(descriptor, "operations", None)
    operation = _core_get(operations, "transcribe", None)
    dialect = _core_get(operation, "dialect", "openai-transcription")
    is_gemini = _core_eq(dialect, "gemini-generate-content")
    if is_gemini:
        gemini_out = _gemini_normalize_transcribe_response(raw)
        return gemini_out
    else:
        pass
    text = _core_get(raw, "text", "")
    out = {}
    out["text"] = text
    language = _core_get(raw, "language", None)
    has_language = _core_is_not_none(language)
    if has_language:
        out["language"] = language
    else:
        pass
    duration = _core_get(raw, "duration", None)
    has_duration = _core_is_not_none(duration)
    if has_duration:
        out["duration"] = duration
    else:
        pass
    return out


def provider_normalize_speak_response(profile: str, raw: Any, request: Any) -> Any:
    _core_coverage_mark("provider_normalize_speak_response")
    provider_id = provider_normalize_profile(profile)
    descriptor = provider_descriptor(provider_id)
    operations = _core_get(descriptor, "operations", None)
    operation = _core_get(operations, "speak", None)
    dialect = _core_get(operation, "dialect", "openai-speech")
    is_gemini = _core_eq(dialect, "gemini-generate-content")
    if is_gemini:
        gemini_out = _gemini_normalize_speak_response(raw, request)
        return gemini_out
    else:
        pass
    data = _core_get(raw, "audio", raw)
    format = _core_get(request, "format", "mp3")
    out = {}
    out["audio"] = data
    out["format"] = format
    return out


def provider_normalize_realtime_event(profile: str, event: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("provider_normalize_realtime_event")
    provider_id = provider_normalize_profile(profile)
    descriptor = _provider_realtime_audio_descriptor(provider_id)
    grammar = _core_get(descriptor, "grammar", "openai_realtime_compatible")
    is_gemini_live = _core_eq(grammar, "gemini_live_bidi")
    if is_gemini_live:
        gemini_response = _gemini_live_bidi_normalize_realtime_event(event, state, ai_name, model)
        return gemini_response
    else:
        pass
    response = openai_responses_normalize_realtime_event(event, state, ai_name, model)
    return response


def openai_responses_build_chat_request(request: AxChatRequest) -> Any:
    _core_coverage_mark("openai_responses_build_chat_request")
    payload = {}
    model = _core_get(request, "model", "gpt-4o")
    payload["model"] = model
    empty_prompt = []
    prompt = _core_get(request, "chat_prompt", empty_prompt)
    input = []
    instructions = _core_none()
    for message in prompt:
        role = _core_get(message, "role", None)
        is_system = _core_eq(role, "system")
        if is_system:
            system_content = _core_get(message, "content", "")
            instructions = system_content
        else:
            is_assistant = _core_eq(role, "assistant")
            if is_assistant:
                thought = _core_get(message, "thought", None)
                has_thought = _core_truthy(thought)
                if has_thought:
                    reasoning_item = {}
                    reasoning_item["type"] = "reasoning"
                    reasoning_item["content"] = thought
                    input.append(reasoning_item)
                else:
                    pass
                content = _core_get(message, "content", None)
                has_content = _core_truthy(content)
                if has_content:
                    item = _openai_responses_input_item_impl(message)
                    input.append(item)
                else:
                    pass
                empty_calls = []
                calls_snake = _core_get(message, "function_calls", empty_calls)
                calls = _core_get(message, "functionCalls", calls_snake)
                for call in calls:
                    function = _core_get(call, "function", None)
                    name = _core_get(function, "name", "")
                    params = _core_get(function, "params", "")
                    params_is_string = _core_type_is(params, "string")
                    if params_is_string:
                        pass
                    else:
                        params_json = _core_json_stringify(params)
                        params = params_json
                    function_call = {}
                    function_call["type"] = "function_call"
                    call_id = _core_get(call, "id", name)
                    function_call["call_id"] = call_id
                    function_call["name"] = name
                    function_call["arguments"] = params
                    input.append(function_call)
            else:
                item = _openai_responses_input_item_impl(message)
                input.append(item)
    has_instructions = _core_is_not_none(instructions)
    if has_instructions:
        payload["instructions"] = instructions
    else:
        pass
    payload["input"] = input
    empty_functions = []
    functions = _core_get(request, "functions", empty_functions)
    has_functions = _core_truthy(functions)
    if has_functions:
        tools = []
        for fn in functions:
            tool = _openai_responses_tool_spec_impl(fn)
            tools.append(tool)
        payload["tools"] = tools
        function_call = _core_get(request, "function_call", "auto")
        tool_choice = _openai_responses_tool_choice_impl(function_call)
        has_tool_choice = _core_is_not_none(tool_choice)
        if has_tool_choice:
            payload["tool_choice"] = tool_choice
        else:
            pass
    else:
        pass
    response_format = _core_get(request, "response_format", None)
    has_response_format = _core_truthy(response_format)
    if has_response_format:
        format_type = _core_get(response_format, "type", "text")
        is_json_schema = _core_eq(format_type, "json_schema")
        format = {}
        if is_json_schema:
            schema = _core_get(response_format, "schema", None)
            format["type"] = "json_schema"
            format["json_schema"] = schema
        else:
            format["type"] = format_type
        text_config = {}
        text_config["format"] = format
        payload["text"] = text_config
    else:
        pass
    empty_model_config = {}
    model_config = _core_get(request, "model_config", empty_model_config)
    stream = _core_get(model_config, "stream", False)
    payload["stream"] = stream
    reasoning = _core_get(model_config, "reasoning", None)
    has_reasoning = _core_truthy(reasoning)
    if has_reasoning:
        payload["reasoning"] = reasoning
    else:
        pass
    _openai_responses_apply_model_config_impl(payload, model_config)
    include = _core_get(model_config, "include", None)
    has_include = _core_truthy(include)
    if has_include:
        payload["include"] = include
    else:
        pass
    parallel = _core_get(model_config, "parallel_tool_calls", None)
    has_parallel = _core_is_not_none(parallel)
    if has_parallel:
        payload["parallel_tool_calls"] = parallel
    else:
        pass
    return payload


def _openai_responses_apply_model_config_impl(payload: Any, model_config: Any) -> None:
    _core_coverage_mark("_openai_responses_apply_model_config_impl")
    _openai_copy_config_key_impl(payload, model_config, "maxTokens", "max_output_tokens")
    _openai_copy_config_key_impl(payload, model_config, "max_tokens", "max_output_tokens")
    _openai_copy_config_key_impl(payload, model_config, "temperature", "temperature")
    _openai_copy_config_key_impl(payload, model_config, "topP", "top_p")
    _openai_copy_config_key_impl(payload, model_config, "top_p", "top_p")
    _openai_copy_config_key_impl(payload, model_config, "presencePenalty", "presence_penalty")
    _openai_copy_config_key_impl(payload, model_config, "presence_penalty", "presence_penalty")
    _openai_copy_config_key_impl(payload, model_config, "frequencyPenalty", "frequency_penalty")
    _openai_copy_config_key_impl(payload, model_config, "frequency_penalty", "frequency_penalty")
    budget_snake = _core_get(model_config, "thinking_token_budget", None)
    budget = _core_get(model_config, "thinkingTokenBudget", budget_snake)
    has_budget = _core_is_not_none(budget)
    if has_budget:
        model = _core_get(payload, "model", "")
        effort = openai_reasoning_effort(model, budget)
        has_effort = _core_is_not_none(effort)
        if has_effort:
            empty_reasoning = {}
            reasoning = _core_get(payload, "reasoning", empty_reasoning)
            reasoning["effort"] = effort
            is_none = _core_eq(effort, "none")
            if is_none:
                _core_map_delete(reasoning, "summary")
            else:
                pass
            payload["reasoning"] = reasoning
        else:
            _core_map_delete(payload, "reasoning")
    else:
        pass
    return None


def _openai_responses_tool_spec_impl(fn: Any) -> Any:
    _core_coverage_mark("_openai_responses_tool_spec_impl")
    tool = {}
    name = _core_get(fn, "name", None)
    description = _core_get(fn, "description", "")
    empty_parameters = {}
    parameters = _core_get(fn, "parameters", empty_parameters)
    tool["type"] = "function"
    tool["name"] = name
    tool["description"] = description
    tool["parameters"] = parameters
    return tool


def _openai_responses_tool_choice_impl(function_call: Any) -> Any:
    _core_coverage_mark("_openai_responses_tool_choice_impl")
    is_none = _core_eq(function_call, "none")
    if is_none:
        return function_call
    else:
        pass
    is_auto = _core_eq(function_call, "auto")
    if is_auto:
        return function_call
    else:
        pass
    is_required = _core_eq(function_call, "required")
    if is_required:
        return function_call
    else:
        pass
    is_object = _core_type_is(function_call, "object")
    if is_object:
        type = _core_get(function_call, "type", "")
        is_function_choice = _core_eq(type, "function")
        if is_function_choice:
            function = _core_get(function_call, "function", None)
            function_is_object = _core_type_is(function, "object")
            if function_is_object:
                name = _core_get(function, "name", None)
                has_name = _core_truthy(name)
                if has_name:
                    choice = {}
                    choice["type"] = "function"
                    choice["name"] = name
                    return choice
                else:
                    pass
            else:
                pass
        else:
            pass
    else:
        pass
    none = _core_none()
    return none


def _openai_responses_input_item_impl(message: Any) -> Any:
    _core_coverage_mark("_openai_responses_input_item_impl")
    role = _core_get(message, "role", None)
    is_function = _core_eq(role, "function")
    if is_function:
        message_id = _core_get(message, "id", None)
        message_content = _core_get(message, "content", None)
        call_id_snake = _core_get(message, "function_call_id", None)
        call_id_camel = _core_get(message, "functionId", call_id_snake)
        call_id = _core_coalesce(call_id_camel, message_id)
        result = _core_get(message, "result", message_content)
        out = {}
        out["type"] = "function_call_output"
        out["call_id"] = call_id
        out["output"] = result
        return out
    else:
        pass
    content = _core_get(message, "content", "")
    parts = _openai_responses_content_parts_impl(content, role)
    out = {}
    out["role"] = role
    out["content"] = parts
    return out


def _openai_responses_content_parts_impl(content: Any, role: str) -> list[Any]:
    _core_coverage_mark("_openai_responses_content_parts_impl")
    is_list = _core_type_is(content, "list")
    parts = []
    if is_list:
        for part in content:
            mapped = _openai_responses_content_part_impl(part, role)
            parts.append(mapped)
    else:
        part_type = "input_text"
        is_assistant = _core_eq(role, "assistant")
        if is_assistant:
            part_type = "output_text"
        else:
            pass
        part = {}
        part["type"] = part_type
        part["text"] = content
        parts.append(part)
    return parts


def _openai_responses_content_part_impl(part: Any, role: str) -> Any:
    _core_coverage_mark("_openai_responses_content_part_impl")
    type = _core_get(part, "type", "text")
    is_assistant = _core_eq(role, "assistant")
    is_text = _core_eq(type, "text")
    if is_text:
        out = {}
        out_type = "input_text"
        if is_assistant:
            out_type = "output_text"
        else:
            pass
        out["type"] = out_type
        part_text = _core_get(part, "text", "")
        out["text"] = part_text
        return out
    else:
        pass
    is_image = _core_eq(type, "image")
    if is_image:
        mime_camel = _core_get(part, "mimeType", "image/png")
        mime = _core_get(part, "mime_type", mime_camel)
        part_data = _core_get(part, "data", None)
        data = _core_get(part, "image", part_data)
        url = _core_string_format("data:{};base64,{}", mime, data)
        details = _core_get(part, "details", "auto")
        out = {}
        out["type"] = "input_image"
        image_url = {}
        image_url["url"] = url
        image_url["details"] = details
        out["image_url"] = image_url
        return out
    else:
        pass
    is_audio = _core_eq(type, "audio")
    if is_audio:
        audio_alt = _core_get(part, "audio", None)
        data = _core_get(part, "data", audio_alt)
        format = _core_get(part, "format", "wav")
        out = {}
        out["type"] = "input_audio"
        input_audio = {}
        input_audio["data"] = data
        input_audio["format"] = format
        out["input_audio"] = input_audio
        return out
    else:
        pass
    message = _core_string_format("Unsupported Responses content part: {}", type)
    error = _core_ai_error_unsupported(message)
    raise error


def openai_responses_normalize_chat_response(raw: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("openai_responses_normalize_chat_response")
    empty_output = []
    output = _core_get(raw, "output", empty_output)
    result = {}
    result["index"] = 0
    result["id"] = "0"
    result["content"] = ""
    empty_function_calls = []
    result["function_calls"] = empty_function_calls
    result["finish_reason"] = "stop"
    for item in output:
        _openai_responses_merge_output_item_impl(result, item)
    results = []
    results.append(result)
    raw_model = _core_get(raw, "model", model)
    raw_usage = _core_get(raw, "usage", None)
    usage = _openai_usage_with_service_tier(raw, raw_usage)
    model_usage = _ai_model_usage_impl(ai_name, raw_model, usage)
    out = {}
    out["results"] = results
    raw_id = _core_get(raw, "id", None)
    out["remote_id"] = raw_id
    out["model_usage"] = model_usage
    return out


def _openai_responses_merge_output_item_impl(result: Any, item: Any) -> None:
    _core_coverage_mark("_openai_responses_merge_output_item_impl")
    type = _core_get(item, "type", None)
    is_message = _core_eq(type, "message")
    if is_message:
        item_id = _core_get(item, "id", "0")
        result["id"] = item_id
        empty_content = []
        item_content = _core_get(item, "content", empty_content)
        content = _openai_responses_content_to_text_impl(item_content)
        result["content"] = content
        citations = _openai_responses_extract_citations_impl(item_content)
        has_citations = _core_truthy(citations)
        if has_citations:
            result["citations"] = citations
        else:
            pass
    else:
        pass
    is_function = _core_eq(type, "function_call")
    if is_function:
        item_id = _core_get(item, "id", "0")
        result["id"] = item_id
        call = _openai_responses_function_call_impl(item)
        calls = []
        calls.append(call)
        result["function_calls"] = calls
        result["finish_reason"] = "function_call"
    else:
        pass
    is_reasoning = _core_eq(type, "reasoning")
    if is_reasoning:
        item_id = _core_get(item, "id", "0")
        result["id"] = item_id
        thought = _openai_responses_reasoning_text_impl(item)
        has_thought = _core_truthy(thought)
        if has_thought:
            result["thought"] = thought
            thought_blocks = []
            thought_block = {}
            thought_block["data"] = thought
            thought_block["encrypted"] = False
            encrypted = _core_get(item, "encrypted_content", None)
            has_encrypted = _core_truthy(encrypted)
            if has_encrypted:
                thought_block["data"] = encrypted
                thought_block["encrypted"] = True
            else:
                pass
            thought_blocks.append(thought_block)
            result["thought_blocks"] = thought_blocks
        else:
            pass
    else:
        pass
    return None


def _openai_responses_reasoning_text_impl(item: Any) -> str:
    _core_coverage_mark("_openai_responses_reasoning_text_impl")
    content = _core_get(item, "content", "")
    content_is_list = _core_type_is(content, "list")
    if content_is_list:
        parts = []
        for part in content:
            text = _core_get(part, "text", "")
            parts.append(text)
        joined = _core_string_join("", parts)
        has_joined = _core_truthy(joined)
        if has_joined:
            return joined
        else:
            pass
    else:
        has_content = _core_truthy(content)
        if has_content:
            return content
        else:
            pass
    encrypted = _core_get(item, "encrypted_content", None)
    has_encrypted = _core_truthy(encrypted)
    if has_encrypted:
        return encrypted
    else:
        pass
    empty_summary = []
    summary = _core_get(item, "summary", empty_summary)
    summary_parts = []
    for part in summary:
        text = _core_get(part, "text", "")
        summary_parts.append(text)
    summary_text = _core_string_join("\n", summary_parts)
    return summary_text


def _openai_responses_content_to_text_impl(content: list[Any]) -> str:
    _core_coverage_mark("_openai_responses_content_to_text_impl")
    parts = []
    for part in content:
        type = _core_get(part, "type", None)
        is_text = _core_eq(type, "output_text")
        if is_text:
            text = _core_get(part, "text", "")
            parts.append(text)
        else:
            pass
        is_refusal = _core_eq(type, "refusal")
        if is_refusal:
            text = _core_get(part, "refusal", "")
            parts.append(text)
        else:
            pass
    out = _core_string_join("", parts)
    return out


def _openai_responses_extract_citations_impl(content: list[Any]) -> list[Any]:
    _core_coverage_mark("_openai_responses_extract_citations_impl")
    out = []
    for part in content:
        empty_annotations = []
        annotations = _core_get(part, "annotations", empty_annotations)
        for annotation in annotations:
            url = _core_get(annotation, "url", None)
            has_url = _core_truthy(url)
            if has_url:
                title = _core_get(annotation, "title", None)
                citation = {}
                citation["url"] = url
                has_title = _core_is_not_none(title)
                if has_title:
                    citation["title"] = title
                else:
                    pass
                out.append(citation)
            else:
                pass
    return out


def _openai_responses_function_call_impl(item: Any) -> Any:
    _core_coverage_mark("_openai_responses_function_call_impl")
    empty_args = {}
    args = _core_get(item, "arguments", empty_args)
    args_is_string = _core_type_is(args, "string")
    if args_is_string:
        try:
            parsed = _core_json_parse(args)
            args = parsed
        except Exception as parse_error:
            pass
    else:
        pass
    function = {}
    item_name = _core_get(item, "name", None)
    function["name"] = item_name
    function["params"] = args
    call = {}
    item_id = _core_get(item, "id", None)
    call_id = _core_get(item, "call_id", item_id)
    call["id"] = call_id
    call["type"] = "function"
    call["function"] = function
    return call


def openai_responses_normalize_stream_delta(event: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("openai_responses_normalize_stream_delta")
    type = _core_get(event, "type", None)
    empty_response = {}
    event_response = _core_get(event, "response", empty_response)
    event_response_id = _core_get(event_response, "id", None)
    event_response_id_fallback = _core_get(event, "response_id", event_response_id)
    remote_id = _core_get(event, "id", event_response_id_fallback)
    has_remote = _core_truthy(remote_id)
    if has_remote:
        state["remote_id"] = remote_id
    else:
        pass
    stable_remote = _core_get(state, "remote_id", remote_id)
    result = {}
    result["index"] = 0
    event_item_id = _core_get(event, "item_id", "0")
    result["id"] = event_item_id
    result["content"] = ""
    empty_calls = []
    result["function_calls"] = empty_calls
    none_finish = _core_none()
    result["finish_reason"] = none_finish
    is_text_delta = _core_eq(type, "response.output_text.delta")
    if is_text_delta:
        text_delta = _core_get(event, "delta", "")
        result["content"] = text_delta
    else:
        pass
    is_reasoning_delta = _core_eq(type, "response.reasoning_text.delta")
    if is_reasoning_delta:
        reasoning_delta = _core_get(event, "delta", "")
        result["thought"] = reasoning_delta
        thought_blocks = []
        thought_block = {}
        thought_block["data"] = reasoning_delta
        thought_block["encrypted"] = False
        thought_blocks.append(thought_block)
        result["thought_blocks"] = thought_blocks
    else:
        pass
    is_reasoning_done = _core_eq(type, "response.reasoning_text.done")
    if is_reasoning_done:
        reasoning_text = _core_get(event, "text", "")
        result["thought"] = reasoning_text
        thought_blocks = []
        thought_block = {}
        thought_block["data"] = reasoning_text
        thought_block["encrypted"] = False
        thought_blocks.append(thought_block)
        result["thought_blocks"] = thought_blocks
    else:
        pass
    is_output_added = _core_eq(type, "response.output_item.added")
    if is_output_added:
        empty_item = {}
        item = _core_get(event, "item", empty_item)
        _openai_responses_merge_output_item_impl(result, item)
    else:
        pass
    is_args_delta = _core_eq(type, "response.function_call_arguments.delta")
    if is_args_delta:
        event_call_id = _core_get(event, "call_id", "0")
        call_id = _core_get(event, "item_id", event_call_id)
        event_name = _core_get(event, "name", None)
        event_delta = _core_get(event, "delta", "")
        function = {}
        function["name"] = event_name
        function["params"] = event_delta
        call = {}
        call["id"] = call_id
        call["type"] = "function"
        call["function"] = function
        calls = []
        calls.append(call)
        result["function_calls"] = calls
        result["finish_reason"] = "function_call"
    else:
        pass
    is_completed = _core_eq(type, "response.completed")
    usage = _core_none()
    if is_completed:
        raw_usage = _core_get(event_response, "usage", None)
        usage = _openai_usage_with_service_tier(event_response, raw_usage)
        result["finish_reason"] = "stop"
    else:
        pass
    results = []
    results.append(result)
    raw_model = _core_get(event_response, "model", model)
    model_usage = _ai_model_usage_impl(ai_name, raw_model, usage)
    out = {}
    out["results"] = results
    out["remote_id"] = stable_remote
    out["model_usage"] = model_usage
    return out


def openai_responses_build_transcribe_request(request: Any) -> Any:
    _core_coverage_mark("openai_responses_build_transcribe_request")
    payload = {}
    request_file = _core_get(request, "file", None)
    audio_file = _core_get(request, "audio", request_file)
    payload["file"] = audio_file
    transcribe_model = _core_get(request, "model", "whisper-1")
    payload["model"] = transcribe_model
    format = _core_get(request, "format", "json")
    payload["response_format"] = format
    language = _core_get(request, "language", None)
    has_language = _core_is_not_none(language)
    if has_language:
        payload["language"] = language
    else:
        pass
    return payload


def openai_responses_build_speak_request(request: Any) -> Any:
    _core_coverage_mark("openai_responses_build_speak_request")
    payload = {}
    speak_model = _core_get(request, "model", "tts-1")
    request_input = _core_get(request, "input", "")
    speak_input = _core_get(request, "text", request_input)
    voice = _core_get(request, "voice", "alloy")
    response_format = _core_get(request, "format", "mp3")
    payload["model"] = speak_model
    payload["input"] = speak_input
    payload["voice"] = voice
    payload["response_format"] = response_format
    return payload


def _grok_build_transcribe_request(request: Any) -> Any:
    _core_coverage_mark("_grok_build_transcribe_request")
    payload = {}
    request_file = _core_get(request, "file", None)
    audio_file = _core_get(request, "audio", request_file)
    payload["file"] = audio_file
    language = _core_get(request, "language", None)
    has_language = _core_is_not_none(language)
    if has_language:
        payload["language"] = language
    else:
        pass
    prompt = _core_get(request, "prompt", None)
    has_prompt = _core_is_not_none(prompt)
    if has_prompt:
        payload["keyterm"] = prompt
    else:
        pass
    payload["format"] = True
    return payload


def _grok_build_speak_request(request: Any) -> Any:
    _core_coverage_mark("_grok_build_speak_request")
    payload = {}
    request_input = _core_get(request, "input", "")
    text = _core_get(request, "text", request_input)
    voice = _core_get(request, "voice", "eve")
    voice_id = _core_get(voice, "id", voice)
    language = _core_get(request, "language", "auto")
    format = _core_get(request, "format", "mp3")
    is_pcm16 = _core_eq(format, "pcm16")
    is_raw = _core_eq(format, "raw")
    is_pcm_like = _core_or(is_pcm16, is_raw)
    codec = format
    if is_pcm_like:
        codec = "pcm"
    else:
        is_ulaw = _core_eq(format, "ulaw")
        if is_ulaw:
            codec = "mulaw"
        else:
            pass
    output_format = {}
    output_format["codec"] = codec
    sample_rate_alt = _core_get(request, "sample_rate", None)
    sample_rate = _core_get(request, "sampleRate", sample_rate_alt)
    has_sample_rate = _core_is_not_none(sample_rate)
    if has_sample_rate:
        output_format["sample_rate"] = sample_rate
    else:
        pass
    payload["text"] = text
    payload["voice_id"] = voice_id
    payload["language"] = language
    payload["output_format"] = output_format
    return payload


def _gemini_build_transcribe_request(request: Any) -> Any:
    _core_coverage_mark("_gemini_build_transcribe_request")
    payload = {}
    contents = []
    turn = {}
    turn["role"] = "user"
    parts = []
    request_file = _core_get(request, "file", None)
    audio = _core_get(request, "audio", request_file)
    mime_type_raw = _core_get(audio, "mimeType", None)
    mime_type = _core_get(audio, "mime_type", mime_type_raw)
    has_mime = _core_is_not_none(mime_type)
    if has_mime:
        pass
    else:
        mime_type = "audio/wav"
    data = _core_get(audio, "data", audio)
    inline_data = {}
    inline_data["mimeType"] = mime_type
    inline_data["data"] = data
    audio_part = {}
    audio_part["inlineData"] = inline_data
    parts.append(audio_part)
    prompt = _core_get(request, "prompt", "Generate a transcript of the speech in this audio.")
    text_part = {}
    text_part["text"] = prompt
    parts.append(text_part)
    turn["parts"] = parts
    contents.append(turn)
    payload["contents"] = contents
    return payload


def _gemini_build_speak_request(request: Any) -> Any:
    _core_coverage_mark("_gemini_build_speak_request")
    payload = {}
    contents = []
    turn = {}
    turn["role"] = "user"
    parts = []
    request_input = _core_get(request, "input", "")
    text = _core_get(request, "text", request_input)
    text_part = {}
    text_part["text"] = text
    parts.append(text_part)
    turn["parts"] = parts
    contents.append(turn)
    generation_config = {}
    modalities = []
    modalities.append("AUDIO")
    generation_config["responseModalities"] = modalities
    voice = _core_get(request, "voice", "Kore")
    voice_id = _core_get(voice, "id", voice)
    prebuilt = {}
    prebuilt["voiceName"] = voice_id
    voice_config = {}
    voice_config["prebuiltVoiceConfig"] = prebuilt
    speech_config = {}
    speech_config["voiceConfig"] = voice_config
    generation_config["speechConfig"] = speech_config
    payload["contents"] = contents
    payload["generationConfig"] = generation_config
    return payload


def _gemini_normalize_transcribe_response(raw: Any) -> Any:
    _core_coverage_mark("_gemini_normalize_transcribe_response")
    empty_candidates = []
    candidates = _core_get(raw, "candidates", empty_candidates)
    text_parts = []
    for candidate in candidates:
        content = _core_get(candidate, "content", None)
        empty_parts = []
        parts = _core_get(content, "parts", empty_parts)
        for part in parts:
            text = _core_get(part, "text", None)
            has_text = _core_is_not_none(text)
            if has_text:
                text_parts.append(text)
            else:
                pass
    text = _core_string_join("", text_parts)
    out = {}
    out["text"] = text
    return out


def _gemini_normalize_speak_response(raw: Any, request: Any) -> Any:
    _core_coverage_mark("_gemini_normalize_speak_response")
    audio = _core_get(raw, "audio", None)
    format = _core_get(request, "format", "wav")
    empty_candidates = []
    candidates = _core_get(raw, "candidates", empty_candidates)
    for candidate in candidates:
        content = _core_get(candidate, "content", None)
        empty_parts = []
        parts = _core_get(content, "parts", empty_parts)
        for part in parts:
            inline_data = _core_get(part, "inlineData", None)
            data = _core_get(inline_data, "data", None)
            has_data = _core_is_not_none(data)
            if has_data:
                audio = data
            else:
                pass
    has_audio = _core_is_not_none(audio)
    if has_audio:
        pass
    else:
        audio = raw
    out = {}
    out["audio"] = audio
    out["format"] = format
    return out


def openai_responses_normalize_realtime_event(event: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("openai_responses_normalize_realtime_event")
    type = _core_get(event, "type", None)
    is_error_event = _core_contains(type, "error")
    if is_error_event:
        empty_error_payload = {}
        error_payload = _core_get(event, "error", empty_error_payload)
        error_message = _core_get(error_payload, "message", "realtime audio provider error")
        error = _core_ai_error_response(error_message, event)
        raise error
    else:
        pass
    result = {}
    result["index"] = 0
    realtime_response_id = _core_get(event, "response_id", None)
    realtime_item_id = _core_get(event, "item_id", realtime_response_id)
    has_realtime_item_id = _core_is_not_none(realtime_item_id)
    if has_realtime_item_id:
        pass
    else:
        realtime_item_id = "0"
    result["id"] = realtime_item_id
    result["content"] = ""
    realtime_empty_calls = []
    result["function_calls"] = realtime_empty_calls
    realtime_none_finish = _core_none()
    result["finish_reason"] = realtime_none_finish
    is_text = _core_eq(type, "response.text.delta")
    is_output_text = _core_eq(type, "response.output_text.delta")
    is_any_text = _core_or(is_text, is_output_text)
    is_transcript = _core_eq(type, "conversation.item.input_audio_transcription.delta")
    is_output_transcript = _core_eq(type, "response.output_audio_transcript.delta")
    is_audio_transcript = _core_eq(type, "response.audio_transcript.delta")
    is_realtime_transcript = _core_or(is_transcript, is_output_transcript)
    is_realtime_transcript = _core_or(is_realtime_transcript, is_audio_transcript)
    is_audio = _core_eq(type, "response.audio.delta")
    is_output_audio = _core_eq(type, "response.output_audio.delta")
    is_any_audio = _core_or(is_audio, is_output_audio)
    if is_any_text:
        realtime_text_delta = _core_get(event, "delta", "")
        result["content"] = realtime_text_delta
    else:
        pass
    if is_realtime_transcript:
        realtime_transcript_delta = _core_get(event, "delta", "")
        result["content"] = realtime_transcript_delta
    else:
        pass
    if is_any_audio:
        audio_delta = _core_get(event, "delta", "")
        audio = {}
        audio["data"] = audio_delta
        audio["format"] = "pcm16"
        audio["is_delta"] = True
        result["audio"] = audio
    else:
        pass
    is_done = _core_string_ends_with(type, ".done")
    if is_done:
        result["finish_reason"] = "stop"
    else:
        pass
    realtime_empty_response = {}
    realtime_response = _core_get(event, "response", realtime_empty_response)
    event_usage = _core_get(event, "usage", None)
    usage = _core_get(realtime_response, "usage", event_usage)
    model_usage = _ai_model_usage_impl(ai_name, model, usage)
    results = []
    results.append(result)
    event_id = _core_get(event, "id", None)
    event_response_id = _core_get(event, "response_id", event_id)
    remote_id = _core_get(realtime_response, "id", event_response_id)
    out = {}
    out["results"] = results
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def _gemini_live_bidi_normalize_realtime_event(event: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("_gemini_live_bidi_normalize_realtime_event")
    error_payload = _core_get(event, "error", None)
    has_error = _core_is_not_none(error_payload)
    if has_error:
        error_message = _core_get(error_payload, "message", "Gemini Live realtime audio provider error")
        error = _core_ai_error_response(error_message, event)
        raise error
    else:
        pass
    result = {}
    result["index"] = 0
    result["id"] = "0"
    result["content"] = ""
    calls = []
    result["function_calls"] = calls
    none_finish = _core_none()
    result["finish_reason"] = none_finish
    text_parts = []
    function_calls = []
    empty_top_tool_call = {}
    top_tool_call = _core_get(event, "toolCall", empty_top_tool_call)
    empty_top_function_calls = []
    top_function_calls = _core_get(top_tool_call, "functionCalls", empty_top_function_calls)
    for top_function_call in top_function_calls:
        top_part = {}
        top_part["functionCall"] = top_function_call
        _gemini_merge_response_part_impl(result, text_parts, function_calls, top_part)
    empty_server = {}
    server = _core_get(event, "serverContent", empty_server)
    output_transcription = _core_get(server, "outputTranscription", None)
    has_output_transcription = _core_is_not_none(output_transcription)
    if has_output_transcription:
        transcript_text = _core_get(output_transcription, "text", "")
        text_parts.append(transcript_text)
    else:
        pass
    input_transcription = _core_get(server, "inputTranscription", None)
    has_input_transcription = _core_is_not_none(input_transcription)
    if has_input_transcription:
        input_text = _core_get(input_transcription, "text", "")
        text_parts.append(input_text)
    else:
        pass
    empty_model_turn = {}
    model_turn = _core_get(server, "modelTurn", empty_model_turn)
    empty_parts = []
    parts = _core_get(model_turn, "parts", empty_parts)
    for part in parts:
        inline_data = _core_get(part, "inlineData", None)
        has_inline_data = _core_is_not_none(inline_data)
        if has_inline_data:
            mime = _core_get(inline_data, "mimeType", "audio/pcm")
            data = _core_get(inline_data, "data", "")
            audio = {}
            audio["data"] = data
            audio["mimeType"] = mime
            audio["format"] = "pcm16"
            audio["sampleRate"] = 24000
            audio["is_delta"] = True
            result["audio"] = audio
        else:
            _gemini_merge_response_part_impl(result, text_parts, function_calls, part)
    content = _core_string_join("", text_parts)
    result["content"] = content
    call_count = _core_len(function_calls)
    has_calls = _core_gt(call_count, 0)
    if has_calls:
        result["function_calls"] = function_calls
        result["finish_reason"] = "function_call"
    else:
        pass
    turn_complete = _core_get(server, "turnComplete", False)
    if turn_complete:
        result["finish_reason"] = "stop"
    else:
        pass
    usage = _core_get(event, "usageMetadata", None)
    gemini_usage = _gemini_usage_impl(usage)
    model_usage = _ai_model_usage_impl(ai_name, model, gemini_usage)
    results = []
    results.append(result)
    event_id = _core_get(event, "id", "gemini-live")
    out = {}
    out["results"] = results
    out["remote_id"] = event_id
    out["model_usage"] = model_usage
    return out


def _gemini_service_tier_impl(request: Any, options: Any, vertex: bool, live: bool) -> Any:
    _core_coverage_mark("_gemini_service_tier_impl")
    option_tier_snake = _core_get(options, "service_tier", None)
    option_tier = _core_get(options, "serviceTier", option_tier_snake)
    empty_model_config = {}
    model_config_snake = _core_get(request, "model_config", empty_model_config)
    model_config = _core_get(request, "modelConfig", model_config_snake)
    model_tier_snake = _core_get(model_config, "service_tier", None)
    service_tier = _core_get(model_config, "serviceTier", model_tier_snake)
    has_option_tier = _core_is_not_none(option_tier)
    if has_option_tier:
        service_tier = option_tier
    else:
        pass
    has_service_tier = _core_is_not_none(service_tier)
    if has_service_tier:
        is_auto = _core_eq(service_tier, "auto")
        if is_auto:
            none = _core_none()
            return none
        else:
            pass
        if vertex:
            error = _core_ai_error_unsupported("Gemini inference service tiers are not supported by Vertex AI")
            raise error
        else:
            pass
        if live:
            error = _core_ai_error_unsupported("Gemini inference service tiers are not supported by the Live API")
            raise error
        else:
            pass
    else:
        pass
    return service_tier


def _gemini_build_chat_request(request: AxChatRequest, options: Any, is_vertex: bool) -> Any:
    _core_coverage_mark("_gemini_build_chat_request")
    payload = {}
    service_tier = _gemini_service_tier_impl(request, options, is_vertex, False)
    has_service_tier = _core_is_not_none(service_tier)
    if has_service_tier:
        payload["service_tier"] = service_tier
    else:
        pass
    empty_prompt = []
    prompt = _core_get(request, "chat_prompt", empty_prompt)
    system_parts = []
    contents = []
    for message in prompt:
        role = _core_get(message, "role", None)
        is_system = _core_eq(role, "system")
        if is_system:
            system_text = _core_get(message, "content", "")
            system_parts.append(system_text)
        else:
            mapped = _gemini_message_impl(message)
            has_mapped = _core_is_not_none(mapped)
            if has_mapped:
                contents.append(mapped)
            else:
                pass
    system_count = _core_len(system_parts)
    has_system = _core_gt(system_count, 0)
    if has_system:
        system_text_joined = _core_string_join(" ", system_parts)
        system_part = {}
        system_part["text"] = system_text_joined
        system_part_list = []
        system_part_list.append(system_part)
        system_instruction = {}
        system_instruction["role"] = "user"
        system_instruction["parts"] = system_part_list
        payload["systemInstruction"] = system_instruction
    else:
        pass
    payload["contents"] = contents
    model = _core_get(request, "model", "gemini-2.5-flash")
    is_gemini37_flash = _core_eq(model, "gemini-3.7-flash")
    is_gemini36_flash = _core_eq(model, "gemini-3.6-flash")
    is_gemini35_flash_lite = _core_eq(model, "gemini-3.5-flash-lite")
    server_managed_sampling_36 = _core_or(is_gemini37_flash, is_gemini36_flash)
    server_managed_sampling = _core_or(server_managed_sampling_36, is_gemini35_flash_lite)
    generation_config = {}
    generation_config["candidateCount"] = 1
    generation_config["responseMimeType"] = "text/plain"
    empty_model_config = {}
    model_config = _core_get(request, "model_config", empty_model_config)
    _gemini_apply_model_config_impl(generation_config, model, model_config, server_managed_sampling)
    response_format = _core_get(request, "response_format", None)
    has_response_format = _core_truthy(response_format)
    if has_response_format:
        generation_config["responseMimeType"] = "application/json"
        format_type = _core_get(response_format, "type", "")
        is_json_schema = _core_eq(format_type, "json_schema")
        if is_json_schema:
            schema_container = _core_get(response_format, "schema", None)
            schema = _core_get(schema_container, "schema", schema_container)
            generation_config["responseJsonSchema"] = schema
        else:
            pass
    else:
        pass
    is_gemini3 = _core_string_starts_with(model, "gemini-3")
    client_managed_sampling = _core_not(server_managed_sampling)
    clamp_gemini3_temperature = _core_and(is_gemini3, client_managed_sampling)
    if clamp_gemini3_temperature:
        temperature = _core_get(generation_config, "temperature", None)
        missing_temperature = _core_is_none(temperature)
        if missing_temperature:
            generation_config["temperature"] = 1
        else:
            too_low = _core_lt(temperature, 1)
            if too_low:
                generation_config["temperature"] = 1
            else:
                pass
    else:
        pass
    payload["generationConfig"] = generation_config
    empty_functions = []
    functions = _core_get(request, "functions", empty_functions)
    has_functions = _core_truthy(functions)
    if has_functions:
        function_declarations = []
        for fn in functions:
            decl = _gemini_function_declaration_impl(fn)
            function_declarations.append(decl)
        tool = {}
        tool["function_declarations"] = function_declarations
        tools = []
        tools.append(tool)
        payload["tools"] = tools
        tool_config = _gemini_tool_config_impl(request)
        payload["toolConfig"] = tool_config
    else:
        pass
    return payload


def _gemini_clamp_thinking_level_impl(model: str, level: str) -> str:
    _core_coverage_mark("_gemini_clamp_thinking_level_impl")
    is_minimal = _core_eq(level, "minimal")
    is_low = _core_eq(level, "low")
    is_medium = _core_eq(level, "medium")
    is_high = _core_eq(level, "high")
    is_minimal_or_low = _core_or(is_minimal, is_low)
    is_medium_or_high = _core_or(is_medium, is_high)
    is_supported_level = _core_or(is_minimal_or_low, is_medium_or_high)
    if is_supported_level:
        pass
    else:
        message = _core_string_format("unsupported Gemini thinking level: {}", level)
        error = _core_ai_error_unsupported(message)
        raise error
    is_gemini3 = _core_contains(model, "gemini-3")
    is_image_name = _core_contains(model, "-image")
    is_image = _core_and(is_gemini3, is_image_name)
    if is_image:
        if is_minimal_or_low:
            return "minimal"
        else:
            pass
        return "high"
    else:
        pass
    is_legacy_pro_name = _core_contains(model, "gemini-3-pro")
    is_legacy_pro = _core_and(is_gemini3, is_legacy_pro_name)
    if is_legacy_pro:
        if is_minimal_or_low:
            return "low"
        else:
            pass
        return "high"
    else:
        pass
    is_37_flash = _core_contains(model, "gemini-3.7-flash")
    is_31_pro = _core_contains(model, "gemini-3.1-pro")
    no_minimal_name = _core_or(is_37_flash, is_31_pro)
    no_minimal = _core_and(is_gemini3, no_minimal_name)
    clamp_minimal = _core_and(no_minimal, is_minimal)
    if clamp_minimal:
        return "low"
    else:
        pass
    return level


def _gemini_apply_thinking_config_impl(payload: Any, model: str, model_config: Any) -> None:
    _core_coverage_mark("_gemini_apply_thinking_config_impl")
    thinking_config = {}
    has_thinking = False
    budget_is_none = False
    is_gemini3 = _core_contains(model, "gemini-3")
    is_25_pro = _core_contains(model, "gemini-2.5-pro")
    empty_level_mapping = {}
    level_mapping_snake = _core_get(model_config, "thinking_level_mapping", empty_level_mapping)
    level_mapping = _core_get(model_config, "thinkingLevelMapping", level_mapping_snake)
    empty_budget_levels = {}
    budget_levels_snake = _core_get(model_config, "thinking_token_budget_levels", empty_budget_levels)
    budget_levels = _core_get(model_config, "thinkingTokenBudgetLevels", budget_levels_snake)
    minimum_budget = _core_get(budget_levels, "minimal", 200)
    low_budget = _core_get(budget_levels, "low", 800)
    medium_budget = _core_get(budget_levels, "medium", 5000)
    high_budget = _core_get(budget_levels, "high", 10000)
    highest_budget = _core_get(budget_levels, "highest", 24500)
    budget_snake = _core_get(model_config, "thinking_token_budget", None)
    budget = _core_get(model_config, "thinkingTokenBudget", budget_snake)
    has_budget = _core_is_not_none(budget)
    if has_budget:
        budget_is_number = _core_type_is(budget, "number")
        budget_is_string = _core_type_is(budget, "string")
        if is_gemini3:
            if budget_is_number:
                message = _core_string_format("Gemini 3 model {} does not support numeric thinkingTokenBudget", model)
                error = _core_ai_error_unsupported(message)
                raise error
            else:
                pass
            if budget_is_string:
                pass
            else:
                error = _core_ai_error_unsupported("Gemini thinkingTokenBudget must be a number or logical level")
                raise error
            level = ""
            is_none = _core_eq(budget, "none")
            if is_none:
                level = "minimal"
                budget_is_none = True
            else:
                pass
            is_minimal = _core_eq(budget, "minimal")
            if is_minimal:
                level = "minimal"
            else:
                pass
            is_low = _core_eq(budget, "low")
            if is_low:
                level = "low"
            else:
                pass
            is_medium = _core_eq(budget, "medium")
            if is_medium:
                level = "medium"
            else:
                pass
            is_high = _core_eq(budget, "high")
            if is_high:
                level = "high"
            else:
                pass
            is_highest = _core_eq(budget, "highest")
            if is_highest:
                level = "high"
            else:
                pass
            unknown_level = _core_eq(level, "")
            if unknown_level:
                message = _core_string_format("unsupported Gemini thinkingTokenBudget level: {}", budget)
                error = _core_ai_error_unsupported(message)
                raise error
            else:
                pass
            mapping_key = budget
            if is_none:
                mapping_key = "minimal"
            else:
                pass
            mapped_level = _core_get(level_mapping, mapping_key, level)
            clamped_level = _gemini_clamp_thinking_level_impl(model, mapped_level)
            thinking_config["thinkingLevel"] = clamped_level
        else:
            if budget_is_number:
                numeric_budget = budget
                is_zero = _core_eq(budget, 0)
                clamp_pro_zero = _core_and(is_25_pro, is_zero)
                if clamp_pro_zero:
                    numeric_budget = minimum_budget
                else:
                    pass
                thinking_config["thinkingBudget"] = numeric_budget
            else:
                if budget_is_string:
                    pass
                else:
                    error = _core_ai_error_unsupported("Gemini thinkingTokenBudget must be a number or logical level")
                    raise error
                numeric_budget = -1
                is_none = _core_eq(budget, "none")
                if is_none:
                    numeric_budget = 0
                    if is_25_pro:
                        numeric_budget = minimum_budget
                    else:
                        pass
                    budget_is_none = True
                else:
                    pass
                is_minimal = _core_eq(budget, "minimal")
                if is_minimal:
                    numeric_budget = minimum_budget
                else:
                    pass
                is_low = _core_eq(budget, "low")
                if is_low:
                    numeric_budget = low_budget
                else:
                    pass
                is_medium = _core_eq(budget, "medium")
                if is_medium:
                    numeric_budget = medium_budget
                else:
                    pass
                is_high = _core_eq(budget, "high")
                if is_high:
                    numeric_budget = high_budget
                else:
                    pass
                is_highest = _core_eq(budget, "highest")
                if is_highest:
                    numeric_budget = highest_budget
                else:
                    pass
                unknown_level = _core_eq(numeric_budget, -1)
                if unknown_level:
                    message = _core_string_format("unsupported Gemini thinkingTokenBudget level: {}", budget)
                    error = _core_ai_error_unsupported(message)
                    raise error
                else:
                    pass
                thinking_config["thinkingBudget"] = numeric_budget
        has_thinking = True
    else:
        pass
    level_snake = _core_get(model_config, "thinking_level", None)
    explicit_level = _core_get(model_config, "thinkingLevel", level_snake)
    has_explicit_level = _core_is_not_none(explicit_level)
    use_explicit_level = _core_and(is_gemini3, has_explicit_level)
    if use_explicit_level:
        level_is_string = _core_type_is(explicit_level, "string")
        if level_is_string:
            pass
        else:
            error = _core_ai_error_unsupported("Gemini thinkingLevel must be a logical level")
            raise error
        clamped_level = _gemini_clamp_thinking_level_impl(model, explicit_level)
        _core_map_delete(thinking_config, "thinkingBudget")
        thinking_config["thinkingLevel"] = clamped_level
        has_thinking = True
    else:
        pass
    show_snake = _core_get(model_config, "show_thoughts", None)
    show_thoughts = _core_get(model_config, "showThoughts", show_snake)
    has_show = _core_is_not_none(show_thoughts)
    if has_show:
        thinking_config["includeThoughts"] = show_thoughts
        has_thinking = True
    else:
        pass
    if budget_is_none:
        thinking_config["includeThoughts"] = False
        has_thinking = True
    else:
        pass
    if has_thinking:
        payload["thinkingConfig"] = thinking_config
    else:
        pass
    return None


def _gemini_apply_model_config_impl(payload: Any, model: str, model_config: Any, server_managed_sampling: bool) -> None:
    _core_coverage_mark("_gemini_apply_model_config_impl")
    _openai_copy_config_key_impl(payload, model_config, "maxTokens", "maxOutputTokens")
    _openai_copy_config_key_impl(payload, model_config, "max_tokens", "maxOutputTokens")
    client_managed_sampling = _core_not(server_managed_sampling)
    if client_managed_sampling:
        _openai_copy_config_key_impl(payload, model_config, "temperature", "temperature")
        _openai_copy_config_key_impl(payload, model_config, "topP", "topP")
        _openai_copy_config_key_impl(payload, model_config, "top_p", "topP")
        _openai_copy_config_key_impl(payload, model_config, "topK", "topK")
        _openai_copy_config_key_impl(payload, model_config, "top_k", "topK")
    else:
        pass
    _openai_copy_config_key_impl(payload, model_config, "frequencyPenalty", "frequencyPenalty")
    _openai_copy_config_key_impl(payload, model_config, "frequency_penalty", "frequencyPenalty")
    _openai_copy_config_key_impl(payload, model_config, "n", "candidateCount")
    _openai_copy_config_key_impl(payload, model_config, "stopSequences", "stopSequences")
    _openai_copy_config_key_impl(payload, model_config, "stop_sequences", "stopSequences")
    _gemini_apply_thinking_config_impl(payload, model, model_config)
    return None


def _gemini_message_impl(message: Any) -> Any:
    _core_coverage_mark("_gemini_message_impl")
    role = _core_get(message, "role", None)
    is_user = _core_eq(role, "user")
    if is_user:
        content = _core_get(message, "content", "")
        parts = _gemini_content_parts_impl(content)
        out = {}
        out["role"] = "user"
        out["parts"] = parts
        return out
    else:
        pass
    is_assistant = _core_eq(role, "assistant")
    if is_assistant:
        parts = []
        content = _core_get(message, "content", "")
        has_content = _core_truthy(content)
        if has_content:
            text_part = {}
            text_part["text"] = content
            parts.append(text_part)
        else:
            pass
        empty_calls = []
        calls = _core_get(message, "function_calls", empty_calls)
        calls_camel = _core_get(message, "functionCalls", calls)
        for call in calls_camel:
            function = _core_get(call, "function", None)
            name = _core_get(function, "name", None)
            empty_args = {}
            args = _core_get(function, "params", empty_args)
            args_is_string = _core_type_is(args, "string")
            if args_is_string:
                try:
                    parsed = _core_json_parse(args)
                    args = parsed
                except Exception as parse_error:
                    args = {}
            else:
                pass
            function_call = {}
            function_call["name"] = name
            function_call["args"] = args
            part = {}
            part["functionCall"] = function_call
            parts.append(part)
        out = {}
        out["role"] = "model"
        out["parts"] = parts
        return out
    else:
        pass
    is_function = _core_eq(role, "function")
    if is_function:
        name = _core_get(message, "name", None)
        function_id = _core_get(message, "function_id", name)
        function_id_camel = _core_get(message, "functionId", function_id)
        result_value = _core_get(message, "result", None)
        response = {}
        response["result"] = result_value
        function_response = {}
        function_response["name"] = function_id_camel
        function_response["response"] = response
        part = {}
        part["functionResponse"] = function_response
        parts = []
        parts.append(part)
        out = {}
        out["role"] = "user"
        out["parts"] = parts
        return out
    else:
        pass
    none = _core_none()
    return none


def _gemini_content_parts_impl(content: Any) -> list[Any]:
    _core_coverage_mark("_gemini_content_parts_impl")
    parts = []
    is_list = _core_type_is(content, "list")
    if is_list:
        for part in content:
            mapped = _gemini_content_part_impl(part)
            parts.append(mapped)
    else:
        part = {}
        part["text"] = content
        parts.append(part)
    return parts


def _gemini_content_part_impl(part: Any) -> Any:
    _core_coverage_mark("_gemini_content_part_impl")
    type = _core_get(part, "type", "text")
    is_text = _core_eq(type, "text")
    if is_text:
        out = {}
        text = _core_get(part, "text", "")
        out["text"] = text
        return out
    else:
        pass
    is_image = _core_eq(type, "image")
    if is_image:
        mime = _core_get(part, "mimeType", "image/png")
        image_alt = _core_get(part, "data", None)
        image = _core_get(part, "image", image_alt)
        inline = {}
        inline["mimeType"] = mime
        inline["data"] = image
        out = {}
        out["inlineData"] = inline
        return out
    else:
        pass
    is_audio = _core_eq(type, "audio")
    if is_audio:
        format = _core_get(part, "format", "wav")
        default_mime = _core_string_format("audio/{}", format)
        mime = _core_get(part, "mimeType", default_mime)
        audio_alt = _core_get(part, "audio", None)
        data = _core_get(part, "data", audio_alt)
        inline = {}
        inline["mimeType"] = mime
        inline["data"] = data
        out = {}
        out["inlineData"] = inline
        return out
    else:
        pass
    is_file = _core_eq(type, "file")
    if is_file:
        mime = _core_get(part, "mimeType", "application/octet-stream")
        file_uri = _core_get(part, "fileUri", None)
        has_uri = _core_truthy(file_uri)
        if has_uri:
            file_data = {}
            file_data["mimeType"] = mime
            file_data["fileUri"] = file_uri
            out = {}
            out["fileData"] = file_data
            return out
        else:
            data = _core_get(part, "data", None)
            inline = {}
            inline["mimeType"] = mime
            inline["data"] = data
            out = {}
            out["inlineData"] = inline
            return out
    else:
        pass
    message = _core_string_format("Chat prompt content type not supported: {}", type)
    error = _core_ai_error_unsupported(message)
    raise error


def _gemini_function_declaration_impl(fn: Any) -> Any:
    _core_coverage_mark("_gemini_function_declaration_impl")
    decl = {}
    name = _core_get(fn, "name", None)
    description = _core_get(fn, "description", "")
    empty_parameters = {}
    parameters = _core_get(fn, "parameters", empty_parameters)
    decl["name"] = name
    decl["description"] = description
    decl["parameters"] = parameters
    return decl


def _gemini_tool_config_impl(request: Any) -> Any:
    _core_coverage_mark("_gemini_tool_config_impl")
    function_call = _core_get(request, "function_call", "auto")
    config = {}
    function_calling = {}
    is_none = _core_eq(function_call, "none")
    is_required = _core_eq(function_call, "required")
    is_auto = _core_eq(function_call, "auto")
    if is_none:
        function_calling["mode"] = "NONE"
    else:
        if is_required:
            function_calling["mode"] = "ANY"
        else:
            if is_auto:
                function_calling["mode"] = "AUTO"
            else:
                function_calling["mode"] = "ANY"
                function = _core_get(function_call, "function", None)
                name = _core_get(function, "name", None)
                has_name = _core_truthy(name)
                if has_name:
                    allowed = []
                    allowed.append(name)
                    function_calling["allowed_function_names"] = allowed
                else:
                    pass
    config["function_calling_config"] = function_calling
    return config


def _gemini_build_embed_request(request: AxEmbedRequest) -> Any:
    _core_coverage_mark("_gemini_build_embed_request")
    payload = {}
    empty_texts = []
    texts = _core_get(request, "texts", empty_texts)
    model = _core_get(request, "embed_model", "gemini-embedding-2")
    requests = []
    for text in texts:
        part = {}
        part["text"] = text
        parts = []
        parts.append(part)
        content = {}
        content["parts"] = parts
        item = {}
        model_name = _core_string_format("models/{}", model)
        item["model"] = model_name
        item["content"] = content
        dimensions = _core_get(request, "dimensions", None)
        has_dimensions = _core_is_not_none(dimensions)
        if has_dimensions:
            item["outputDimensionality"] = dimensions
        else:
            pass
        requests.append(item)
    payload["requests"] = requests
    return payload


def _gemini_build_vertex_embed_request(request: AxEmbedRequest, options: Any) -> Any:
    _core_coverage_mark("_gemini_build_vertex_embed_request")
    payload = {}
    instances = []
    empty_texts = []
    texts = _core_get(request, "texts", empty_texts)
    for text in texts:
        instance = {}
        instance["content"] = text
        task_type_snake = _core_get(options, "embed_type", None)
        task_type = _core_get(options, "embedType", task_type_snake)
        has_task_type = _core_truthy(task_type)
        if has_task_type:
            instance["taskType"] = task_type
        else:
            pass
        instances.append(instance)
    payload["instances"] = instances
    parameters = {}
    auto_truncate_snake = _core_get(options, "auto_truncate", None)
    auto_truncate = _core_get(options, "autoTruncate", auto_truncate_snake)
    has_auto_truncate = _core_is_not_none(auto_truncate)
    if has_auto_truncate:
        parameters["autoTruncate"] = auto_truncate
    else:
        pass
    dimensions = _core_get(request, "dimensions", None)
    has_dimensions = _core_is_not_none(dimensions)
    if has_dimensions:
        parameters["outputDimensionality"] = dimensions
    else:
        pass
    payload["parameters"] = parameters
    return payload


def _gemini_normalize_chat_response(raw: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("_gemini_normalize_chat_response")
    empty_candidates = []
    candidates = _core_get(raw, "candidates", empty_candidates)
    results = []
    maps_widget_token = _core_none()
    for candidate in candidates:
        result = {}
        candidate_index = _core_len(results)
        result["index"] = candidate_index
        finish = _core_get(candidate, "finishReason", "STOP")
        is_max = _core_eq(finish, "MAX_TOKENS")
        if is_max:
            result["finish_reason"] = "length"
        else:
            is_stop = _core_eq(finish, "STOP")
            if is_stop:
                result["finish_reason"] = "stop"
            else:
                message = _core_string_format("Gemini finish reason was blocked: {}", finish)
                error = _core_ai_error_refusal(message, raw)
                raise error
        empty_content = {}
        content = _core_get(candidate, "content", empty_content)
        empty_parts = []
        parts = _core_get(content, "parts", empty_parts)
        text_parts = []
        function_calls = []
        for part in parts:
            _gemini_merge_response_part_impl(result, text_parts, function_calls, part)
        content_text = _core_string_join("", text_parts)
        result["content"] = content_text
        result["function_calls"] = function_calls
        call_count = _core_len(function_calls)
        has_calls = _core_gt(call_count, 0)
        if has_calls:
            result["finish_reason"] = "function_call"
        else:
            pass
        citations = _gemini_extract_citations_impl(candidate)
        has_citations = _core_truthy(citations)
        if has_citations:
            result["citations"] = citations
        else:
            pass
        results.append(result)
        grounding = _core_get(candidate, "groundingMetadata", None)
        token = _core_get(grounding, "googleMapsWidgetContextToken", None)
        has_token = _core_truthy(token)
        if has_token:
            maps_widget_token = token
        else:
            pass
    usage_raw = _core_get(raw, "usageMetadata", None)
    usage = _gemini_usage_impl(usage_raw)
    model_version = _core_get(raw, "modelVersion", None)
    raw_model = _core_get(raw, "modelVersion", model)
    model_usage = _ai_model_usage_impl(ai_name, raw_model, usage)
    out = {}
    out["results"] = results
    remote_id = _core_get(raw, "responseId", None)
    has_remote = _core_truthy(remote_id)
    if has_remote:
        out["remote_id"] = remote_id
    else:
        pass
    out["model_usage"] = model_usage
    has_model_version = _core_truthy(model_version)
    has_widget = _core_is_not_none(maps_widget_token)
    has_metadata = _core_or(has_model_version, has_widget)
    if has_metadata:
        google = {}
        if has_model_version:
            google["modelVersion"] = model_version
        else:
            pass
        if has_widget:
            google["mapsWidgetContextToken"] = maps_widget_token
        else:
            pass
        metadata = {}
        metadata["google"] = google
        out["provider_metadata"] = metadata
    else:
        pass
    return out


def _gemini_merge_response_part_impl(result: Any, text_parts: list[Any], function_calls: list[Any], part: Any) -> None:
    _core_coverage_mark("_gemini_merge_response_part_impl")
    text = _core_get(part, "text", None)
    has_text = _core_is_not_none(text)
    if has_text:
        is_thought = _core_get(part, "thought", False)
        if is_thought:
            result["thought"] = text
        else:
            text_parts.append(text)
    else:
        pass
    function_call = _core_get(part, "functionCall", None)
    has_call = _core_is_not_none(function_call)
    if has_call:
        name = _core_get(function_call, "name", None)
        empty_args = {}
        args = _core_get(function_call, "args", empty_args)
        function = {}
        function["name"] = name
        function["params"] = args
        call = {}
        call["id"] = name
        call["type"] = "function"
        call["function"] = function
        function_calls.append(call)
    else:
        pass
    return None


def _gemini_extract_citations_impl(candidate: Any) -> list[Any]:
    _core_coverage_mark("_gemini_extract_citations_impl")
    out = []
    citation_meta = _core_get(candidate, "citationMetadata", None)
    empty_citations = []
    citations = _core_get(citation_meta, "citations", empty_citations)
    for citation in citations:
        uri = _core_get(citation, "uri", None)
        has_uri = _core_truthy(uri)
        if has_uri:
            item = {}
            item["url"] = uri
            title = _core_get(citation, "title", None)
            has_title = _core_is_not_none(title)
            if has_title:
                item["title"] = title
            else:
                pass
            license = _core_get(citation, "license", None)
            has_license = _core_is_not_none(license)
            if has_license:
                item["license"] = license
            else:
                pass
            out.append(item)
        else:
            pass
    grounding = _core_get(candidate, "groundingMetadata", None)
    chunks = _core_get(grounding, "groundingChunks", empty_citations)
    for chunk in chunks:
        maps = _core_get(chunk, "maps", None)
        maps_uri = _core_get(maps, "uri", None)
        has_maps = _core_truthy(maps_uri)
        if has_maps:
            item = {}
            item["url"] = maps_uri
            title = _core_get(maps, "title", None)
            has_title = _core_is_not_none(title)
            if has_title:
                item["title"] = title
            else:
                pass
            out.append(item)
        else:
            pass
        retrieved = _core_get(chunk, "retrievedContext", None)
        retrieved_uri = _core_get(retrieved, "uri", None)
        media_id = _core_get(retrieved, "media_id", None)
        has_retrieved_uri = _core_truthy(retrieved_uri)
        has_media = _core_truthy(media_id)
        has_retrieved = _core_or(has_retrieved_uri, has_media)
        if has_retrieved:
            item = {}
            url = _core_get(retrieved, "uri", "")
            item["url"] = url
            title = _core_get(retrieved, "title", None)
            has_title = _core_is_not_none(title)
            if has_title:
                item["title"] = title
            else:
                pass
            if has_media:
                item["mediaId"] = media_id
            else:
                pass
            pages = _core_get(retrieved, "page_numbers", None)
            has_pages = _core_is_not_none(pages)
            if has_pages:
                item["pageNumbers"] = pages
            else:
                pass
            out.append(item)
        else:
            pass
    return out


def _gemini_usage_impl(usage: Any) -> Any:
    _core_coverage_mark("_gemini_usage_impl")
    has_usage = _core_truthy(usage)
    if has_usage:
        pass
    else:
        none = _core_none()
        return none
    out = {}
    cached = _core_get(usage, "cachedContentTokenCount", 0)
    prompt_raw = _core_get(usage, "promptTokenCount", 0)
    negative_cached = _core_mul(-1, cached)
    prompt = _core_add(prompt_raw, negative_cached)
    completion = _core_get(usage, "candidatesTokenCount", 0)
    total = _core_get(usage, "totalTokenCount", 0)
    out["prompt_tokens"] = prompt
    out["completion_tokens"] = completion
    out["total_tokens"] = total
    thoughts = _core_get(usage, "thoughtsTokenCount", None)
    has_thoughts = _core_is_not_none(thoughts)
    if has_thoughts:
        out["reasoning_tokens"] = thoughts
    else:
        pass
    has_cached = _core_gt(cached, 0)
    if has_cached:
        out["cache_read_tokens"] = cached
    else:
        pass
    service_tier = _core_get(usage, "serviceTier", None)
    has_service_tier = _core_is_not_none(service_tier)
    if has_service_tier:
        is_unspecified = _core_eq(service_tier, "unspecified")
        if is_unspecified:
            service_tier = "standard"
        else:
            pass
        out["service_tier"] = service_tier
    else:
        pass
    return out


def _gemini_normalize_embed_response(raw: Any, ai_name: str, model: str) -> AxEmbedResponse:
    _core_coverage_mark("_gemini_normalize_embed_response")
    out = {}
    embeddings = []
    empty_raw_embeddings = []
    raw_embeddings = _core_get(raw, "embeddings", empty_raw_embeddings)
    for embedding in raw_embeddings:
        values = _core_get(embedding, "values", embedding)
        embeddings.append(values)
    empty_predictions = []
    predictions = _core_get(raw, "predictions", empty_predictions)
    for prediction in predictions:
        prediction_embedding = _core_get(prediction, "embeddings", None)
        values = _core_get(prediction_embedding, "values", prediction_embedding)
        embeddings.append(values)
    out["embeddings"] = embeddings
    return out


def _anthropic_build_chat_request(request: AxChatRequest) -> Any:
    _core_coverage_mark("_anthropic_build_chat_request")
    payload = {}
    model = _core_get(request, "model", "claude-3-7-sonnet-latest")
    payload["model"] = model
    empty_prompt = []
    prompt = _core_get(request, "chat_prompt", empty_prompt)
    supports_mid = _core_string_starts_with(model, "claude-opus-4-8")
    system = []
    messages = []
    seen_non_system = False
    for message in prompt:
        role = _core_get(message, "role", "")
        is_system = _core_eq(role, "system")
        if is_system:
            hoist_later = _core_not(supports_mid)
            hoist = _core_or(hoist_later, seen_non_system)
            should_preserve = _core_and(supports_mid, seen_non_system)
            if should_preserve:
                mapped_system = _anthropic_message_impl(message)
                messages.append(mapped_system)
            else:
                sys_item = {}
                sys_item["type"] = "text"
                sys_text = _core_get(message, "content", "")
                sys_item["text"] = sys_text
                cache = _core_get(message, "cache", False)
                if cache:
                    cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
                    sys_item["cache_control"] = cache_control
                else:
                    pass
                system.append(sys_item)
        else:
            seen_non_system = True
            mapped = _anthropic_message_impl(message)
            messages.append(mapped)
    system_count = _core_len(system)
    has_system = _core_gt(system_count, 0)
    if has_system:
        payload["system"] = system
    else:
        pass
    payload["messages"] = messages
    empty_model_config = {}
    model_config = _core_get(request, "model_config", empty_model_config)
    _anthropic_apply_model_config_impl(payload, model_config, model)
    response_format = _core_get(request, "response_format", None)
    has_response_format = _core_truthy(response_format)
    if has_response_format:
        format_type = _core_get(response_format, "type", "")
        is_json_schema = _core_eq(format_type, "json_schema")
        if is_json_schema:
            schema_container = _core_get(response_format, "schema", None)
            schema = _core_get(schema_container, "schema", schema_container)
            output_config = _core_get(payload, "output_config", empty_model_config)
            format = {}
            format["type"] = "json_schema"
            format["schema"] = schema
            output_config["format"] = format
            payload["output_config"] = output_config
        else:
            pass
    else:
        pass
    empty_functions = []
    functions = _core_get(request, "functions", empty_functions)
    has_functions = _core_truthy(functions)
    if has_functions:
        tools = []
        for fn in functions:
            tool = _anthropic_tool_spec_impl(fn)
            tools.append(tool)
        payload["tools"] = tools
        tool_choice = _anthropic_tool_choice_impl(request)
        has_choice = _core_is_not_none(tool_choice)
        if has_choice:
            payload["tool_choice"] = tool_choice
        else:
            pass
    else:
        pass
    return payload


def _anthropic_apply_model_config_impl(payload: Any, model_config: Any, model: str) -> None:
    _core_coverage_mark("_anthropic_apply_model_config_impl")
    _openai_copy_config_key_impl(payload, model_config, "maxTokens", "max_tokens")
    _openai_copy_config_key_impl(payload, model_config, "max_tokens", "max_tokens")
    _openai_copy_config_key_impl(payload, model_config, "stopSequences", "stop_sequences")
    _openai_copy_config_key_impl(payload, model_config, "stop_sequences", "stop_sequences")
    adaptive = _anthropic_is_adaptive_model_impl(model)
    supports_sampling = _core_not(adaptive)
    if supports_sampling:
        _openai_copy_config_key_impl(payload, model_config, "temperature", "temperature")
        _openai_copy_config_key_impl(payload, model_config, "topP", "top_p")
        _openai_copy_config_key_impl(payload, model_config, "top_p", "top_p")
        _openai_copy_config_key_impl(payload, model_config, "topK", "top_k")
        _openai_copy_config_key_impl(payload, model_config, "top_k", "top_k")
    else:
        pass
    _openai_copy_config_key_impl(payload, model_config, "stream", "stream")
    has_max = _core_get(payload, "max_tokens", None)
    missing_max = _core_is_none(has_max)
    if missing_max:
        payload["max_tokens"] = 40000
    else:
        pass
    n = _core_get(model_config, "n", None)
    has_n = _core_is_not_none(n)
    if has_n:
        too_many = _core_gt(n, 1)
        if too_many:
            error = _core_ai_error_unsupported("Anthropic does not support sampling (n > 1)")
            raise error
        else:
            pass
    else:
        pass
    budget = _core_get(model_config, "thinkingTokenBudget", None)
    budget_alt = _core_get(model_config, "thinking_token_budget", budget)
    has_budget = _core_truthy(budget_alt)
    if has_budget:
        show_thoughts_camel = _core_get(model_config, "showThoughts", True)
        show_thoughts = _core_get(model_config, "show_thoughts", show_thoughts_camel)
        thinking_config = _anthropic_thinking_config_impl(model, budget_alt, show_thoughts)
        thinking = _core_get(thinking_config, "thinking", None)
        has_thinking = _core_is_not_none(thinking)
        if has_thinking:
            payload["thinking"] = thinking
        else:
            pass
        output_config = _core_get(thinking_config, "output_config", None)
        has_output = _core_is_not_none(output_config)
        if has_output:
            payload["output_config"] = output_config
        else:
            pass
    else:
        pass
    effort = _core_get(model_config, "effort", None)
    has_effort = _core_truthy(effort)
    if has_effort:
        output_config = _core_get(payload, "output_config", model_config)
        output_config["effort"] = effort
        payload["output_config"] = output_config
    else:
        pass
    return None


def _anthropic_is_adaptive_model_impl(model: str) -> bool:
    _core_coverage_mark("_anthropic_is_adaptive_model_impl")
    is_48 = _core_contains(model, "claude-opus-4-8")
    is_47 = _core_contains(model, "claude-opus-4-7")
    is_46 = _core_contains(model, "claude-opus-4-6")
    is_sonnet_5 = _core_contains(model, "claude-sonnet-5")
    is_47_plus = _core_or(is_48, is_47)
    is_adaptive_opus = _core_or(is_47_plus, is_46)
    is_adaptive = _core_or(is_adaptive_opus, is_sonnet_5)
    return is_adaptive


def _anthropic_thinking_config_impl(model: str, level: str, show_thoughts: bool) -> Any:
    _core_coverage_mark("_anthropic_thinking_config_impl")
    out = {}
    is_none = _core_eq(level, "none")
    if is_none:
        return out
    else:
        pass
    budget = 10000
    effort = "medium"
    is_minimal = _core_eq(level, "minimal")
    if is_minimal:
        budget = 1024
        effort = "low"
    else:
        pass
    is_low = _core_eq(level, "low")
    if is_low:
        budget = 5000
        effort = "low"
    else:
        pass
    is_high = _core_eq(level, "high")
    if is_high:
        budget = 20000
        effort = "high"
    else:
        pass
    is_highest = _core_eq(level, "highest")
    if is_highest:
        budget = 32000
        effort = "max"
    else:
        pass
    is_adaptive = _anthropic_is_adaptive_model_impl(model)
    if is_adaptive:
        thinking = {}
        thinking["type"] = "adaptive"
        if show_thoughts:
            thinking["display"] = "summarized"
        else:
            thinking["display"] = "omitted"
        out["thinking"] = thinking
        output_config = {}
        output_config["effort"] = effort
        out["output_config"] = output_config
    else:
        thinking = {}
        thinking["type"] = "enabled"
        thinking["budget_tokens"] = budget
        out["thinking"] = thinking
        is_45 = _core_string_starts_with(model, "claude-opus-4-5")
        if is_45:
            output_config = {}
            is_max = _core_eq(effort, "max")
            if is_max:
                output_config["effort"] = "high"
            else:
                output_config["effort"] = effort
            out["output_config"] = output_config
        else:
            pass
    return out


def _anthropic_message_impl(message: Any) -> Any:
    _core_coverage_mark("_anthropic_message_impl")
    role = _core_get(message, "role", "user")
    out = {}
    is_system = _core_eq(role, "system")
    if is_system:
        out["role"] = "system"
        system_content = _core_get(message, "content", "")
        out["content"] = system_content
        return out
    else:
        pass
    is_function = _core_eq(role, "function")
    if is_function:
        out["role"] = "user"
        content = []
        block = {}
        block["type"] = "tool_result"
        result = _core_get(message, "result", "")
        block["content"] = result
        function_id = _core_get(message, "function_id", None)
        function_id_camel = _core_get(message, "functionId", function_id)
        block["tool_use_id"] = function_id_camel
        is_error = _core_get(message, "is_error", False)
        is_error_camel = _core_get(message, "isError", is_error)
        if is_error_camel:
            block["is_error"] = True
        else:
            pass
        cache = _core_get(message, "cache", False)
        if cache:
            cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
            block["cache_control"] = cache_control
        else:
            pass
        content.append(block)
        out["content"] = content
        return out
    else:
        pass
    is_assistant = _core_eq(role, "assistant")
    if is_assistant:
        out["role"] = "assistant"
        blocks = []
        empty_thought_blocks = []
        thought_blocks_snake = _core_get(message, "thought_blocks", empty_thought_blocks)
        thought_blocks = _core_get(message, "thoughtBlocks", thought_blocks_snake)
        has_thought_blocks = _core_truthy(thought_blocks)
        if has_thought_blocks:
            for thought_block in thought_blocks:
                data = _core_get(thought_block, "data", "")
                encrypted = _core_get(thought_block, "encrypted", False)
                signature = _core_get(thought_block, "signature", None)
                is_encrypted = _core_truthy(encrypted)
                if is_encrypted:
                    redacted = {}
                    redacted["type"] = "redacted_thinking"
                    redacted["data"] = data
                    has_signature = _core_is_not_none(signature)
                    if has_signature:
                        redacted["signature"] = signature
                    else:
                        pass
                    blocks.append(redacted)
                else:
                    thinking = {}
                    thinking["type"] = "thinking"
                    thinking["thinking"] = data
                    has_signature = _core_is_not_none(signature)
                    if has_signature:
                        thinking["signature"] = signature
                    else:
                        pass
                    blocks.append(thinking)
        else:
            thought = _core_get(message, "thought", None)
            has_thought = _core_truthy(thought)
            if has_thought:
                thinking = {}
                thinking["type"] = "thinking"
                thinking["thinking"] = thought
                blocks.append(thinking)
            else:
                pass
        content_value = _core_get(message, "content", "")
        has_content = _core_truthy(content_value)
        if has_content:
            text_block = {}
            text_block["type"] = "text"
            text_block["text"] = content_value
            blocks.append(text_block)
        else:
            pass
        empty_calls = []
        calls = _core_get(message, "function_calls", empty_calls)
        calls_camel = _core_get(message, "functionCalls", calls)
        for call in calls_camel:
            function = _core_get(call, "function", None)
            name = _core_get(function, "name", "")
            params = _core_get(function, "params", empty_calls)
            params_is_string = _core_type_is(params, "string")
            if params_is_string:
                try:
                    parsed = _core_json_parse(params)
                    params = parsed
                except Exception as parse_error:
                    params = {}
            else:
                pass
            tool_use = {}
            tool_use["type"] = "tool_use"
            id = _core_get(call, "id", name)
            tool_use["id"] = id
            tool_use["name"] = name
            tool_use["input"] = params
            blocks.append(tool_use)
        cache = _core_get(message, "cache", False)
        if cache:
            count = _core_len(blocks)
            has_blocks = _core_gt(count, 0)
            if has_blocks:
                index = _core_add(count, -1)
                last = _core_get(blocks, index, None)
                cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
                last["cache_control"] = cache_control
            else:
                pass
        else:
            pass
        count = _core_len(blocks)
        has_blocks = _core_gt(count, 0)
        if has_blocks:
            out["content"] = blocks
        else:
            out["content"] = ""
        return out
    else:
        pass
    out["role"] = "user"
    raw_content = _core_get(message, "content", "")
    cache = _core_get(message, "cache", False)
    content_is_string = _core_type_is(raw_content, "string")
    not_cache = _core_not(cache)
    plain_string = _core_and(content_is_string, not_cache)
    if plain_string:
        out["content"] = raw_content
    else:
        parts = _anthropic_content_parts_impl(raw_content)
        if cache:
            count = _core_len(parts)
            has_parts = _core_gt(count, 0)
            if has_parts:
                index = _core_add(count, -1)
                last = _core_get(parts, index, None)
                cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
                last["cache_control"] = cache_control
            else:
                pass
        else:
            pass
        out["content"] = parts
    return out


def _anthropic_content_parts_impl(content: Any) -> list[Any]:
    _core_coverage_mark("_anthropic_content_parts_impl")
    parts = []
    is_list = _core_type_is(content, "list")
    if is_list:
        for part in content:
            mapped = _anthropic_content_part_impl(part)
            parts.append(mapped)
    else:
        part = {}
        part["type"] = "text"
        part["text"] = content
        parts.append(part)
    return parts


def _anthropic_content_part_impl(part: Any) -> Any:
    _core_coverage_mark("_anthropic_content_part_impl")
    type = _core_get(part, "type", "text")
    is_text = _core_eq(type, "text")
    if is_text:
        out = {}
        out["type"] = "text"
        text = _core_get(part, "text", "")
        out["text"] = text
        cache = _core_get(part, "cache", False)
        if cache:
            cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
            out["cache_control"] = cache_control
        else:
            pass
        return out
    else:
        pass
    is_image = _core_eq(type, "image")
    if is_image:
        out = {}
        out["type"] = "image"
        source = {}
        source["type"] = "base64"
        mime = _core_get(part, "mimeType", "image/png")
        source["media_type"] = mime
        image_alt = _core_get(part, "data", None)
        image = _core_get(part, "image", image_alt)
        source["data"] = image
        out["source"] = source
        cache = _core_get(part, "cache", False)
        if cache:
            cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
            out["cache_control"] = cache_control
        else:
            pass
        return out
    else:
        pass
    message = _core_string_format("Anthropic content type not supported: {}", type)
    error = _core_ai_error_unsupported(message)
    raise error


def _anthropic_tool_spec_impl(fn: Any) -> Any:
    _core_coverage_mark("_anthropic_tool_spec_impl")
    tool = {}
    name = _core_get(fn, "name", None)
    description = _core_get(fn, "description", "")
    empty_schema = {}
    parameters = _core_get(fn, "parameters", empty_schema)
    tool["name"] = name
    tool["description"] = description
    tool["input_schema"] = parameters
    cache = _core_get(fn, "cache", False)
    if cache:
        cache_control = _core_json_parse("{\"type\":\"ephemeral\"}")
        tool["cache_control"] = cache_control
    else:
        pass
    return tool


def _anthropic_tool_choice_impl(request: Any) -> Any:
    _core_coverage_mark("_anthropic_tool_choice_impl")
    function_call = _core_get(request, "function_call", "auto")
    choice = {}
    is_none = _core_eq(function_call, "none")
    if is_none:
        error = _core_ai_error_unsupported("functionCall none not supported")
        raise error
    else:
        pass
    is_required = _core_eq(function_call, "required")
    if is_required:
        choice["type"] = "any"
        return choice
    else:
        pass
    is_auto = _core_eq(function_call, "auto")
    if is_auto:
        choice["type"] = "auto"
        return choice
    else:
        pass
    function = _core_get(function_call, "function", None)
    name = _core_get(function, "name", None)
    has_name = _core_truthy(name)
    if has_name:
        choice["type"] = "tool"
        choice["name"] = name
        return choice
    else:
        pass
    none = _core_none()
    return none


def _anthropic_error_type_to_status(type: str) -> Any:
    _core_coverage_mark("_anthropic_error_type_to_status")
    none = _core_none()
    status = none
    is_overloaded = _core_eq(type, "overloaded_error")
    if is_overloaded:
        status = 529
    else:
        pass
    is_api = _core_eq(type, "api_error")
    if is_api:
        status = 500
    else:
        pass
    is_rate = _core_eq(type, "rate_limit_error")
    if is_rate:
        status = 429
    else:
        pass
    is_invalid = _core_eq(type, "invalid_request_error")
    if is_invalid:
        status = 400
    else:
        pass
    is_permission = _core_eq(type, "permission_error")
    if is_permission:
        status = 403
    else:
        pass
    is_not_found = _core_eq(type, "not_found_error")
    if is_not_found:
        status = 404
    else:
        pass
    is_too_large = _core_eq(type, "request_too_large")
    if is_too_large:
        status = 413
    else:
        pass
    return status


def _anthropic_map_error_event(error: Any, raw: Any) -> AxAIServiceError:
    _core_coverage_mark("_anthropic_map_error_event")
    type = _core_get(error, "type", "")
    message = _core_get(error, "message", "Anthropic API error")
    none = _core_none()
    is_auth = _core_eq(type, "authentication_error")
    if is_auth:
        auth_error = _core_ai_error_auth(message, none, type, raw, none)
        return auth_error
    else:
        pass
    status = _anthropic_error_type_to_status(type)
    has_status = _core_is_not_none(status)
    if has_status:
        is_429 = _core_eq(status, 429)
        is_500 = _core_eq(status, 500)
        is_529 = _core_eq(status, 529)
        retry_left = _core_or(is_429, is_500)
        retryable = _core_or(retry_left, is_529)
        status_error = _core_ai_error_status(message, status, type, raw, none, retryable)
        return status_error
    else:
        pass
    refusal = _core_ai_error_refusal(message, raw)
    return refusal


def _anthropic_normalize_chat_response(raw: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("_anthropic_normalize_chat_response")
    type = _core_get(raw, "type", "")
    is_error = _core_eq(type, "error")
    if is_error:
        error_body = _core_get(raw, "error", None)
        error = _anthropic_map_error_event(error_body, raw)
        raise error
    else:
        pass
    stop_reason = _core_get(raw, "stop_reason", None)
    is_refusal = _core_eq(stop_reason, "refusal")
    if is_refusal:
        details = _core_get(raw, "stop_details", None)
        message = _core_get(details, "explanation", "Anthropic refused to fulfill this request")
        error = _core_ai_error_refusal(message, raw)
        raise error
    else:
        pass
    text_parts = []
    function_calls = []
    thought_parts = []
    thought_blocks = []
    citations = []
    empty_content = []
    content = _core_get(raw, "content", empty_content)
    for block in content:
        _anthropic_merge_response_block_impl(text_parts, function_calls, thought_parts, thought_blocks, citations, block)
    result = {}
    result["index"] = 0
    id = _core_get(raw, "id", "0")
    result["id"] = id
    finish = _anthropic_finish_reason_impl(stop_reason)
    has_finish = _core_is_not_none(finish)
    if has_finish:
        result["finish_reason"] = finish
    else:
        pass
    text = _core_string_join("", text_parts)
    result["content"] = text
    result["function_calls"] = function_calls
    has_calls = _core_truthy(function_calls)
    if has_calls:
        result["finish_reason"] = "function_call"
    else:
        pass
    has_thought = _core_truthy(thought_parts)
    if has_thought:
        thought = _core_string_join("", thought_parts)
        result["thought"] = thought
        result["thought_blocks"] = thought_blocks
    else:
        pass
    has_citations = _core_truthy(citations)
    if has_citations:
        result["citations"] = citations
    else:
        pass
    results = []
    results.append(result)
    usage_raw = _core_get(raw, "usage", None)
    usage = _anthropic_usage_impl(usage_raw)
    raw_model = _core_get(raw, "model", model)
    model_usage = _ai_model_usage_impl(ai_name, raw_model, usage)
    out = {}
    out["results"] = results
    out["remote_id"] = id
    out["model_usage"] = model_usage
    return out


def _anthropic_merge_response_block_impl(text_parts: list[Any], function_calls: list[Any], thought_parts: list[Any], thought_blocks: list[Any], citations: list[Any], block: Any) -> None:
    _core_coverage_mark("_anthropic_merge_response_block_impl")
    type = _core_get(block, "type", "")
    is_text = _core_eq(type, "text")
    if is_text:
        text = _core_get(block, "text", "")
        text_parts.append(text)
        _anthropic_append_citations_impl(citations, block)
    else:
        pass
    is_tool = _core_eq(type, "tool_use")
    if is_tool:
        function = {}
        name = _core_get(block, "name", "")
        input = _core_get(block, "input", "")
        function["name"] = name
        function["params"] = input
        call = {}
        id = _core_get(block, "id", name)
        call["id"] = id
        call["type"] = "function"
        call["function"] = function
        function_calls.append(call)
    else:
        pass
    is_thinking = _core_eq(type, "thinking")
    if is_thinking:
        thinking = _core_get(block, "thinking", "")
        thought_parts.append(thinking)
        thought_block = {}
        thought_block["data"] = thinking
        thought_block["encrypted"] = False
        signature = _core_get(block, "signature", None)
        has_signature = _core_is_not_none(signature)
        if has_signature:
            thought_block["signature"] = signature
        else:
            pass
        thought_blocks.append(thought_block)
    else:
        pass
    is_redacted = _core_eq(type, "redacted_thinking")
    if is_redacted:
        data = _core_get(block, "data", None)
        data_alt = _core_get(block, "thinking", data)
        thought_parts.append(data_alt)
        thought_block = {}
        thought_block["data"] = data_alt
        thought_block["encrypted"] = True
        signature = _core_get(block, "signature", None)
        has_signature = _core_is_not_none(signature)
        if has_signature:
            thought_block["signature"] = signature
        else:
            pass
        thought_blocks.append(thought_block)
    else:
        pass
    return None


def _anthropic_append_citations_impl(out: list[Any], block: Any) -> None:
    _core_coverage_mark("_anthropic_append_citations_impl")
    empty = []
    citations = _core_get(block, "citations", empty)
    for citation in citations:
        url = _core_get(citation, "url", None)
        has_url = _core_truthy(url)
        if has_url:
            item = {}
            item["url"] = url
            title = _core_get(citation, "title", None)
            has_title = _core_is_not_none(title)
            if has_title:
                item["title"] = title
            else:
                pass
            snippet = _core_get(citation, "cited_text", None)
            has_snippet = _core_is_not_none(snippet)
            if has_snippet:
                item["snippet"] = snippet
            else:
                pass
            out.append(item)
        else:
            pass
    return None


def _anthropic_finish_reason_impl(reason: Any) -> str:
    _core_coverage_mark("_anthropic_finish_reason_impl")
    missing = _core_is_none(reason)
    if missing:
        none = _core_none()
        return none
    else:
        pass
    is_max = _core_eq(reason, "max_tokens")
    is_context = _core_eq(reason, "model_context_window_exceeded")
    is_length = _core_or(is_max, is_context)
    if is_length:
        return "length"
    else:
        pass
    is_tool = _core_eq(reason, "tool_use")
    if is_tool:
        return "function_call"
    else:
        pass
    is_refusal = _core_eq(reason, "refusal")
    if is_refusal:
        return "content_filter"
    else:
        pass
    return "stop"


def _anthropic_usage_impl(usage: Any) -> Any:
    _core_coverage_mark("_anthropic_usage_impl")
    has_usage = _core_truthy(usage)
    if has_usage:
        pass
    else:
        none = _core_none()
        return none
    out = {}
    prompt = _core_get(usage, "input_tokens", 0)
    completion = _core_get(usage, "output_tokens", 0)
    cache_creation = _core_get(usage, "cache_creation_input_tokens", 0)
    cache_read = _core_get(usage, "cache_read_input_tokens", 0)
    total_base = _core_add(prompt, completion)
    total_cache = _core_add(cache_creation, cache_read)
    total = _core_add(total_base, total_cache)
    out["prompt_tokens"] = prompt
    out["completion_tokens"] = completion
    out["total_tokens"] = total
    has_creation = _core_gt(cache_creation, 0)
    if has_creation:
        out["cache_creation_tokens"] = cache_creation
    else:
        pass
    has_read = _core_gt(cache_read, 0)
    if has_read:
        out["cache_read_tokens"] = cache_read
    else:
        pass
    speed = _core_get(usage, "speed", None)
    has_speed = _core_is_not_none(speed)
    if has_speed:
        out["speed"] = speed
    else:
        pass
    return out


def _anthropic_normalize_stream_delta(event: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("_anthropic_normalize_stream_delta")
    type = _core_get(event, "type", "")
    is_error = _core_eq(type, "error")
    if is_error:
        error_body = _core_get(event, "error", None)
        error = _anthropic_map_error_event(error_body, event)
        raise error
    else:
        pass
    index = 0
    is_start = _core_eq(type, "message_start")
    if is_start:
        message = _core_get(event, "message", None)
        id = _core_get(message, "id", "")
        state["remote_id"] = id
        usage_raw = _core_get(message, "usage", None)
        usage = _anthropic_usage_impl(usage_raw)
        state["usage"] = usage
        result = {}
        result["index"] = index
        result["id"] = id
        result["content"] = ""
        results = []
        results.append(result)
        out = {}
        out["results"] = results
        out["remote_id"] = id
        model_usage = _ai_model_usage_impl(ai_name, model, usage)
        out["model_usage"] = model_usage
        return out
    else:
        pass
    remote_id = _core_get(state, "remote_id", None)
    is_block_start = _core_eq(type, "content_block_start")
    if is_block_start:
        block = _core_get(event, "content_block", None)
        block_type = _core_get(block, "type", "")
        is_text = _core_eq(block_type, "text")
        if is_text:
            result = {}
            result["index"] = index
            text = _core_get(block, "text", "")
            result["content"] = text
            citations = []
            _anthropic_append_citations_impl(citations, block)
            has_citations = _core_truthy(citations)
            if has_citations:
                result["citations"] = citations
            else:
                pass
            results = []
            results.append(result)
            out = {}
            out["results"] = results
            out["remote_id"] = remote_id
            return out
        else:
            pass
        is_thinking = _core_eq(block_type, "thinking")
        if is_thinking:
            thinking = _core_get(block, "thinking", "")
            thought_block = {}
            thought_block["data"] = thinking
            thought_block["encrypted"] = False
            blocks = []
            blocks.append(thought_block)
            result = {}
            result["index"] = index
            result["thought"] = thinking
            result["thought_blocks"] = blocks
            results = []
            results.append(result)
            out = {}
            out["results"] = results
            out["remote_id"] = remote_id
            return out
        else:
            pass
        is_tool = _core_eq(block_type, "tool_use")
        if is_tool:
            event_index = _core_get(event, "index", 0)
            key = _core_string_format("tool_id_{}", event_index)
            name_key = _core_string_format("tool_name_{}", event_index)
            id = _core_get(block, "id", "")
            name = _core_get(block, "name", "")
            state[key] = id
            state[name_key] = name
            function = {}
            function["name"] = name
            function["params"] = ""
            call = {}
            call["id"] = id
            call["type"] = "function"
            call["function"] = function
            calls = []
            calls.append(call)
            result = {}
            result["index"] = index
            result["function_calls"] = calls
            results = []
            results.append(result)
            out = {}
            out["results"] = results
            out["remote_id"] = remote_id
            return out
        else:
            pass
    else:
        pass
    is_delta = _core_eq(type, "content_block_delta")
    if is_delta:
        delta = _core_get(event, "delta", None)
        delta_type = _core_get(delta, "type", "")
        is_text_delta = _core_eq(delta_type, "text_delta")
        if is_text_delta:
            result = {}
            result["index"] = index
            text = _core_get(delta, "text", "")
            result["content"] = text
            results = []
            results.append(result)
            out = {}
            out["results"] = results
            out["remote_id"] = remote_id
            return out
        else:
            pass
        is_thinking_delta = _core_eq(delta_type, "thinking_delta")
        if is_thinking_delta:
            thinking = _core_get(delta, "thinking", "")
            thought_block = {}
            thought_block["data"] = thinking
            thought_block["encrypted"] = False
            blocks = []
            blocks.append(thought_block)
            result = {}
            result["index"] = index
            result["thought"] = thinking
            result["thought_blocks"] = blocks
            results = []
            results.append(result)
            out = {}
            out["results"] = results
            out["remote_id"] = remote_id
            return out
        else:
            pass
        is_json_delta = _core_eq(delta_type, "input_json_delta")
        if is_json_delta:
            event_index = _core_get(event, "index", 0)
            key = _core_string_format("tool_id_{}", event_index)
            name_key = _core_string_format("tool_name_{}", event_index)
            id = _core_get(state, key, "")
            name = _core_get(state, name_key, "")
            partial = _core_get(delta, "partial_json", "")
            function = {}
            function["name"] = name
            function["params"] = partial
            call = {}
            call["id"] = id
            call["type"] = "function"
            call["function"] = function
            calls = []
            calls.append(call)
            result = {}
            result["index"] = index
            result["function_calls"] = calls
            results = []
            results.append(result)
            out = {}
            out["results"] = results
            out["remote_id"] = remote_id
            return out
        else:
            pass
    else:
        pass
    is_message_delta = _core_eq(type, "message_delta")
    if is_message_delta:
        delta = _core_get(event, "delta", None)
        stop = _core_get(delta, "stop_reason", None)
        is_refusal = _core_eq(stop, "refusal")
        if is_refusal:
            details = _core_get(delta, "stop_details", None)
            message = _core_get(details, "explanation", "Anthropic refused to fulfill this request")
            error = _core_ai_error_refusal(message, event)
            raise error
        else:
            pass
        usage_delta = _core_get(event, "usage", None)
        usage_existing = _core_get(state, "usage", usage_delta)
        completion = _core_get(usage_delta, "output_tokens", 0)
        prompt = _core_get(usage_existing, "prompt_tokens", 0)
        cache_creation = _core_get(usage_existing, "cache_creation_tokens", 0)
        cache_read = _core_get(usage_existing, "cache_read_tokens", 0)
        usage = {}
        usage["prompt_tokens"] = prompt
        usage["completion_tokens"] = completion
        total_base = _core_add(prompt, completion)
        total_cache = _core_add(cache_creation, cache_read)
        total = _core_add(total_base, total_cache)
        usage["total_tokens"] = total
        usage["cache_creation_tokens"] = cache_creation
        usage["cache_read_tokens"] = cache_read
        result = {}
        result["index"] = index
        result["content"] = ""
        finish = _anthropic_finish_reason_impl(stop)
        has_finish = _core_is_not_none(finish)
        if has_finish:
            result["finish_reason"] = finish
        else:
            pass
        results = []
        results.append(result)
        out = {}
        out["results"] = results
        out["remote_id"] = remote_id
        model_usage = _ai_model_usage_impl(ai_name, model, usage)
        out["model_usage"] = model_usage
        return out
    else:
        pass
    result = {}
    result["index"] = index
    result["content"] = ""
    results = []
    results.append(result)
    out = {}
    out["results"] = results
    out["remote_id"] = remote_id
    return out

# END AXIR CORE EMITTED FUNCTIONS

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
