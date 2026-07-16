from __future__ import annotations

from abc import ABC, abstractmethod
import base64
import copy
import json
import os
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Iterable


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
    if canonical == "openai-compatible":
        return OpenAICompatibleClient(**options)
    if canonical == "openai-responses":
        return OpenAIResponsesClient(**options)
    if canonical == "google-gemini":
        return GoogleGeminiClient(**options)
    if canonical == "anthropic":
        return AnthropicClient(**options)
    if canonical == "azure-openai":
        return AzureOpenAIClient(**options)
    if canonical == "deepseek":
        return DeepSeekClient(**options)
    if canonical == "mistral":
        return MistralClient(**options)
    if canonical == "reka":
        return RekaClient(**options)
    if canonical == "cohere":
        return CohereClient(**options)
    if canonical == "grok":
        return GrokClient(**options)
    raise ValueError(f"unsupported AxAI provider: {provider}")


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

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        stream_request = copy.deepcopy(_coerce_chat_request(request))
        stream_request.setdefault("model_config", {})["stream"] = True
        result = self.chat(stream_request, {**(options or {}), "stream": True})
        if isinstance(result, dict):
            yield result
        else:
            yield from result

    @abstractmethod
    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        ...

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
        self.options = dict(options or {})
        self.features = copy.deepcopy(features or default_features())
        self.metrics = default_metrics()
        self.last_used_chat_model = None
        self.last_used_embed_model = None
        self.last_used_model_config = None

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
        self.options = dict(options)

    def get_options(self) -> dict[str, Any]:
        return copy.deepcopy(self.options)

    def chat(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        started = time.perf_counter()
        is_error = False
        try:
            req = _coerce_chat_request(request)
            validate_chat_request(req)
            merged_options = {**self.options, **(options or {})}
            model = req.get("model") or self.model
            model_config = merge_model_config(self.model_config, req.get("model_config"), merged_options)
            if merged_options.get("stream") is not None:
                model_config["stream"] = bool(merged_options["stream"])
            req = {**req, "model": model, "model_config": model_config}
            self.last_used_chat_model = model
            self.last_used_model_config = copy.deepcopy(model_config)
            return self._chat(req, merged_options)
        except Exception:
            is_error = True
            raise
        finally:
            self._record_metrics("chat", time.perf_counter() - started, is_error)

    def embed(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        started = time.perf_counter()
        is_error = False
        try:
            texts = request.get("texts")
            if not texts:
                raise AxAIServiceResponseError("Embed texts is empty")
            embed_model = request.get("embed_model") or request.get("embedModel") or self.embed_model
            if not embed_model:
                raise AxAIServiceResponseError("Embed model not set")
            req = {**request, "texts": list(texts), "embed_model": embed_model}
            self.last_used_embed_model = embed_model
            return self._embed(req, {**self.options, **(options or {})})
        except Exception:
            is_error = True
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
    ):
        descriptor = provider_descriptor(profile)
        super().__init__(
            name=name,
            model=model,
            embed_model=embed_model,
            model_config=model_config,
            options=options,
            features=descriptor.get("features") or default_features(),
        )
        self.profile = profile
        self.descriptor = descriptor
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or descriptor.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.api_version = api_version or descriptor.get("apiVersion")
        self.timeout = timeout
        self.transport = transport

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        return False

    def _chat(self, request: dict[str, Any], options: dict[str, Any]):
        realtime_model = request.get("model") or self.model
        if provider_should_use_realtime(self.profile, str(realtime_model or ""), request):
            return self.realtime_chat(request, options)
        payload = provider_build_chat_request(self.profile, request)
        if payload.get("stream"):
            return self._stream_chat(payload, request, options)
        model = request.get("model") or payload.get("model") or self.model
        endpoint = self._operation_path("chat", model)
        raw = self._request_json(endpoint, payload, stream=False)
        return provider_normalize_chat_response(self.profile, raw, self.name, model)

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        req = _coerce_chat_request(request)
        req.setdefault("model_config", {})["stream"] = True
        validate_chat_request(req)
        merged_options = {**self.options, **(options or {}), "stream": True}
        model = req.get("model") or self.model
        model_config = merge_model_config(self.model_config, req.get("model_config"), merged_options)
        model_config["stream"] = True
        req = {**req, "model": model, "model_config": model_config}
        self.last_used_chat_model = model
        self.last_used_model_config = copy.deepcopy(model_config)
        payload = provider_build_chat_request(self.profile, req)
        yield from self._stream_chat(payload, req, merged_options)

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        payload = provider_build_embed_request(self.profile, request)
        model = request.get("embed_model") or request.get("embedModel") or payload.get("model") or self.embed_model
        endpoint = self._operation_path("embed", model)
        raw = self._request_json(endpoint, payload, stream=False)
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
            raw = self._request_json(endpoint, payload, stream=True)
            events = _iter_sse_json(raw)
            first = next(events, sentinel)
            if first is not sentinel:
                status = provider_classify_stream_error_status(self.profile, first)
                if status is not None and is_retryable_status(status) and attempt < max_retries:
                    attempt += 1
                    delay = min(initial_delay * (backoff ** (attempt - 1)), max_delay)
                    if delay > 0:
                        time.sleep(delay / 1000.0)
                    continue
            state: dict[str, Any] = {}
            if first is not sentinel:
                yield provider_normalize_stream_delta(self.profile, first, state, self.name, model)
                for event in events:
                    yield provider_normalize_stream_delta(self.profile, event, state, self.name, model)
            return

    def transcribe(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        payload = provider_build_transcribe_request(self.profile, request)
        model = request.get("model") or self.model
        descriptor = provider_operation_descriptor(self.profile, "transcribe")
        body_key = "data" if descriptor.get("body") == "multipart" else "json"
        raw = self._request_json(self._operation_path("transcribe", model), payload, stream=False, body_key=body_key)
        return provider_normalize_transcribe_response(self.profile, raw)

    def speak(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        payload = provider_build_speak_request(self.profile, request)
        model = request.get("model") or self.model
        descriptor = provider_operation_descriptor(self.profile, "speak")
        body_key = "data" if descriptor.get("body") == "multipart" else "json"
        binary_response = descriptor.get("response") == "binary"
        raw = self._request_json(self._operation_path("speak", model), payload, stream=False, body_key=body_key, binary_response=binary_response)
        return provider_normalize_speak_response(self.profile, raw, request)

    def realtime(self, events: Iterable[dict[str, Any]], model: str | None = None):
        state: dict[str, Any] = {}
        for event in events:
            yield provider_normalize_realtime_event(self.profile, event, state, self.name, model or self.model)

    def realtime_audio_setup(self, request: dict[str, Any]):
        return provider_build_realtime_audio_setup(self.profile, request)

    def realtime_audio_input(self, request: dict[str, Any]):
        return provider_build_realtime_audio_input(self.profile, request)

    def realtime_chat(self, request: dict[str, Any], options: dict[str, Any] | None = None, *, transport: Any = None):
        """Drive a realtime audio turn over a WebSocket transport: send the
        Core-built session setup + input events, fold the inbound event stream
        through the shared realtime codec, and return the final response. Pass a
        ScriptedRealtimeTransport to exercise the loop offline without a socket."""
        model = request.get("model") or self.model
        setup = provider_build_realtime_audio_setup(self.profile, request)
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
        descriptor = provider_operation_descriptor(self.profile, operation)
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

    def _request_json(self, endpoint: str, payload: dict[str, Any], *, stream: bool, body_key: str = "json", binary_response: bool = False):
        call = {
            "method": "POST",
            "url": self.base_url + endpoint,
            "headers": self._headers(),
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
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                if binary_response:
                    # Binary operations (e.g. OpenAI /audio/speech returns raw mp3)
                    # must not be UTF-8 decoded; return the bytes as base64.
                    return base64.b64encode(res.read()).decode()
                body = res.read().decode()
                return body if stream else json.loads(body)
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
        if self.descriptor.get("auth") == "anthropic_key":
            headers["x-api-key"] = self.api_key or ""
        if self.descriptor.get("auth") == "api_key_header":
            key_name = self.descriptor.get("apiKeyHeader") or "api-key"
            headers[str(key_name)] = self.api_key or ""
        for key, value in (self.descriptor.get("headers") or {}).items():
            headers[str(key)] = str(value)
        return headers


class OpenAICompatibleClient(ProviderOperationClient):
    def __init__(self, **options):
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "text-embedding-3-small")
        super().__init__(
            "openai-compatible",
            "openai",
            model=options.pop("model", "gpt-4.1-mini"),
            embed_model=embed_model,
            **options,
        )


class OpenAIResponsesClient(ProviderOperationClient):
    def __init__(self, **options):
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "text-embedding-ada-002")
        super().__init__(
            "openai-responses",
            "openai-responses",
            model=options.pop("model", "gpt-4o"),
            embed_model=embed_model,
            **options,
        )


class GoogleGeminiClient(ProviderOperationClient):
    def __init__(self, **options):
        embed_model = options.pop("embed_model", None)
        if embed_model is None:
            embed_model = options.pop("embedModel", "gemini-embedding-2")
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("GOOGLE_GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta"
        super().__init__(
            "google-gemini",
            "GoogleGeminiAI",
            model=options.pop("model", "gemini-2.5-flash"),
            embed_model=embed_model,
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class AnthropicClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("ANTHROPIC_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com"
        super().__init__(
            "anthropic",
            "anthropic",
            model=options.pop("model", "claude-3-7-sonnet-latest"),
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


class AzureOpenAIClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("AZURE_OPENAI_API_KEY")
        resource = options.pop("resource_name", None) or options.pop("resourceName", None) or os.environ.get("AZURE_OPENAI_RESOURCE_NAME")
        deployment = options.pop("deployment_name", None) or options.pop("deploymentName", None) or os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME")
        api_version = _normalize_azure_api_version(options.pop("api_version", None) or options.pop("apiVersion", None) or options.pop("version", None) or "2024-02-15-preview")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("AZURE_OPENAI_BASE_URL")
        if not base_url and resource and deployment:
            host = str(resource)
            if "://" not in host:
                host = f"https://{host}.openai.azure.com"
            base_url = host.rstrip("/") + "/openai/deployments/" + urllib.parse.quote(str(deployment), safe="")
        super().__init__(
            "azure-openai",
            "Azure OpenAI",
            model=options.pop("model", "gpt-5-mini"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "text-embedding-3-small")),
            api_key=api_key,
            base_url=base_url,
            api_version=api_version,
            **options,
        )


class DeepSeekClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("DEEPSEEK_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
        super().__init__(
            "deepseek",
            "DeepSeek",
            model=options.pop("model", "deepseek-v4-flash"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class MistralClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("MISTRAL_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("MISTRAL_BASE_URL") or "https://api.mistral.ai/v1"
        super().__init__(
            "mistral",
            "Mistral",
            model=options.pop("model", "mistral-small-latest"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "mistral-embed")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class RekaClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("REKA_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("REKA_BASE_URL") or "https://api.reka.ai/v1"
        super().__init__(
            "reka",
            "Reka",
            model=options.pop("model", "reka-core"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class CohereClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("COHERE_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("COHERE_BASE_URL") or "https://api.cohere.ai/compatibility/v1"
        super().__init__(
            "cohere",
            "Cohere",
            model=options.pop("model", "command-r-plus"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "embed-english-v3.0")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


class GrokClient(ProviderOperationClient):
    def __init__(self, **options):
        api_key = options.pop("api_key", None) or options.pop("apiKey", None) or os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
        base_url = options.pop("base_url", None) or options.pop("baseUrl", None) or os.environ.get("XAI_BASE_URL") or os.environ.get("GROK_BASE_URL") or "https://api.x.ai/v1"
        super().__init__(
            "grok",
            "Grok",
            model=options.pop("model", "grok-4.3"),
            embed_model=options.pop("embed_model", options.pop("embedModel", "")),
            api_key=api_key,
            base_url=base_url,
            **options,
        )


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


class AxBalancer(AxAIService):
    input_order_comparator = "input_order"

    @staticmethod
    def create(services, options: dict[str, Any] | None = None):
        return AxBalancer(services, options)

    def __init__(self, services, options: dict[str, Any] | None = None):
        if not services:
            raise ValueError("No AI services provided.")
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
        for service in self.services:
            raw = service.get_features(model) or {}
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
        response = provider.chat(request, options)
        return {"response": response, "routing": rec}

    def stream(self, request: dict[str, Any], options: dict[str, Any] | None = None):
        _rec, provider = self._selected_provider(request)
        return provider.stream(request, options)

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
def _core_eq(left, right): return left == right
def _core_ne(left, right): return left != right
def _core_lt(left, right): return left < right
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


def _core_list_get(values, index, default=None):
    return values[index] if values is not None and 0 <= index < len(values) else default


def _core_json_parse(value):
    return json.loads(value)


def _core_json_stringify(value):
    return json.dumps(value or {})


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
def openai_build_chat_request(request: AxChatRequest) -> Any:
    _core_coverage_mark("openai_build_chat_request")
    payload = {}
    model = _core_get(request, "model", None)
    payload["model"] = model
    messages = []
    chat_prompt = _core_get(request, "chat_prompt", None)
    for message in chat_prompt:
        provider_message = _openai_message_impl(message)
        messages.append(provider_message)
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
    return payload


def merge_model_config(base: Any, override: Any = None, options: Any = None) -> AxModelConfig:
    _core_coverage_mark("merge_model_config")
    merged = _core_map_merge(base, override)
    has_stream_option = _core_map_contains(options, "stream")
    if has_stream_option:
        stream = _core_get(options, "stream", None)
        merged["stream"] = stream
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
        function_calls = _core_get(message, "function_calls", None)
        has_content = _core_truthy(content)
        has_calls = _core_truthy(function_calls)
        has_assistant_payload = _core_or(has_content, has_calls)
        missing_assistant_payload = _core_not(has_assistant_payload)
        bad_assistant = _core_and(is_assistant, missing_assistant_payload)
        if bad_assistant:
            error = _core_ai_error_response("Assistant content is required when no tool calls are provided")
            raise error
        else:
            pass
    return None


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


def build_chat_request(service: AxAIService, request: AxChatRequest, options: Any = None) -> Any:
    _core_coverage_mark("build_chat_request")
    validate_chat_request(request)
    payload = openai_build_chat_request(request)
    return payload


def _openai_copy_config_key_impl(payload: Any, model_config: Any, source: str, target: str) -> None:
    _core_coverage_mark("_openai_copy_config_key_impl")
    has_source = _core_map_contains(model_config, source)
    if has_source:
        value = _core_get(model_config, source, None)
        payload[target] = value
    else:
        pass
    return None


def normalize_chat_response(raw: Any) -> AxChatResponse:
    _core_coverage_mark("normalize_chat_response")
    response = openai_normalize_chat_response(raw)
    return response


def normalize_stream_delta(raw: Any, state: Any) -> AxChatResponse:
    _core_coverage_mark("normalize_stream_delta")
    response = openai_normalize_stream_delta(raw, state)
    return response


def _openai_message_impl(message: Any) -> Any:
    _core_coverage_mark("_openai_message_impl")
    role = _core_get(message, "role", None)
    content = _core_get(message, "content", "")
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
        empty_calls = []
        calls_snake = _core_get(message, "function_calls", empty_calls)
        calls = _core_get(message, "functionCalls", calls_snake)
        has_calls = _core_truthy(calls)
        out = {}
        out["role"] = "assistant"
        if has_calls:
            assistant_content = _core_get(message, "content", None)
            has_assistant_content = _core_is_not_none(assistant_content)
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


def build_embed_request(service: AxAIService, request: AxEmbedRequest, options: Any = None) -> Any:
    _core_coverage_mark("build_embed_request")
    payload = openai_build_embed_request(request)
    return payload


def normalize_embed_response(raw: Any) -> AxEmbedResponse:
    _core_coverage_mark("normalize_embed_response")
    response = openai_normalize_embed_response(raw)
    return response


def normalize_token_usage(usage: Any) -> Any:
    _core_coverage_mark("normalize_token_usage")
    out = {}
    input_tokens = _core_get(usage, "input_tokens", 0)
    prompt_tokens_snake = _core_get(usage, "prompt_tokens", input_tokens)
    prompt_tokens = _core_get(usage, "promptTokens", prompt_tokens_snake)
    output_tokens = _core_get(usage, "output_tokens", 0)
    completion_tokens_snake = _core_get(usage, "completion_tokens", output_tokens)
    completion_tokens = _core_get(usage, "completionTokens", completion_tokens_snake)
    computed_total_tokens = _core_add(prompt_tokens, completion_tokens)
    total_tokens_snake = _core_get(usage, "total_tokens", computed_total_tokens)
    total_tokens = _core_get(usage, "totalTokens", total_tokens_snake)
    out["prompt_tokens"] = prompt_tokens
    out["completion_tokens"] = completion_tokens
    out["total_tokens"] = total_tokens
    reasoning_tokens_snake = _core_get(usage, "reasoning_tokens", None)
    reasoning_tokens = _core_get(usage, "reasoningTokens", reasoning_tokens_snake)
    has_reasoning = _core_is_not_none(reasoning_tokens)
    if has_reasoning:
        out["reasoning_tokens"] = reasoning_tokens
    else:
        pass
    cache_read_tokens_snake = _core_get(usage, "cache_read_tokens", None)
    cache_read_tokens = _core_get(usage, "cacheReadTokens", cache_read_tokens_snake)
    has_cache_read = _core_is_not_none(cache_read_tokens)
    if has_cache_read:
        out["cache_read_tokens"] = cache_read_tokens
    else:
        pass
    cache_creation_tokens_snake = _core_get(usage, "cache_creation_tokens", None)
    cache_creation_tokens = _core_get(usage, "cacheCreationTokens", cache_creation_tokens_snake)
    has_cache_creation = _core_is_not_none(cache_creation_tokens)
    if has_cache_creation:
        out["cache_creation_tokens"] = cache_creation_tokens
    else:
        pass
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


def chat_response_to_completion(response: AxChatResponse) -> Any:
    _core_coverage_mark("chat_response_to_completion")
    empty_results = []
    results = _core_get(response, "results", empty_results)
    empty_result = {}
    result = _core_list_get(results, 0, empty_result)
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
    model_usage = _core_get(response, "model_usage", None)
    usage = _core_get(model_usage, "tokens", None)
    out = {}
    out["content"] = content
    out["function_calls"] = calls
    out["usage"] = usage
    return out


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
        result = _openai_normalize_choice_impl(choice, raw)
        results.append(result)
    raw_model = _core_get(raw, "model", None)
    used_model = _core_coalesce(raw_model, model)
    usage = _core_get(raw, "usage", None)
    model_usage = _ai_model_usage_impl(ai_name, used_model, usage)
    remote_id = _core_get(raw, "id", None)
    out = {}
    out["results"] = results
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def _openai_normalize_choice_impl(choice: Any, raw: Any) -> Any:
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
    out["function_calls"] = function_calls
    out["finish_reason"] = finish_reason
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
    usage = _core_get(raw, "usage", None)
    model_usage = _ai_model_usage_impl(ai_name, used_model, usage)
    remote_id = _core_get(raw, "id", None)
    out = {}
    out["embeddings"] = embeddings
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def openai_normalize_stream_delta(raw: Any, state: Any, ai_name: str = "openai", model: str = None) -> AxChatResponse:
    _core_coverage_mark("openai_normalize_stream_delta")
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
        result = _openai_stream_choice_impl(choice, index_ids)
        results.append(result)
    raw_model = _core_get(raw, "model", None)
    used_model = _core_coalesce(raw_model, model)
    usage = _core_get(raw, "usage", None)
    model_usage = _ai_model_usage_impl(ai_name, used_model, usage)
    out = {}
    out["results"] = results
    out["remote_id"] = remote_id
    out["model_usage"] = model_usage
    return out


def _openai_stream_choice_impl(choice: Any, index_ids: Any) -> Any:
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
    finish_reason_raw = _core_get(choice, "finish_reason", None)
    finish_reason = _openai_finish_reason_impl(finish_reason_raw)
    out = {}
    out["index"] = index
    out["id"] = id
    out["content"] = content
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
    aliases = _core_json_parse("{\"openai\":\"openai-compatible\",\"openai-compatible\":\"openai-compatible\",\"openai_compatible\":\"openai-compatible\",\"compatible\":\"openai-compatible\",\"openai-responses\":\"openai-responses\",\"openai_responses\":\"openai-responses\",\"responses\":\"openai-responses\",\"google-gemini\":\"google-gemini\",\"google_gemini\":\"google-gemini\",\"gemini\":\"google-gemini\",\"anthropic\":\"anthropic\",\"claude\":\"anthropic\",\"azure-openai\":\"azure-openai\",\"azure_openai\":\"azure-openai\",\"azure\":\"azure-openai\",\"deepseek\":\"deepseek\",\"mistral\":\"mistral\",\"reka\":\"reka\",\"cohere\":\"cohere\",\"grok\":\"grok\",\"xai\":\"grok\",\"x-grok\":\"grok\",\"x_grok\":\"grok\"}")
    provider_id = _core_get(aliases, normalized, "openai-compatible")
    return provider_id


def provider_profile_registry() -> Any:
    _core_coverage_mark("provider_profile_registry")
    registry = _core_json_parse("{\"deferredCatalogProviderIds\":[],\"profiles\":{\"anthropic\":{\"aliases\":[\"anthropic\",\"claude\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"AnthropicClient\",\"id\":\"anthropic\"},\"azure-openai\":{\"aliases\":[\"azure-openai\",\"azure_openai\",\"azure\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"AzureOpenAIClient\",\"id\":\"azure-openai\"},\"cohere\":{\"aliases\":[\"cohere\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"CohereClient\",\"id\":\"cohere\"},\"deepseek\":{\"aliases\":[\"deepseek\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"DeepSeekClient\",\"id\":\"deepseek\"},\"google-gemini\":{\"aliases\":[\"google-gemini\",\"google_gemini\",\"gemini\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"GoogleGeminiClient\",\"id\":\"google-gemini\"},\"grok\":{\"aliases\":[\"grok\",\"xai\",\"x-grok\",\"x_grok\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"GrokClient\",\"id\":\"grok\"},\"mistral\":{\"aliases\":[\"mistral\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"MistralClient\",\"id\":\"mistral\"},\"openai-compatible\":{\"aliases\":[\"openai-compatible\",\"openai\",\"compatible\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"OpenAICompatibleClient\",\"id\":\"openai-compatible\"},\"openai-responses\":{\"aliases\":[\"openai-responses\",\"openai_responses\",\"responses\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"OpenAIResponsesClient\",\"id\":\"openai-responses\"},\"reka\":{\"aliases\":[\"reka\"],\"catalogStatus\":\"descriptor-covered\",\"generatedClient\":\"RekaClient\",\"id\":\"reka\"}},\"registryVersion\":\"provider-profile-registry-v1\",\"supportedProfileIds\":[\"openai-compatible\",\"openai-responses\",\"google-gemini\",\"anthropic\",\"azure-openai\",\"deepseek\",\"mistral\",\"reka\",\"cohere\",\"grok\"]}")
    return registry


def provider_resolve_profile(profile: str) -> Any:
    _core_coverage_mark("provider_resolve_profile")
    normalized = _core_string_lower(profile)
    aliases = _core_json_parse("{\"openai\":\"openai-compatible\",\"openai-compatible\":\"openai-compatible\",\"openai_compatible\":\"openai-compatible\",\"compatible\":\"openai-compatible\",\"openai-responses\":\"openai-responses\",\"openai_responses\":\"openai-responses\",\"responses\":\"openai-responses\",\"google-gemini\":\"google-gemini\",\"google_gemini\":\"google-gemini\",\"gemini\":\"google-gemini\",\"anthropic\":\"anthropic\",\"claude\":\"anthropic\",\"azure-openai\":\"azure-openai\",\"azure_openai\":\"azure-openai\",\"azure\":\"azure-openai\",\"deepseek\":\"deepseek\",\"mistral\":\"mistral\",\"reka\":\"reka\",\"cohere\":\"cohere\",\"grok\":\"grok\",\"xai\":\"grok\",\"x-grok\":\"grok\",\"x_grok\":\"grok\"}")
    is_known = _core_map_contains(aliases, normalized)
    provider_id = provider_normalize_profile(profile)
    resolved = {}
    resolved["id"] = provider_id
    resolved["known"] = is_known
    resolved["input"] = profile
    return resolved


def provider_model_catalog_summary() -> Any:
    _core_coverage_mark("provider_model_catalog_summary")
    summary = _core_json_parse("{\"catalogVersion\":\"provider-model-catalog-audit-v1\",\"deferredProviderIds\":[],\"descriptorCoveredProviderIds\":[\"openai-compatible\",\"openai-responses\",\"google-gemini\",\"anthropic\",\"azure-openai\",\"deepseek\",\"mistral\",\"reka\",\"cohere\",\"grok\"],\"filterOptions\":[\"all\",\"text\",\"embeddings\",\"code\",\"audio\"],\"nextMilestone\":\"Generated catalog provider clients match the active catalog\",\"providerCount\":11,\"providerNames\":[\"google-gemini\",\"webllm\",\"openai\",\"cohere\",\"mistral\",\"deepseek\",\"openai-responses\",\"grok\",\"reka\",\"anthropic\",\"azure-openai\"],\"semantics\":{\"codeMatchesTextFilter\":true,\"dynamicProvidersMayHaveEmptyModels\":true,\"metadataClonedPerCall\":true,\"modelSort\":\"price-then-name\",\"providerSort\":\"cheapest-model-then-display-name\"},\"source\":\"src/ax/ai/catalog.ts\"}")
    return summary


def _provider_model_catalog_registry() -> Any:
    _core_coverage_mark("_provider_model_catalog_registry")
    catalog = _core_json_parse("{\"all\":[{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-flash-thinking-exp-01-21\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-pro-exp-02-05\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-robotics-er-1.6-preview\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-embedding-001\",\"promptTokenCostPer1M\":0.15,\"provider\":\"google-gemini\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash-8b\",\"promptTokenCostPer1M\":0.0375,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-embedding-2\",\"promptTokenCostPer1M\":0.2,\"provider\":\"google-gemini\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash-lite\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.5-flash-lite\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-lite-latest\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-lite\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-lite-preview\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.0-pro\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.134,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-pro-image-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-2.5-flash\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.05,\"cacheWriteTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-flash-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-image-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"audio\":{\"input\":false,\"output\":true},\"capabilities\":{\"audioInput\":false,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-tts-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"audio\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"nano-banana-2\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":9,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.5-flash\",\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-2.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-pro-latest\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":12,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":200000,\"name\":\"gemini-3.1-pro-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-live-preview\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":8192,\"name\":\"gemini-2.5-flash-native-audio-preview-12-2025\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"}],\"name\":\"google-gemini\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-2b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-9b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"maxTokens\":4096,\"name\":\"Llama-3.1-70B-Instruct-q4f16_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Llama-3.1-8B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Llama-3.2-1B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":2048,\"name\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Mistral-7B-Instruct-v0.3-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Phi-3.5-mini-instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-0.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-1.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Qwen2.5-7B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"}],\"name\":\"webllm\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.02,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"text-embedding-3-small\",\"promptTokenCostPer1M\":0.02,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-ada-002\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.13,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-3-large\",\"promptTokenCostPer1M\":0.13,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-mini\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-2\",\"provider\":\"openai\",\"supported\":{\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":false},\"capabilities\":{\"audioInput\":true,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-whisper\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-translate\",\"provider\":\"openai\",\"type\":\"audio\"}],\"name\":\"openai\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-light\",\"promptTokenCostPer1M\":0.3,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-r\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"command-r-plus\",\"promptTokenCostPer1M\":3,\"provider\":\"cohere\",\"type\":\"text\"}],\"name\":\"cohere\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.15,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-nemo-latest\",\"promptTokenCostPer1M\":0.15,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-codestral-mamba\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-7b\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.3,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-nemo-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"codestral-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":true,\"name\":\"mistral-small-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.7,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mixtral-8x7b\",\"promptTokenCostPer1M\":0.7,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-large-latest\",\"promptTokenCostPer1M\":2,\"provider\":\"mistral\",\"type\":\"text\"}],\"name\":\"mistral\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"deepseek-chat\",\"deepseek-reasoner\"],\"cacheReadTokenCostPer1M\":0.0028,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.28,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":true,\"maxTokens\":384000,\"name\":\"deepseek-v4-flash\",\"promptTokenCostPer1M\":0.14,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.003625,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.87,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"maxTokens\":384000,\"name\":\"deepseek-v4-pro\",\"promptTokenCostPer1M\":0.435,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"deepseek\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":80,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o3-pro\",\"promptTokenCostPer1M\":20,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":600,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o1-pro\",\"promptTokenCostPer1M\":150,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"openai-responses\"},{\"defaultModel\":\"grok-3\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"grok-4-1-fast-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-non-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4-1-fast-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini\",\"promptTokenCostPer1M\":0.3,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-multi-agent-0309\",\"grok-4.20-multi-agent-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-multi-agent\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-non-reasoning\",\"grok-4.20-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-non-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-reasoning\",\"grok-4.20-reasoning-latest\",\"grok-4.20\",\"grok-4.20-0309\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.3-latest\",\"grok-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.3\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini-fast\",\"promptTokenCostPer1M\":0.6,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"USD\",\"isDefault\":true,\"name\":\"grok-3\",\"promptTokenCostPer1M\":3,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-fast\",\"promptTokenCostPer1M\":5,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-think-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"},{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"}],\"name\":\"grok\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-edge\",\"promptTokenCostPer1M\":0.4,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-flash\",\"promptTokenCostPer1M\":0.8,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"reka-core\",\"promptTokenCostPer1M\":3,\"provider\":\"reka\",\"type\":\"text\"}],\"name\":\"reka\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku-20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku@20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.24,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-instant-1.2\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.08,\"cacheWriteTokenCostPer1M\":1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku-latest\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku@20241022\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5@20251001\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-v2@20241022\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet@20240620\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet@20250219\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-sonnet-20240229\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5-20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5@20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4@20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5-20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5@20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":1,\"fastCacheWriteTokenCostPer1M\":12.5,\"fastCompletionTokenCostPer1M\":50,\"fastPromptTokenCostPer1M\":10,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-2.1\",\"promptTokenCostPer1M\":8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus-latest\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus@20240229\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1-20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1@20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4@20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"anthropic\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"}],\"audio\":[{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"audio\":{\"input\":false,\"output\":true},\"capabilities\":{\"audioInput\":false,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-tts-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-live-preview\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":131072,\"isDefault\":false,\"maxTokens\":8192,\"name\":\"gemini-2.5-flash-native-audio-preview-12-2025\",\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"audio\"}],\"name\":\"google-gemini\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-mini\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-audio-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-1.5\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-2\",\"provider\":\"openai\",\"supported\":{\"thinkingBudget\":true},\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":false},\"capabilities\":{\"audioInput\":true,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-whisper\",\"provider\":\"openai\",\"type\":\"audio\"},{\"audio\":{\"input\":true,\"output\":true},\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"isDefault\":false,\"name\":\"gpt-realtime-translate\",\"provider\":\"openai\",\"type\":\"audio\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"openai-responses\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[],\"name\":\"anthropic\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[],\"name\":\"cohere\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[],\"name\":\"mistral\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[],\"name\":\"reka\"},{\"defaultModel\":\"grok-3\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-think-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"},{\"capabilities\":{\"audioInput\":true,\"audioOutput\":true,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-voice-fast-1.0\",\"provider\":\"grok\",\"type\":\"audio\"}],\"name\":\"grok\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[],\"name\":\"webllm\"}],\"code\":[{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-codestral-mamba\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"codestral-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"code\"}],\"name\":\"mistral\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"}],\"name\":\"openai-responses\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[],\"name\":\"anthropic\"},{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[],\"name\":\"google-gemini\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[],\"name\":\"cohere\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[],\"name\":\"reka\"},{\"defaultModel\":\"grok-3\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[],\"name\":\"grok\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[],\"name\":\"webllm\"}],\"embeddings\":[{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.02,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"text-embedding-3-small\",\"promptTokenCostPer1M\":0.02,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-ada-002\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.13,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"text-embedding-3-large\",\"promptTokenCostPer1M\":0.13,\"provider\":\"openai\",\"type\":\"embeddings\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-embedding-001\",\"promptTokenCostPer1M\":0.15,\"provider\":\"google-gemini\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-embedding-2\",\"promptTokenCostPer1M\":0.2,\"provider\":\"google-gemini\",\"type\":\"embeddings\"}],\"name\":\"google-gemini\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-english-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-light-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"embed-multilingual-v3.0\",\"promptTokenCostPer1M\":0.1,\"provider\":\"cohere\",\"type\":\"embeddings\"}],\"name\":\"cohere\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[],\"name\":\"openai-responses\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[],\"name\":\"anthropic\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[],\"name\":\"deepseek\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[],\"name\":\"mistral\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[],\"name\":\"reka\"},{\"defaultModel\":\"grok-3\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[],\"name\":\"grok\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[],\"name\":\"webllm\"}],\"text\":[{\"defaultEmbedModel\":\"gemini-embedding-2\",\"defaultModel\":\"gemini-2.5-flash\",\"displayName\":\"Google Gemini\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-flash-thinking-exp-01-21\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.0-pro-exp-02-05\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-robotics-er-1.6-preview\",\"promptTokenCostPer1M\":0,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash-8b\",\"promptTokenCostPer1M\":0.0375,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-flash\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.3,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash-lite\",\"promptTokenCostPer1M\":0.075,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"deprecatedOn\":\"2026-06-01\",\"isDefault\":false,\"isDeprecated\":true,\"name\":\"gemini-2.0-flash\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-2.5-flash-lite\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.01,\"cacheWriteTokenCostPer1M\":0.1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-lite-latest\",\"promptTokenCostPer1M\":0.1,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.1-flash-lite\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.025,\"cacheWriteTokenCostPer1M\":0.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-lite-preview\",\"promptTokenCostPer1M\":0.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.0-pro\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":0.134,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-pro-image-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gemini-2.5-flash\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":2.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-flash-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.05,\"cacheWriteTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3-flash-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-3.1-flash-image-preview\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":3,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"nano-banana-2\",\"promptTokenCostPer1M\":0.5,\"provider\":\"google-gemini\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gemini-1.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.15,\"cacheWriteTokenCostPer1M\":1.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":9,\"contextWindow\":1048576,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":65536,\"name\":\"gemini-3.5-flash\",\"promptTokenCostPer1M\":1.5,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-2.5-pro\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.125,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.25,\"longContextCompletionTokenCostPer1M\":15,\"longContextPromptTokenCostPer1M\":2.5,\"longContextThreshold\":200000,\"name\":\"gemini-pro-latest\",\"promptTokenCostPer1M\":1.25,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.2,\"cacheWriteTokenCostPer1M\":2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"characterIsToken\":false,\"completionTokenCostPer1M\":12,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":0.4,\"longContextCompletionTokenCostPer1M\":18,\"longContextPromptTokenCostPer1M\":4,\"longContextThreshold\":200000,\"name\":\"gemini-3.1-pro-preview\",\"promptTokenCostPer1M\":2,\"provider\":\"google-gemini\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"google-gemini\"},{\"defaultModel\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"displayName\":\"WebLLM\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-2b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":8192,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"gemma-2-9b-it-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"maxTokens\":4096,\"name\":\"Llama-3.1-70B-Instruct-q4f16_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Llama-3.1-8B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Llama-3.2-1B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":2048,\"name\":\"Llama-3.2-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Mistral-7B-Instruct-v0.3-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":128000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Phi-3.5-mini-instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-0.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-1.5B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":2048,\"name\":\"Qwen2.5-3B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0,\"contextWindow\":32768,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"Qwen2.5-7B-Instruct-q4f32_1-MLC\",\"promptTokenCostPer1M\":0,\"provider\":\"webllm\",\"type\":\"text\"}],\"name\":\"webllm\"},{\"defaultModel\":\"mistral-small-latest\",\"displayName\":\"Mistral AI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.15,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-nemo-latest\",\"promptTokenCostPer1M\":0.15,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-codestral-mamba\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-7b\",\"promptTokenCostPer1M\":0.25,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.3,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mistral-nemo-latest\",\"promptTokenCostPer1M\":0.3,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"codestral-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"USD\",\"isDefault\":true,\"name\":\"mistral-small-latest\",\"promptTokenCostPer1M\":0.2,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.7,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"open-mixtral-8x7b\",\"promptTokenCostPer1M\":0.7,\"provider\":\"mistral\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":6,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"mistral-large-latest\",\"promptTokenCostPer1M\":2,\"provider\":\"mistral\",\"type\":\"text\"}],\"name\":\"mistral\"},{\"defaultModel\":\"deepseek-v4-flash\",\"displayName\":\"DeepSeek\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"deepseek-chat\",\"deepseek-reasoner\"],\"cacheReadTokenCostPer1M\":0.0028,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.28,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":true,\"maxTokens\":384000,\"name\":\"deepseek-v4-flash\",\"promptTokenCostPer1M\":0.14,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.003625,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.87,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"maxTokens\":384000,\"name\":\"deepseek-v4-pro\",\"promptTokenCostPer1M\":0.435,\"provider\":\"deepseek\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"deepseek\"},{\"defaultEmbedModel\":\"text-embedding-3-small\",\"defaultModel\":\"gpt-5-mini\",\"displayName\":\"OpenAI\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":false,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"openai\"},{\"defaultEmbedModel\":\"text-embedding-ada-002\",\"defaultModel\":\"gpt-4o\",\"displayName\":\"OpenAI Responses\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.05,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-nano\",\"promptTokenCostPer1M\":0.1,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4o-mini\",\"promptTokenCostPer1M\":0.15,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-nano\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-3.5-turbo\",\"promptTokenCostPer1M\":0.5,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1-mini\",\"promptTokenCostPer1M\":0.4,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":4.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4-mini\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":0.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4.4,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o4-mini\",\"promptTokenCostPer1M\":1.1,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4.1\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":8,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o3\",\"promptTokenCostPer1M\":2,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.1-codex-max\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.25,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":10,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"gpt-4o\",\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-chat-latest\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":14,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-codex\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":1.75,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"code\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.4\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":2.5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"chatgpt-4o-latest\",\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":30,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"longContextCacheReadTokenCostPer1M\":1,\"longContextCompletionTokenCostPer1M\":45,\"longContextPromptTokenCostPer1M\":10,\"longContextThreshold\":272000,\"name\":\"gpt-5.5\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":5,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":30,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4-turbo\",\"promptTokenCostPer1M\":10,\"provider\":\"openai-responses\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"o1\",\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":60,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-4\",\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":80,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o3-pro\",\"promptTokenCostPer1M\":20,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":120,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":15,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":168,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"gpt-5.2-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":21,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":false,\"thinkingBudget\":true,\"topP\":false},\"completionTokenCostPer1M\":180,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"longContextCompletionTokenCostPer1M\":270,\"longContextPromptTokenCostPer1M\":60,\"longContextThreshold\":272000,\"name\":\"gpt-5.5-pro\",\"notSupported\":{\"temperature\":true,\"topP\":true},\"promptTokenCostPer1M\":30,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":600,\"currency\":\"usd\",\"isDefault\":false,\"isExpensive\":true,\"name\":\"o1-pro\",\"promptTokenCostPer1M\":150,\"provider\":\"openai-responses\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"openai-responses\"},{\"defaultModel\":\"grok-3\",\"displayName\":\"xAI Grok\",\"isDynamic\":false,\"models\":[{\"aliases\":[\"grok-4-1-fast-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-non-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4-1-fast-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.05,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4-1-fast-reasoning\",\"promptTokenCostPer1M\":0.2,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":0.5,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini\",\"promptTokenCostPer1M\":0.3,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-multi-agent-0309\",\"grok-4.20-multi-agent-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-multi-agent\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-non-reasoning\",\"grok-4.20-non-reasoning-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-non-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.20-0309-reasoning\",\"grok-4.20-reasoning-latest\",\"grok-4.20\",\"grok-4.20-0309\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":2000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.20-reasoning\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"aliases\":[\"grok-4.3-latest\",\"grok-latest\"],\"cacheReadTokenCostPer1M\":0.2,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":2.5,\"contextWindow\":1000000,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-4.3\",\"promptTokenCostPer1M\":1.25,\"provider\":\"grok\",\"supported\":{\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-mini-fast\",\"promptTokenCostPer1M\":0.6,\"provider\":\"grok\",\"supported\":{\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"USD\",\"isDefault\":true,\"name\":\"grok-3\",\"promptTokenCostPer1M\":3,\"provider\":\"grok\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"USD\",\"isDefault\":false,\"name\":\"grok-3-fast\",\"promptTokenCostPer1M\":5,\"provider\":\"grok\",\"type\":\"text\"}],\"name\":\"grok\"},{\"defaultModel\":\"command-r-plus\",\"displayName\":\"Cohere\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":0.6,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-light\",\"promptTokenCostPer1M\":0.3,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.5,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"command-r\",\"promptTokenCostPer1M\":0.5,\"provider\":\"cohere\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"command-r-plus\",\"promptTokenCostPer1M\":3,\"provider\":\"cohere\",\"type\":\"text\"}],\"name\":\"cohere\"},{\"defaultModel\":\"reka-core\",\"displayName\":\"Reka\",\"isDynamic\":false,\"models\":[{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-edge\",\"promptTokenCostPer1M\":0.4,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2,\"currency\":\"usd\",\"isDefault\":false,\"name\":\"reka-flash\",\"promptTokenCostPer1M\":0.8,\"provider\":\"reka\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"name\":\"reka-core\",\"promptTokenCostPer1M\":3,\"provider\":\"reka\",\"type\":\"text\"}],\"name\":\"reka\"},{\"defaultModel\":\"claude-3-7-sonnet-latest\",\"displayName\":\"Anthropic\",\"isDynamic\":false,\"models\":[{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku-20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.03,\"cacheWriteTokenCostPer1M\":0.3,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":1.25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-haiku@20240307\",\"promptTokenCostPer1M\":0.25,\"provider\":\"anthropic\",\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":2.24,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-instant-1.2\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.08,\"cacheWriteTokenCostPer1M\":1,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":4,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku-latest\",\"promptTokenCostPer1M\":0.8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-haiku@20241022\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.1,\"cacheWriteTokenCostPer1M\":1.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":5,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-haiku-4-5@20251001\",\"promptTokenCostPer1M\":1,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet-v2@20241022\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":8192,\"name\":\"claude-3-5-sonnet@20240620\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":true,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet-latest\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-3-7-sonnet@20250219\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-sonnet-20240229\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5-20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":200000,\"name\":\"claude-sonnet-4-5@20250929\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4-6\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-sonnet-4@20250514\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.3,\"cacheWriteTokenCostPer1M\":3.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":15,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-sonnet-5\",\"promptTokenCostPer1M\":3,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5-20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":64000,\"name\":\"claude-opus-4-5@20251101\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-6\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":3,\"fastCacheWriteTokenCostPer1M\":37.5,\"fastCompletionTokenCostPer1M\":150,\"fastPromptTokenCostPer1M\":30,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-7\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"fastCacheReadTokenCostPer1M\":1,\"fastCacheWriteTokenCostPer1M\":12.5,\"fastCompletionTokenCostPer1M\":50,\"fastPromptTokenCostPer1M\":10,\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":0.5,\"cacheWriteTokenCostPer1M\":6.25,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":25,\"contextWindow\":1000000,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":128000,\"name\":\"claude-opus-4-8\",\"promptTokenCostPer1M\":5,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":false,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":25,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-2.1\",\"promptTokenCostPer1M\":8,\"provider\":\"anthropic\",\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus-latest\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":false,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":false,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":4096,\"name\":\"claude-3-opus@20240229\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"structuredOutputs\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1-20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-1@20250805\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4-20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"},{\"cacheReadTokenCostPer1M\":1.5,\"cacheWriteTokenCostPer1M\":18.75,\"capabilities\":{\"audioInput\":false,\"audioOutput\":false,\"showThoughts\":true,\"structuredOutputs\":true,\"temperature\":true,\"thinkingBudget\":true,\"topP\":true},\"completionTokenCostPer1M\":75,\"currency\":\"usd\",\"isDefault\":false,\"maxTokens\":32000,\"name\":\"claude-opus-4@20250514\",\"promptTokenCostPer1M\":15,\"provider\":\"anthropic\",\"supported\":{\"showThoughts\":true,\"structuredOutputs\":true,\"thinkingBudget\":true},\"type\":\"text\"}],\"name\":\"anthropic\"},{\"displayName\":\"Azure OpenAI\",\"isDynamic\":true,\"models\":[],\"name\":\"azure-openai\"}]}")
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
    openai_family = _core_json_parse("{\"openai-compatible\":{\"provider\":\"openai-compatible\",\"id\":\"openai-compatible\",\"name\":\"openai\",\"baseUrl\":\"https://api.openai.com/v1\",\"auth\":\"bearer\",\"defaultModel\":\"gpt-4.1-mini\",\"defaultEmbedModel\":\"text-embedding-3-small\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true},\"embed\":{\"method\":\"POST\",\"path\":\"/embeddings\",\"body\":\"json\",\"stream\":false}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":false,\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\",\"image/webp\"]},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"azure-openai\":{\"provider\":\"azure-openai\",\"id\":\"azure-openai\",\"name\":\"Azure OpenAI\",\"baseUrl\":\"https://{resource}.openai.azure.com/openai/deployments/{deployment}\",\"auth\":\"api_key_header\",\"apiKeyHeader\":\"api-key\",\"apiVersion\":\"2024-02-15-preview\",\"defaultModel\":\"gpt-5-mini\",\"defaultEmbedModel\":\"text-embedding-3-small\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true},\"embed\":{\"method\":\"POST\",\"path\":\"/embeddings\",\"body\":\"json\",\"stream\":false}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":true,\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\",\"image/gif\",\"image/webp\"],\"maxSize\":20971520},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"deepseek\":{\"provider\":\"deepseek\",\"id\":\"deepseek\",\"name\":\"DeepSeek\",\"baseUrl\":\"https://api.deepseek.com\",\"auth\":\"bearer\",\"defaultModel\":\"deepseek-v4-flash\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":true,\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"mistral\":{\"provider\":\"mistral\",\"id\":\"mistral\",\"name\":\"Mistral\",\"baseUrl\":\"https://api.mistral.ai/v1\",\"auth\":\"bearer\",\"defaultModel\":\"mistral-small-latest\",\"defaultEmbedModel\":\"mistral-embed\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true},\"embed\":{\"method\":\"POST\",\"path\":\"/embeddings\",\"body\":\"json\",\"stream\":false}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":false,\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"reka\":{\"provider\":\"reka\",\"id\":\"reka\",\"name\":\"Reka\",\"baseUrl\":\"https://api.reka.ai/v1\",\"auth\":\"bearer\",\"defaultModel\":\"reka-core\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":false,\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"cohere\":{\"provider\":\"cohere\",\"id\":\"cohere\",\"name\":\"Cohere\",\"baseUrl\":\"https://api.cohere.ai/compatibility/v1\",\"auth\":\"bearer\",\"defaultModel\":\"command-r-plus\",\"defaultEmbedModel\":\"embed-english-v3.0\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true},\"embed\":{\"method\":\"POST\",\"path\":\"/embeddings\",\"body\":\"json\",\"stream\":false}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":false,\"media\":{\"images\":{\"supported\":false,\"formats\":[]},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":false,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}},\"grok\":{\"provider\":\"grok\",\"id\":\"grok\",\"name\":\"Grok\",\"baseUrl\":\"https://api.x.ai/v1\",\"auth\":\"bearer\",\"defaultModel\":\"grok-4.3\",\"operations\":{\"chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false},\"stream_chat\":{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true}},\"features\":{\"functions\":true,\"streaming\":true,\"structured_outputs\":true,\"multi_turn\":true,\"thinking\":true,\"media\":{\"images\":{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\"],\"maxSize\":20971520},\"audio\":{\"supported\":false,\"formats\":[],\"output\":{\"supported\":false,\"formats\":[]}},\"files\":{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"},\"urls\":{\"supported\":false,\"web_search\":true,\"context_fetching\":false}},\"caching\":{\"supported\":false,\"types\":[]}}}}")
    openai_family_descriptor = _core_get(openai_family, provider_id, None)
    is_openai_family = _core_is_not_none(openai_family_descriptor)
    if is_openai_family:
        family_operations = _core_get(openai_family_descriptor, "operations", None)
        family_transcribe = _core_json_parse("{\"method\":\"POST\",\"path\":\"/audio/transcriptions\",\"body\":\"multipart\",\"stream\":false}")
        family_speak = _core_json_parse("{\"method\":\"POST\",\"path\":\"/audio/speech\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"}")
        family_operations["transcribe"] = family_transcribe
        family_operations["speak"] = family_speak
        is_grok_family = _core_eq(provider_id, "grok")
        if is_grok_family:
            grok_transcribe = _core_json_parse("{\"method\":\"POST\",\"path\":\"/stt\",\"body\":\"multipart\",\"stream\":false}")
            grok_speak = _core_json_parse("{\"method\":\"POST\",\"path\":\"/tts\",\"body\":\"json\",\"stream\":false}")
            family_operations["transcribe"] = grok_transcribe
            family_operations["speak"] = grok_speak
            grok_realtime_audio = _core_json_parse("{\"method\":\"WS\",\"path\":\"/realtime\",\"body\":\"events\",\"stream\":true,\"grammar\":\"openai_realtime_compatible\",\"url\":\"wss://api.x.ai/v1/realtime\",\"defaultModel\":\"grok-voice-think-fast-1.0\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"eve\",\"ara\",\"rex\",\"sal\",\"leo\"],\"defaultVoice\":\"eve\"}},\"validation\":{\"structuredOutputWithAudio\":false}}")
            family_operations["realtime_audio"] = grok_realtime_audio
            openai_family_descriptor["defaultRealtimeModel"] = "grok-voice-think-fast-1.0"
            family_features = _core_get(openai_family_descriptor, "features", None)
            family_media = _core_get(family_features, "media", None)
            grok_audio = _core_json_parse("{\"supported\":true,\"formats\":[\"pcm16\",\"pcm\"],\"output\":{\"supported\":true,\"formats\":[\"pcm16\",\"pcm\"],\"voices\":[\"eve\",\"ara\",\"rex\",\"sal\",\"leo\"]},\"realtime\":true}")
            family_media["audio"] = grok_audio
        else:
            pass
        return openai_family_descriptor
    else:
        pass
    is_responses = _core_eq(provider_id, "openai-responses")
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_anthropic = _core_eq(provider_id, "anthropic")
    descriptor = {}
    operations = {}
    features = {}
    media = {}
    audio = {}
    audio_output = {}
    descriptor["provider"] = provider_id
    features["functions"] = True
    features["streaming"] = True
    features["structured_outputs"] = True
    features["multi_turn"] = True
    features["thinking"] = False
    image_media = _core_json_parse("{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\",\"image/webp\"]}")
    media["images"] = image_media
    if is_responses:
        descriptor["baseUrl"] = "https://api.openai.com/v1"
        descriptor["auth"] = "bearer"
        descriptor["id"] = "openai-responses"
        descriptor["name"] = "openai-responses"
        descriptor["defaultModel"] = "gpt-4o"
        descriptor["defaultEmbedModel"] = "text-embedding-ada-002"
        responses_chat = _core_json_parse("{\"method\":\"POST\",\"path\":\"/responses\",\"body\":\"json\",\"stream\":false}")
        responses_stream = _core_json_parse("{\"method\":\"POST\",\"path\":\"/responses\",\"body\":\"json\",\"stream\":true}")
        responses_embed = _core_json_parse("{\"method\":\"POST\",\"path\":\"/embeddings\",\"body\":\"json\",\"stream\":false}")
        responses_transcribe = _core_json_parse("{\"method\":\"POST\",\"path\":\"/audio/transcriptions\",\"body\":\"multipart\",\"stream\":false}")
        responses_speak = _core_json_parse("{\"method\":\"POST\",\"path\":\"/audio/speech\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"}")
        responses_realtime = _core_json_parse("{\"method\":\"WS\",\"path\":\"/realtime\",\"body\":\"events\",\"stream\":true}")
        responses_realtime_audio = _core_json_parse("{\"method\":\"WS\",\"path\":\"/realtime\",\"url\":\"wss://api.openai.com/v1/realtime\",\"body\":\"events\",\"stream\":true,\"grammar\":\"openai_realtime_compatible\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"alloy\",\"ash\",\"ballad\",\"coral\",\"echo\",\"sage\",\"shimmer\",\"verse\"],\"defaultVoice\":\"alloy\"}},\"validation\":{\"structuredOutputWithAudio\":false}}")
        operations["chat"] = responses_chat
        operations["stream_chat"] = responses_stream
        operations["embed"] = responses_embed
        operations["transcribe"] = responses_transcribe
        operations["speak"] = responses_speak
        operations["realtime"] = responses_realtime
        operations["realtime_audio"] = responses_realtime_audio
        audio["supported"] = True
        audio_formats = _core_json_parse("[\"wav\",\"mp3\",\"pcm16\"]")
        audio["formats"] = audio_formats
        audio_output["supported"] = True
        audio_output["formats"] = audio_formats
    else:
        if is_gemini:
            descriptor["baseUrl"] = "https://generativelanguage.googleapis.com/v1beta"
            descriptor["auth"] = "api_key_query"
            descriptor["apiKeyQuery"] = "key"
            descriptor["id"] = "google-gemini"
            descriptor["name"] = "GoogleGeminiAI"
            descriptor["defaultModel"] = "gemini-2.5-flash"
            descriptor["defaultEmbedModel"] = "gemini-embedding-2"
            gemini_chat = _core_json_parse("{\"method\":\"POST\",\"path\":\"/models/{model}:generateContent\",\"body\":\"json\",\"stream\":false}")
            gemini_stream = _core_json_parse("{\"method\":\"POST\",\"path\":\"/models/{model}:streamGenerateContent?alt=sse\",\"body\":\"json\",\"stream\":true}")
            gemini_embed = _core_json_parse("{\"method\":\"POST\",\"path\":\"/models/{model}:batchEmbedContents\",\"body\":\"json\",\"stream\":false}")
            gemini_transcribe = _core_json_parse("{\"method\":\"POST\",\"path\":\"/models/{model}:generateContent\",\"body\":\"json\",\"stream\":false}")
            gemini_speak = _core_json_parse("{\"method\":\"POST\",\"path\":\"/models/{model}:generateContent\",\"body\":\"json\",\"stream\":false}")
            gemini_realtime_audio = _core_json_parse("{\"method\":\"WS\",\"path\":\"/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent\",\"url\":\"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent\",\"body\":\"events\",\"stream\":true,\"grammar\":\"gemini_live_bidi\",\"defaultModel\":\"gemini-2.5-flash-native-audio-preview-12-2025\",\"audio\":{\"input\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":16000},\"output\":{\"formats\":[\"pcm16\",\"pcm\"],\"sampleRate\":24000,\"voices\":[\"Kore\",\"Puck\",\"Charon\",\"Fenrir\",\"Aoede\"],\"defaultVoice\":\"Kore\"}},\"validation\":{\"pcmInputOnly\":true,\"rejectStructuredOutputWithAudio\":true}}")
            operations["chat"] = gemini_chat
            operations["stream_chat"] = gemini_stream
            operations["embed"] = gemini_embed
            operations["transcribe"] = gemini_transcribe
            operations["speak"] = gemini_speak
            operations["realtime_audio"] = gemini_realtime_audio
            gemini_images = _core_json_parse("{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\",\"image/gif\",\"image/webp\"],\"maxSize\":20971520}")
            media["images"] = gemini_images
            audio["supported"] = True
            gemini_audio_formats = _core_json_parse("[\"wav\",\"mp3\",\"aac\",\"ogg\"]")
            audio["formats"] = gemini_audio_formats
            audio_output["supported"] = True
            gemini_audio_output_formats = _core_json_parse("[\"pcm16\",\"pcm\"]")
            audio_output["formats"] = gemini_audio_output_formats
            gemini_audio_voices = _core_json_parse("[\"Kore\",\"Puck\",\"Charon\",\"Fenrir\",\"Aoede\"]")
            audio_output["voices"] = gemini_audio_voices
            gemini_files = _core_json_parse("{\"supported\":true,\"formats\":[\"application/pdf\",\"text/plain\",\"text/csv\",\"text/html\",\"text/xml\"],\"upload_method\":\"cloud\"}")
            media["files"] = gemini_files
            gemini_urls = _core_json_parse("{\"supported\":true,\"web_search\":true,\"context_fetching\":true}")
            media["urls"] = gemini_urls
            gemini_caching = _core_json_parse("{\"supported\":true,\"types\":[\"persistent\"]}")
            features["caching"] = gemini_caching
            features["thinking"] = True
        else:
            if is_anthropic:
                descriptor["baseUrl"] = "https://api.anthropic.com"
                descriptor["auth"] = "anthropic_key"
                descriptor["id"] = "anthropic"
                descriptor["name"] = "anthropic"
                descriptor["defaultModel"] = "claude-3-7-sonnet-latest"
                extra_headers = _core_json_parse("{\"anthropic-version\":\"2023-06-01\",\"anthropic-beta\":\"structured-outputs-2025-11-13, web-search-2025-03-05\"}")
                descriptor["headers"] = extra_headers
                anthropic_chat = _core_json_parse("{\"method\":\"POST\",\"path\":\"/v1/messages\",\"body\":\"json\",\"stream\":false}")
                anthropic_stream = _core_json_parse("{\"method\":\"POST\",\"path\":\"/v1/messages\",\"body\":\"json\",\"stream\":true}")
                operations["chat"] = anthropic_chat
                operations["stream_chat"] = anthropic_stream
                anthropic_images = _core_json_parse("{\"supported\":true,\"formats\":[\"image/jpeg\",\"image/png\",\"image/gif\",\"image/webp\"]}")
                media["images"] = anthropic_images
                audio["supported"] = False
                empty_anthropic_audio_formats = []
                audio["formats"] = empty_anthropic_audio_formats
                audio_output["supported"] = False
                audio_output["formats"] = empty_anthropic_audio_formats
                anthropic_caching = _core_json_parse("{\"supported\":true,\"types\":[\"ephemeral_block\"]}")
                features["caching"] = anthropic_caching
                features["thinking"] = True
            else:
                descriptor["baseUrl"] = "https://api.openai.com/v1"
                descriptor["auth"] = "bearer"
                descriptor["id"] = "openai-compatible"
                descriptor["name"] = "openai"
                descriptor["defaultModel"] = "gpt-4.1-mini"
                descriptor["defaultEmbedModel"] = "text-embedding-3-small"
                compatible_chat = _core_json_parse("{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":false}")
                compatible_stream = _core_json_parse("{\"method\":\"POST\",\"path\":\"/chat/completions\",\"body\":\"json\",\"stream\":true}")
                compatible_embed = _core_json_parse("{\"method\":\"POST\",\"path\":\"/embeddings\",\"body\":\"json\",\"stream\":false}")
                compatible_transcribe = _core_json_parse("{\"method\":\"POST\",\"path\":\"/audio/transcriptions\",\"body\":\"multipart\",\"stream\":false}")
                compatible_speak = _core_json_parse("{\"method\":\"POST\",\"path\":\"/audio/speech\",\"body\":\"json\",\"stream\":false,\"response\":\"binary\"}")
                operations["chat"] = compatible_chat
                operations["stream_chat"] = compatible_stream
                operations["embed"] = compatible_embed
                operations["transcribe"] = compatible_transcribe
                operations["speak"] = compatible_speak
                audio["supported"] = False
                empty_audio_formats = []
                audio["formats"] = empty_audio_formats
                audio_output["supported"] = False
                audio_output["formats"] = empty_audio_formats
    audio["output"] = audio_output
    media["audio"] = audio
    existing_files = _core_get(media, "files", None)
    has_files = _core_is_not_none(existing_files)
    if has_files:
        pass
    else:
        files_media = _core_json_parse("{\"supported\":false,\"formats\":[],\"upload_method\":\"none\"}")
        media["files"] = files_media
    existing_urls = _core_get(media, "urls", None)
    has_urls = _core_is_not_none(existing_urls)
    if has_urls:
        pass
    else:
        urls_media = _core_json_parse("{\"supported\":false,\"web_search\":false,\"context_fetching\":false}")
        media["urls"] = urls_media
    features["media"] = media
    existing_caching = _core_get(features, "caching", None)
    has_caching = _core_is_not_none(existing_caching)
    if has_caching:
        pass
    else:
        caching = _core_json_parse("{\"supported\":false,\"types\":[]}")
        features["caching"] = caching
    descriptor["operations"] = operations
    descriptor["features"] = features
    return descriptor


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


def _provider_realtime_audio_descriptor(profile: str) -> Any:
    _core_coverage_mark("_provider_realtime_audio_descriptor")
    descriptor = provider_operation_descriptor(profile, "realtime_audio")
    return descriptor


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


def provider_should_use_realtime(profile: str, model: str, request: Any) -> bool:
    _core_coverage_mark("provider_should_use_realtime")
    descriptor = provider_descriptor(profile)
    operations = _core_get(descriptor, "operations", None)
    realtime_op = _core_get(operations, "realtime_audio", None)
    has_realtime = _core_is_not_none(realtime_op)
    is_gpt_realtime = _core_string_starts_with(model, "gpt-realtime")
    is_grok_voice = _core_string_starts_with(model, "grok-voice")
    is_native_audio = _core_contains(model, "native-audio")
    is_dash_live = _core_contains(model, "-live-")
    is_gemini_live = _core_string_starts_with(model, "gemini-live")
    pattern_a = _core_or(is_gpt_realtime, is_grok_voice)
    pattern_b = _core_or(is_native_audio, is_dash_live)
    pattern_ab = _core_or(pattern_a, pattern_b)
    is_realtime_model = _core_or(pattern_ab, is_gemini_live)
    audio = _core_get(request, "audio", None)
    output = _core_get(audio, "output", None)
    enabled = _core_get(output, "enabled", None)
    explicitly_disabled = _core_eq(enabled, False)
    audio_ok = _core_not(explicitly_disabled)
    model_and_realtime = _core_and(has_realtime, is_realtime_model)
    result = _core_and(model_and_realtime, audio_ok)
    return result


def provider_build_realtime_audio_setup(profile: str, request: Any) -> Any:
    _core_coverage_mark("provider_build_realtime_audio_setup")
    descriptor = _provider_realtime_audio_descriptor(profile)
    grammar = _core_get(descriptor, "grammar", "openai_realtime_compatible")
    is_gemini_live = _core_eq(grammar, "gemini_live_bidi")
    if is_gemini_live:
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


def provider_build_chat_request(profile: str, request: AxChatRequest) -> Any:
    _core_coverage_mark("provider_build_chat_request")
    provider_id = provider_normalize_profile(profile)
    is_responses = _core_eq(provider_id, "openai-responses")
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_anthropic = _core_eq(provider_id, "anthropic")
    payload = {}
    if is_responses:
        responses_payload = openai_responses_build_chat_request(request)
        payload = responses_payload
    else:
        if is_gemini:
            gemini_payload = _gemini_build_chat_request(request)
            payload = gemini_payload
        else:
            if is_anthropic:
                anthropic_payload = _anthropic_build_chat_request(request)
                payload = anthropic_payload
            else:
                compatible_payload = openai_build_chat_request(request)
                payload = compatible_payload
    payload_with_quirks = _provider_apply_openai_compatible_profile_quirks(provider_id, payload, request)
    payload = payload_with_quirks
    return payload


def _provider_apply_openai_compatible_profile_quirks(profile: str, payload: Any, request: Any) -> Any:
    _core_coverage_mark("_provider_apply_openai_compatible_profile_quirks")
    empty_map = {}
    model_config = _core_get(request, "model_config", empty_map)
    is_deepseek = _core_eq(profile, "deepseek")
    if is_deepseek:
        payload = _provider_apply_deepseek_chat_quirks(payload, model_config)
    else:
        pass
    is_mistral = _core_eq(profile, "mistral")
    if is_mistral:
        payload = _provider_apply_mistral_chat_quirks(payload)
    else:
        pass
    is_grok = _core_eq(profile, "grok")
    if is_grok:
        payload = _provider_apply_grok_chat_quirks(payload, request, model_config)
    else:
        pass
    return payload


def _provider_apply_deepseek_chat_quirks(payload: Any, model_config: Any) -> Any:
    _core_coverage_mark("_provider_apply_deepseek_chat_quirks")
    model = _core_get(payload, "model", "")
    is_flash = _core_eq(model, "deepseek-v4-flash")
    is_pro = _core_eq(model, "deepseek-v4-pro")
    supports_thinking = _core_or(is_flash, is_pro)
    is_reasoner = _core_eq(model, "deepseek-reasoner")
    unsupported_tool_choice_left = _core_or(supports_thinking, is_reasoner)
    if supports_thinking:
        budget_snake = _core_get(model_config, "thinking_token_budget", None)
        budget = _core_get(model_config, "thinkingTokenBudget", budget_snake)
        reasoning = _core_get(payload, "reasoning_effort", None)
        has_budget = _core_is_not_none(budget)
        has_reasoning = _core_is_not_none(reasoning)
        has_thinking_signal = _core_or(has_budget, has_reasoning)
        budget_is_none = _core_eq(budget, "none")
        reasoning_is_none = _core_eq(reasoning, "none")
        disabled_signal = _core_or(budget_is_none, reasoning_is_none)
        not_disabled_signal = _core_not(disabled_signal)
        thinking_enabled = _core_and(has_thinking_signal, not_disabled_signal)
        thinking = {}
        if thinking_enabled:
            thinking["type"] = "enabled"
            is_xhigh = _core_eq(reasoning, "xhigh")
            budget_is_highest = _core_eq(budget, "highest")
            is_max_effort = _core_or(is_xhigh, budget_is_highest)
            if is_max_effort:
                payload["reasoning_effort"] = "max"
            else:
                is_high = _core_eq(reasoning, "high")
                if is_high:
                    payload["reasoning_effort"] = "high"
                else:
                    payload["reasoning_effort"] = "high"
            _core_map_delete(payload, "temperature")
            _core_map_delete(payload, "top_p")
            _core_map_delete(payload, "presence_penalty")
            _core_map_delete(payload, "frequency_penalty")
        else:
            thinking["type"] = "disabled"
            _core_map_delete(payload, "reasoning_effort")
        payload["thinking"] = thinking
    else:
        pass
    if unsupported_tool_choice_left:
        tool_choice = _core_get(payload, "tool_choice", None)
        choice_none = _core_eq(tool_choice, "none")
        if choice_none:
            _core_map_delete(payload, "tools")
        else:
            pass
        _core_map_delete(payload, "tool_choice")
    else:
        pass
    return payload


def _provider_apply_mistral_chat_quirks(payload: Any) -> Any:
    _core_coverage_mark("_provider_apply_mistral_chat_quirks")
    max_completion = _core_get(payload, "max_completion_tokens", None)
    has_max_completion = _core_is_not_none(max_completion)
    if has_max_completion:
        payload["max_tokens"] = max_completion
        _core_map_delete(payload, "max_completion_tokens")
    else:
        pass
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


def _provider_apply_grok_chat_quirks(payload: Any, request: Any, model_config: Any) -> Any:
    _core_coverage_mark("_provider_apply_grok_chat_quirks")
    model = _core_get(payload, "model", "")
    is_grok43 = _core_eq(model, "grok-4.3")
    is_grok43_latest = _core_eq(model, "grok-4.3-latest")
    is_grok43_any = _core_or(is_grok43, is_grok43_latest)
    if is_grok43_any:
        budget_snake = _core_get(model_config, "thinking_token_budget", None)
        budget = _core_get(model_config, "thinkingTokenBudget", budget_snake)
        has_budget = _core_is_not_none(budget)
        if has_budget:
            is_none = _core_eq(budget, "none")
            is_minimal = _core_eq(budget, "minimal")
            is_low = _core_eq(budget, "low")
            is_medium = _core_eq(budget, "medium")
            is_high = _core_eq(budget, "high")
            is_highest = _core_eq(budget, "highest")
            lowish = _core_or(is_minimal, is_low)
            highish = _core_or(is_high, is_highest)
            if is_none:
                payload["reasoning_effort"] = "none"
            else:
                if lowish:
                    payload["reasoning_effort"] = "low"
                else:
                    if is_medium:
                        payload["reasoning_effort"] = "medium"
                    else:
                        if highish:
                            payload["reasoning_effort"] = "high"
                        else:
                            pass
        else:
            pass
        _core_map_delete(payload, "presence_penalty")
        _core_map_delete(payload, "frequency_penalty")
        _core_map_delete(payload, "stop")
    else:
        _core_map_delete(payload, "reasoning_effort")
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


def provider_build_embed_request(profile: str, request: AxEmbedRequest) -> Any:
    _core_coverage_mark("provider_build_embed_request")
    provider_id = provider_normalize_profile(profile)
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_anthropic = _core_eq(provider_id, "anthropic")
    payload = {}
    if is_gemini:
        gemini_payload = _gemini_build_embed_request(request)
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
    is_responses = _core_eq(provider_id, "openai-responses")
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_anthropic = _core_eq(provider_id, "anthropic")
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
                compatible_response = openai_normalize_chat_response(raw, ai_name, model)
                response = compatible_response
    return response


def provider_normalize_stream_delta(profile: str, raw: Any, state: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("provider_normalize_stream_delta")
    provider_id = provider_normalize_profile(profile)
    is_responses = _core_eq(provider_id, "openai-responses")
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_anthropic = _core_eq(provider_id, "anthropic")
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
                compatible_response = openai_normalize_stream_delta(raw, state, ai_name, model)
                response = compatible_response
    return response


def provider_classify_stream_error_status(profile: str, event: Any) -> Any:
    _core_coverage_mark("provider_classify_stream_error_status")
    provider_id = provider_normalize_profile(profile)
    none = _core_none()
    status = none
    is_anthropic = _core_eq(provider_id, "anthropic")
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
    is_gemini = _core_eq(provider_id, "google-gemini")
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
    is_responses = _core_eq(provider_id, "openai-responses")
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_grok = _core_eq(provider_id, "grok")
    payload = {}
    if is_gemini:
        gemini_payload = _gemini_build_transcribe_request(request)
        payload = gemini_payload
    else:
        if is_grok:
            grok_payload = _grok_build_transcribe_request(request)
            payload = grok_payload
        else:
            responses_payload = openai_responses_build_transcribe_request(request)
            payload = responses_payload
    return payload


def provider_build_speak_request(profile: str, request: Any) -> Any:
    _core_coverage_mark("provider_build_speak_request")
    provider_id = provider_normalize_profile(profile)
    is_responses = _core_eq(provider_id, "openai-responses")
    is_gemini = _core_eq(provider_id, "google-gemini")
    is_grok = _core_eq(provider_id, "grok")
    payload = {}
    if is_gemini:
        gemini_payload = _gemini_build_speak_request(request)
        payload = gemini_payload
    else:
        if is_grok:
            grok_payload = _grok_build_speak_request(request)
            payload = grok_payload
        else:
            responses_payload = openai_responses_build_speak_request(request)
            payload = responses_payload
    return payload


def provider_normalize_transcribe_response(profile: str, raw: Any) -> Any:
    _core_coverage_mark("provider_normalize_transcribe_response")
    provider_id = provider_normalize_profile(profile)
    is_gemini = _core_eq(provider_id, "google-gemini")
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
    is_gemini = _core_eq(provider_id, "google-gemini")
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
        tool_choice = _core_get(request, "function_call", "auto")
        payload["tool_choice"] = tool_choice
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
    _openai_responses_apply_model_config_impl(payload, model_config)
    reasoning = _core_get(model_config, "reasoning", None)
    has_reasoning = _core_truthy(reasoning)
    if has_reasoning:
        payload["reasoning"] = reasoning
    else:
        pass
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


def _openai_responses_input_item_impl(message: Any) -> Any:
    _core_coverage_mark("_openai_responses_input_item_impl")
    role = _core_get(message, "role", None)
    is_function = _core_eq(role, "function")
    if is_function:
        message_id = _core_get(message, "id", None)
        message_content = _core_get(message, "content", None)
        call_id = _core_get(message, "function_call_id", message_id)
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
    usage = _core_get(raw, "usage", None)
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
        call = _openai_responses_function_call_impl(item)
        calls = []
        calls.append(call)
        result["function_calls"] = calls
        result["finish_reason"] = "function_call"
    else:
        pass
    return None


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
        usage = _core_get(event_response, "usage", None)
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


def _gemini_build_chat_request(request: AxChatRequest) -> Any:
    _core_coverage_mark("_gemini_build_chat_request")
    payload = {}
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
    generation_config = {}
    generation_config["candidateCount"] = 1
    generation_config["responseMimeType"] = "text/plain"
    empty_model_config = {}
    model_config = _core_get(request, "model_config", empty_model_config)
    _gemini_apply_model_config_impl(generation_config, model_config)
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
    model = _core_get(request, "model", "gemini-2.5-flash")
    is_gemini3 = _core_string_starts_with(model, "gemini-3")
    if is_gemini3:
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


def _gemini_apply_model_config_impl(payload: Any, model_config: Any) -> None:
    _core_coverage_mark("_gemini_apply_model_config_impl")
    _openai_copy_config_key_impl(payload, model_config, "maxTokens", "maxOutputTokens")
    _openai_copy_config_key_impl(payload, model_config, "max_tokens", "maxOutputTokens")
    _openai_copy_config_key_impl(payload, model_config, "temperature", "temperature")
    _openai_copy_config_key_impl(payload, model_config, "topP", "topP")
    _openai_copy_config_key_impl(payload, model_config, "top_p", "topP")
    _openai_copy_config_key_impl(payload, model_config, "topK", "topK")
    _openai_copy_config_key_impl(payload, model_config, "top_k", "topK")
    _openai_copy_config_key_impl(payload, model_config, "frequencyPenalty", "frequencyPenalty")
    _openai_copy_config_key_impl(payload, model_config, "frequency_penalty", "frequencyPenalty")
    _openai_copy_config_key_impl(payload, model_config, "n", "candidateCount")
    _openai_copy_config_key_impl(payload, model_config, "stopSequences", "stopSequences")
    _openai_copy_config_key_impl(payload, model_config, "stop_sequences", "stopSequences")
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
        requests.append(item)
    payload["requests"] = requests
    return payload


def _gemini_normalize_chat_response(raw: Any, ai_name: str, model: str) -> AxChatResponse:
    _core_coverage_mark("_gemini_normalize_chat_response")
    empty_candidates = []
    candidates = _core_get(raw, "candidates", empty_candidates)
    results = []
    maps_widget_token = _core_none()
    for candidate in candidates:
        result = {}
        result["index"] = 0
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
    if isinstance(raw, list):
        for item in raw:
            if item != "[DONE]":
                yield item
        return
    text = raw.decode() if isinstance(raw, bytes) else str(raw)
    # Mirror src/ax/util/sse.ts: normalize CRLF/CR, then fold the data: lines of
    # each event (events are blank-line separated) into a single payload before
    # parsing. A spec-legal SSE event may split one JSON value across several
    # data: lines, joined with "\n"; parsing each line on its own would choke.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    buffer = ""

    def flush(payload: str):
        payload = payload.strip()
        if not payload or payload == "[DONE]":
            return None
        return json.loads(payload)

    for line in text.split("\n"):
        if line == "":
            event = flush(buffer)
            buffer = ""
            if event is not None:
                yield event
            continue
        if line.startswith(":"):
            continue  # comment line
        field, sep, value = line.partition(":")
        if sep:
            field = field.strip()
            value = value.strip()
            if field != "data":
                continue  # event:/id:/retry: do not contribute to the payload
        else:
            value = line.strip()
        buffer += ("\n" if buffer and not buffer.endswith("\n") else "") + value
    event = flush(buffer)
    if event is not None:
        yield event
