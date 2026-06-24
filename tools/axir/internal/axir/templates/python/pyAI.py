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
# AXIR_CORE_IMPORTS


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
            return self._stream_chat(payload, request)
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
        yield from self._stream_chat(payload, req)

    def _embed(self, request: dict[str, Any], options: dict[str, Any]):
        payload = provider_build_embed_request(self.profile, request)
        model = request.get("embed_model") or request.get("embedModel") or payload.get("model") or self.embed_model
        endpoint = self._operation_path("embed", model)
        raw = self._request_json(endpoint, payload, stream=False)
        return provider_normalize_embed_response(self.profile, raw, self.name, model)

    def _stream_chat(self, payload: dict[str, Any], request: dict[str, Any]):
        model = request.get("model") or payload.get("model") or self.model
        endpoint = self._operation_path("stream_chat", model)
        raw = self._request_json(endpoint, payload, stream=True)
        state: dict[str, Any] = {}
        for event in _iter_sse_json(raw):
            yield provider_normalize_stream_delta(self.profile, event, state, self.name, model)

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
        return getattr(exc, "status", None) in {408, 429, 500, 502, 503, 504}
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


# AXIR_CORE_AI_FUNCTIONS

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
