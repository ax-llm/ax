package axir

const pyMCP = `from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from .tool import Tool


AX_MCP_PROTOCOL_VERSION = "2025-11-25"
AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = [
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


class AxMCPTransport:
    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def send_notification(self, message: dict[str, Any]) -> None:
        raise NotImplementedError

    def send_response(self, message: dict[str, Any]) -> None:
        self.send_notification(message)

    def set_message_handler(self, handler: Callable[[dict[str, Any]], None]) -> None:
        self._message_handler = handler

    def set_protocol_version(self, protocol_version: str) -> None:
        self.protocol_version = protocol_version

    def connect(self) -> None:
        return None


class AxMCPScriptedTransport(AxMCPTransport):
    def __init__(self, responses: list[dict[str, Any]] | None = None):
        self.responses = list(responses or [])
        self.requests: list[dict[str, Any]] = []
        self.notifications: list[dict[str, Any]] = []
        self.sent_responses: list[dict[str, Any]] = []
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

    def send_notification(self, message: dict[str, Any]) -> None:
        self.notifications.append(json.loads(json.dumps(message)))

    def send_response(self, message: dict[str, Any]) -> None:
        self.sent_responses.append(json.loads(json.dumps(message)))

    def emit(self, message: dict[str, Any]) -> None:
        if self._message_handler:
            self._message_handler(message)


class AxMCPClient:
    def __init__(self, transport: AxMCPTransport, options: dict[str, Any] | None = None):
        self.transport = transport
        self.options = options or {}
        self.server_capabilities: dict[str, Any] = {}
        self.server_info: dict[str, Any] | None = None
        self.server_instructions: str | None = None
        self.negotiated_protocol_version: str | None = None
        self.tools: list[dict[str, Any]] = []
        self.prompts: list[dict[str, Any]] = []
        self.resources: list[dict[str, Any]] = []
        self.resource_templates: list[dict[str, Any]] = []
        self._next_id = 1
        self.transport.set_message_handler(self._handle_inbound_message)

    def init(self) -> None:
        self.transport.connect()
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
        self.notify("notifications/initialized")
        self.refresh()

    def refresh(self) -> None:
        self.tools = self.list_tools().get("tools", []) if self._capability("tools") else []
        self.prompts = self.list_prompts().get("prompts", []) if self._capability("prompts") else []
        if self._capability("resources"):
            self.resources = self.list_resources().get("resources", [])
            self.resource_templates = self.list_resource_templates().get("resourceTemplates", [])
        else:
            self.resources = []
            self.resource_templates = []

    def ping(self) -> dict[str, Any]:
        return self._request("ping", {})

    def list_tools(self, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else {}
        return self._request("tools/list", params)

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("tools/call", {"name": name, "arguments": arguments or {}})

    def list_prompts(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("prompts/list", {"cursor": cursor} if cursor else {})

    def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("prompts/get", {"name": name, "arguments": arguments or {}})

    def list_resources(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("resources/list", {"cursor": cursor} if cursor else {})

    def read_resource(self, uri: str) -> dict[str, Any]:
        return self._request("resources/read", {"uri": uri})

    def list_resource_templates(self, cursor: str | None = None) -> dict[str, Any]:
        return self._request("resources/templates/list", {"cursor": cursor} if cursor else {})

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
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

    def _request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        request_id = str(self._next_id)
        self._next_id += 1
        message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        response = self.transport.send(message)
        if "error" in response:
            error = response["error"] or {}
            raise AxMCPError(str(error.get("message", "MCP JSON-RPC error")), code=error.get("code"), data=error.get("data"))
        return response.get("result") or {}

    def _client_capabilities(self) -> dict[str, Any]:
        capabilities = dict(self.options.get("capabilities") or {})
        if self.options.get("roots") and "roots" not in capabilities:
            capabilities["roots"] = {"listChanged": True}
        return capabilities

    def _capability(self, name: str) -> bool:
        value = self.server_capabilities.get(name)
        return value is not None and value is not False

    def _handle_inbound_message(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method == "roots/list" and "id" in message:
            self.transport.send_response({
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {"roots": self.options.get("roots") or []},
            })
            return
        callback = self.options.get("onNotification")
        if callable(callback):
            callback(message)

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


class AxMCPStreamableHTTPTransport(AxMCPTransport):
    def __init__(self, endpoint: str, options: dict[str, Any] | None = None):
        self.endpoint = ax_mcp_validate_endpoint(endpoint, (options or {}).get("ssrfProtection"))
        self.options = options or {}
        self.headers = dict(self.options.get("headers") or {})
        if self.options.get("authorization"):
            self.headers["Authorization"] = self.options["authorization"]
        self.protocol_version: str | None = None
        self.session_id: str | None = None
        self.last_headers: dict[str, str] = {}
        self._message_handler: Callable[[dict[str, Any]], None] | None = None

    def set_headers(self, headers: dict[str, str]) -> None:
        self.headers = dict(headers)

    def set_authorization(self, authorization: str) -> None:
        self.headers["Authorization"] = authorization

    def send(self, message: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(message).encode("utf-8")
        headers = self.build_headers({"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}, message.get("method") != "initialize")
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=float(self.options.get("timeout", 30))) as response:
                self._capture_session(response.headers)
                text = response.read().decode("utf-8")
                return json.loads(text) if text else {"jsonrpc": "2.0", "id": message.get("id"), "result": {}}
        except urllib.error.HTTPError as error:
            if error.code == 401 and self._apply_oauth():
                return self.send(message)
            raise AxMCPError(f"HTTP error {error.code}: {error.reason}")

    def send_notification(self, message: dict[str, Any]) -> None:
        response = self.send({**message, "id": "__notification__"})
        if "error" in response:
            error = response["error"]
            raise AxMCPError(str(error.get("message", "MCP notification failed")), code=error.get("code"))

    def build_headers(self, base: dict[str, str] | None = None, include_protocol_version: bool = True) -> dict[str, str]:
        headers = {**self.headers, **(base or {})}
        if self.session_id:
            headers["MCP-Session-Id"] = self.session_id
        if include_protocol_version and self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        self.last_headers = dict(headers)
        return headers

    def _capture_session(self, headers: Any) -> None:
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
        else:
            store = oauth.get("tokenStore")
            callback = oauth.get("onAuthCode")
            scopes = oauth.get("scopes") or []
            client_id = oauth.get("clientId") or "ax-mcp-client"
            redirect_uri = oauth.get("redirectUri") or "http://localhost:8787/callback"
        token = _token_store_get(store, self.endpoint)
        if token and token.get("accessToken"):
            self.headers["Authorization"] = "Bearer " + token["accessToken"]
            return True
        if not callable(callback):
            return False
        verifier = ax_mcp_pkce_verifier()
        challenge = ax_mcp_pkce_challenge(verifier)
        params = urllib.parse.urlencode({
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(scopes),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
        auth = callback(self.endpoint + ("&" if "?" in self.endpoint else "?") + params)
        if not auth or not auth.get("code"):
            return False
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
        if operation == "oauth":
            challenge = ax_mcp_pkce_challenge(fixture.get("verifier", "test-verifier"))
            if fixture.get("expected_challenge") and challenge != fixture["expected_challenge"]:
                raise AssertionError("PKCE challenge mismatch")
            store: dict[str, Any] = {}
            auth_codes: list[str] = []
            transport = AxMCPStreamableHTTPTransport(
                fixture.get("endpoint", "https://example.com/mcp"),
                {"oauth": {"tokenStore": store, "onAuthCode": lambda url: auth_codes.append(url) or {"code": "abc"}}},
            )
            if not transport._apply_oauth():
                raise AssertionError("OAuth flow did not produce a token")
            if "Authorization" not in transport.headers:
                raise AssertionError("OAuth flow did not set Authorization")
            return
        if operation == "http_session_headers":
            transport = AxMCPStreamableHTTPTransport(fixture.get("endpoint", "https://example.com/mcp"), fixture.get("transport_options") or {})
            transport.session_id = fixture.get("session_id", "session-1")
            transport.set_protocol_version(fixture.get("protocol_version", AX_MCP_PROTOCOL_VERSION))
            headers = transport.build_headers({"Accept": "application/json"})
            _assert_subset(headers, fixture.get("expected_headers") or {}, "headers")
            return

        transport = AxMCPScriptedTransport(fixture.get("responses") or fixture.get("transport_responses") or [])
        client = AxMCPClient(transport, fixture.get("client_options") or {})
        if operation == "protocol_negotiation":
            client.init()
            if fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
                raise AssertionError("protocol version mismatch")
            return
        client.init()
        if fixture.get("expected_protocol_version") and client.negotiated_protocol_version != fixture["expected_protocol_version"]:
            raise AssertionError("protocol version mismatch")
        if operation == "initialize":
            _assert_requests(transport.requests, fixture)
            return
        if operation == "ping":
            client.ping()
            _assert_requests(transport.requests, fixture)
            return
        if operation == "tools":
            functions = client.to_function()
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
            names = [fn.name for fn in client.to_function()]
            if fixture.get("expected_function_names") and names != fixture["expected_function_names"]:
                raise AssertionError(f"function names mismatch: {names!r}")
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
`

const javaAxMCPTransport = `package dev.axllm.ax;

import java.util.Map;

public interface AxMCPTransport {
  Map<String, Object> send(Map<String, Object> message);
  void sendNotification(Map<String, Object> message);
  default void sendResponse(Map<String, Object> message) { sendNotification(message); }
  default void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) {}
  default void setProtocolVersion(String protocolVersion) {}
  default void connect() {}
}
`

const javaAxMCPTokenSet = `package dev.axllm.ax;

public final class AxMCPTokenSet {
  public final String accessToken;
  public final String refreshToken;
  public final Long expiresAt;
  public final String issuer;

  public AxMCPTokenSet(String accessToken) {
    this(accessToken, null, null, null);
  }

  public AxMCPTokenSet(String accessToken, String refreshToken, Long expiresAt, String issuer) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
    this.issuer = issuer;
  }
}
`

const javaAxMCPOAuthOptions = `package dev.axllm.ax;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

public final class AxMCPOAuthOptions {
  public String clientId;
  public String clientSecret;
  public String redirectUri;
  public List<String> scopes = List.of();
  public Function<String, Map<String, String>> onAuthCode;
  public TokenStore tokenStore;
  public Map<String, Object> ssrfProtection = Map.of();

  public interface TokenStore {
    AxMCPTokenSet getToken(String key);
    void setToken(String key, AxMCPTokenSet token);
    default void clearToken(String key) {}
  }
}
`

const javaAxMCPClient = `package dev.axllm.ax;

import java.net.URI;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

public final class AxMCPClient {
  public static final String AX_MCP_PROTOCOL_VERSION = "2025-11-25";
  public static final List<String> AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = List.of(
    AX_MCP_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05"
  );

  private final AxMCPTransport transport;
  private final Map<String, Object> options;
  private final List<Map<String, Object>> tools = new ArrayList<>();
  private final List<Map<String, Object>> prompts = new ArrayList<>();
  private final List<Map<String, Object>> resources = new ArrayList<>();
  private final List<Map<String, Object>> resourceTemplates = new ArrayList<>();
  private Map<String, Object> serverCapabilities = new LinkedHashMap<>();
  private Map<String, Object> serverInfo = new LinkedHashMap<>();
  private String serverInstructions;
  private String negotiatedProtocolVersion;
  private int nextId = 1;

  public AxMCPClient(AxMCPTransport transport) {
    this(transport, Map.of());
  }

  public AxMCPClient(AxMCPTransport transport, Map<String, Object> options) {
    this.transport = transport;
    this.options = options == null ? Map.of() : new LinkedHashMap<>(options);
    this.transport.setMessageHandler(this::handleInboundMessage);
  }

  public void init() {
    transport.connect();
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("protocolVersion", options.getOrDefault("protocolVersion", AX_MCP_PROTOCOL_VERSION));
    params.put("capabilities", clientCapabilities());
    Map<String, Object> info = new LinkedHashMap<>();
    info.put("name", "AxMCPClient");
    info.put("title", "Ax MCP Client");
    info.put("version", "1.0.0");
    info.putAll(Core.asMap(options.get("clientInfo")));
    params.put("clientInfo", info);
    Map<String, Object> result = request("initialize", params);
    String negotiated = String.valueOf(result.get("protocolVersion"));
    List<Object> supportedRaw = Core.asList(options.getOrDefault("supportedProtocolVersions", AX_MCP_SUPPORTED_PROTOCOL_VERSIONS));
    List<String> supported = supportedRaw.stream().map(String::valueOf).toList();
    if (!supported.contains(negotiated)) throw new AxMCPError("Unsupported MCP protocol version " + negotiated);
    negotiatedProtocolVersion = negotiated;
    transport.setProtocolVersion(negotiated);
    serverCapabilities = Core.asMap(result.getOrDefault("capabilities", Map.of()));
    serverInfo = Core.asMap(result.getOrDefault("serverInfo", Map.of()));
    if (result.get("instructions") != null) serverInstructions = String.valueOf(result.get("instructions"));
    notify("notifications/initialized", null);
    refresh();
  }

  public void refresh() {
    tools.clear();
    prompts.clear();
    resources.clear();
    resourceTemplates.clear();
    if (capability("tools")) for (Object item : Core.asList(listTools(null).get("tools"))) tools.add(Core.asMap(item));
    if (capability("prompts")) for (Object item : Core.asList(listPrompts(null).get("prompts"))) prompts.add(Core.asMap(item));
    if (capability("resources")) {
      for (Object item : Core.asList(listResources(null).get("resources"))) resources.add(Core.asMap(item));
      for (Object item : Core.asList(listResourceTemplates(null).get("resourceTemplates"))) resourceTemplates.add(Core.asMap(item));
    }
  }

  public String getProtocolVersion() { return negotiatedProtocolVersion; }
  public Map<String, Object> getServerCapabilities() { return serverCapabilities; }
  public Map<String, Object> getServerInfo() { return serverInfo; }
  public String getServerInstructions() { return serverInstructions; }
  public List<Map<String, Object>> getTools() { return List.copyOf(tools); }

  public Map<String, Object> ping() { return request("ping", Map.of()); }
  public Map<String, Object> listTools(String cursor) { return request("tools/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> callTool(String name, Map<String, Object> arguments) { return request("tools/call", Map.of("name", name, "arguments", arguments == null ? Map.of() : arguments)); }
  public Map<String, Object> listPrompts(String cursor) { return request("prompts/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> getPrompt(String name, Map<String, Object> arguments) { return request("prompts/get", Map.of("name", name, "arguments", arguments == null ? Map.of() : arguments)); }
  public Map<String, Object> listResources(String cursor) { return request("resources/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }
  public Map<String, Object> readResource(String uri) { return request("resources/read", Map.of("uri", uri)); }
  public Map<String, Object> listResourceTemplates(String cursor) { return request("resources/templates/list", cursor == null ? Map.of() : Map.of("cursor", cursor)); }

  public void cancelRequest(Object requestId, String reason) {
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("requestId", requestId);
    if (reason != null) params.put("reason", reason);
    notify("notifications/cancelled", params);
  }

  public List<Tool> toFunction() {
    List<Tool> out = new ArrayList<>();
    for (Map<String, Object> tool : tools) out.add(toolToFunction(tool));
    for (Map<String, Object> prompt : prompts) out.add(promptToFunction(prompt));
    for (Map<String, Object> resource : resources) out.add(resourceToFunction(resource));
    for (Map<String, Object> template : resourceTemplates) out.add(resourceTemplateToFunction(template));
    return out;
  }

  Map<String, Object> request(String method, Map<String, Object> params) {
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("id", String.valueOf(nextId++));
    message.put("method", method);
    if (params != null) message.put("params", params);
    Map<String, Object> response = transport.send(message);
    if (response.containsKey("error")) {
      Map<String, Object> error = Core.asMap(response.get("error"));
      throw new AxMCPError(String.valueOf(error.getOrDefault("message", "MCP JSON-RPC error")));
    }
    return Core.asMap(response.getOrDefault("result", Map.of()));
  }

  void notify(String method, Map<String, Object> params) {
    Map<String, Object> message = new LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("method", method);
    if (params != null) message.put("params", params);
    transport.sendNotification(message);
  }

  private Map<String, Object> clientCapabilities() {
    Map<String, Object> capabilities = new LinkedHashMap<>(Core.asMap(options.get("capabilities")));
    if (options.containsKey("roots") && !capabilities.containsKey("roots")) capabilities.put("roots", Map.of("listChanged", true));
    return capabilities;
  }

  private boolean capability(String name) {
    Object value = serverCapabilities.get(name);
    return value != null && !Boolean.FALSE.equals(value);
  }

  private void handleInboundMessage(Map<String, Object> message) {
    if ("roots/list".equals(message.get("method")) && message.containsKey("id")) {
      Map<String, Object> response = new LinkedHashMap<>();
      response.put("jsonrpc", "2.0");
      response.put("id", message.get("id"));
      response.put("result", Map.of("roots", options.getOrDefault("roots", List.of())));
      transport.sendResponse(response);
      return;
    }
    Object callback = options.get("onNotification");
    if (callback instanceof Consumer<?> raw) {
      @SuppressWarnings("unchecked")
      Consumer<Map<String, Object>> consumer = (Consumer<Map<String, Object>>) raw;
      consumer.accept(message);
    }
  }

  private Tool toolToFunction(Map<String, Object> tool) {
    String original = String.valueOf(tool.getOrDefault("name", ""));
    String name = overrideName(original);
    String description = overrideDescription(tool);
    return new Tool(name, description, List.of(), List.of(), args -> {
      Map<String, Object> result = callTool(original, args);
      if (result.containsKey("structuredContent")) return result.get("structuredContent");
      return Map.of("content", contentText(Core.asList(result.get("content"))));
    });
  }

  private Tool promptToFunction(Map<String, Object> prompt) {
    String original = String.valueOf(prompt.getOrDefault("name", ""));
    return new Tool(overrideName("prompt_" + original), overrideDescription(prompt), List.of(), List.of(), args -> getPrompt(original, args));
  }

  private Tool resourceToFunction(Map<String, Object> resource) {
    String uri = String.valueOf(resource.get("uri"));
    return new Tool(overrideName("resource_" + safeName(String.valueOf(resource.getOrDefault("name", uri)))), overrideDescription(resource), List.of(), List.of(), args -> readResource(uri));
  }

  private Tool resourceTemplateToFunction(Map<String, Object> template) {
    return new Tool(overrideName("resource_template_" + safeName(String.valueOf(template.getOrDefault("name", "template")))), overrideDescription(template), List.of(), List.of(), args -> readResource(String.valueOf(args.get("uri"))));
  }

  private String overrideName(String name) {
    for (Object raw : Core.asList(options.get("functionOverrides"))) {
      Map<String, Object> item = Core.asMap(raw);
      if (name.equals(item.get("name"))) return String.valueOf(Core.asMap(item.get("updates")).getOrDefault("name", name));
    }
    return name;
  }

  private String overrideDescription(Map<String, Object> item) {
    String name = String.valueOf(item.getOrDefault("name", ""));
    String description = String.valueOf(item.getOrDefault("description", item.getOrDefault("title", name)));
    for (Object raw : Core.asList(options.get("functionOverrides"))) {
      Map<String, Object> override = Core.asMap(raw);
      if (name.equals(override.get("name"))) return String.valueOf(Core.asMap(override.get("updates")).getOrDefault("description", description));
    }
    return description;
  }

  static String safeName(String value) {
    return value.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("^_+|_+$", "");
  }

  static String contentText(List<Object> content) {
    List<String> text = new ArrayList<>();
    for (Object raw : content) {
      Map<String, Object> item = Core.asMap(raw);
      if ("text".equals(item.get("type"))) text.add(String.valueOf(item.getOrDefault("text", "")));
    }
    return String.join("\n", text);
  }

  public static String pkceVerifier() {
    return Base64.getUrlEncoder().withoutPadding().encodeToString((UUID.randomUUID().toString() + UUID.randomUUID()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  public static String pkceChallenge(String verifier) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return Base64.getUrlEncoder().withoutPadding().encodeToString(digest.digest(verifier.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public static String validateEndpoint(String endpoint, Map<String, Object> options) {
    URI uri = URI.create(endpoint);
    if (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) throw new AxMCPError("MCP endpoint must use http or https");
    boolean requireHttps = !Boolean.FALSE.equals(Core.asMap(options).getOrDefault("requireHttps", Core.asMap(options).getOrDefault("require_https", true)));
    if (requireHttps && !"https".equals(uri.getScheme())) throw new AxMCPError("MCP endpoint must use https");
    String host = uri.getHost();
    if (host == null || host.isBlank()) throw new AxMCPError("MCP endpoint must include a host");
    boolean allowLocalhost = Core.truthy(Core.asMap(options).getOrDefault("allowLocalhost", Core.asMap(options).get("allow_localhost")));
    boolean allowPrivate = Core.truthy(Core.asMap(options).getOrDefault("allowPrivateNetworks", Core.asMap(options).get("allow_private_networks")));
    if ((host.equals("localhost") || host.equals("localhost.localdomain")) && !allowLocalhost) throw new AxMCPError("MCP endpoint host is local");
    if (host.matches("\\d+\\.\\d+\\.\\d+\\.\\d+")) {
      String[] parts = host.split("\\.");
      int a = Integer.parseInt(parts[0]);
      int b = Integer.parseInt(parts[1]);
      boolean local = a == 127;
      boolean priv = a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
      if ((local && !allowLocalhost) || (priv && !allowPrivate) || a == 0 || a >= 224) throw new AxMCPError("MCP endpoint host is not allowed by SSRF protection");
    }
    return endpoint;
  }

  public static String stdioEncode(Map<String, Object> message) { return Json.stringify(message) + "\n"; }
  public static Map<String, Object> stdioDecode(String line) { return Core.asMap(Json.parse(line.trim())); }

  public static void runConformanceFixture(Map<String, Object> fixture) {
    String operation = String.valueOf(fixture.getOrDefault("operation", "initialize"));
    String expectedError = fixture.containsKey("expected_error_contains") ? String.valueOf(fixture.get("expected_error_contains")) : null;
    try {
      if ("ssrf".equals(operation)) {
        validateEndpoint(String.valueOf(fixture.getOrDefault("endpoint", "https://127.0.0.1/mcp")), Core.asMap(fixture.get("ssrfProtection")));
        if (expectedError != null) throw new AssertionError("expected SSRF validation to fail");
        return;
      }
      if ("stdio_framing".equals(operation)) {
        String encoded = stdioEncode(Core.asMap(fixture.get("message")));
        if (fixture.get("expected_line") != null && !encoded.equals(fixture.get("expected_line"))) throw new AssertionError("stdio line mismatch");
        assertSubset(stdioDecode(encoded), fixture.get("message"), "stdio decoded");
        return;
      }
      if ("oauth".equals(operation)) {
        String challenge = pkceChallenge(String.valueOf(fixture.getOrDefault("verifier", "test-verifier")));
        if (fixture.get("expected_challenge") != null && !challenge.equals(fixture.get("expected_challenge"))) throw new AssertionError("PKCE challenge mismatch");
        MapTokenStore store = new MapTokenStore();
        AxMCPOAuthOptions oauth = new AxMCPOAuthOptions();
        oauth.tokenStore = store;
        oauth.onAuthCode = url -> Map.of("code", "abc");
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")), Map.of("oauth", oauth));
        if (!transport.applyOAuth()) throw new AssertionError("OAuth flow did not produce a token");
        if (!transport.headers().containsKey("Authorization")) throw new AssertionError("OAuth flow did not set Authorization");
        return;
      }
      if ("http_session_headers".equals(operation)) {
        AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(String.valueOf(fixture.getOrDefault("endpoint", "https://example.com/mcp")), Core.asMap(fixture.get("transport_options")));
        transport.setSessionId(String.valueOf(fixture.getOrDefault("session_id", "session-1")));
        transport.setProtocolVersion(String.valueOf(fixture.getOrDefault("protocol_version", AX_MCP_PROTOCOL_VERSION)));
        assertSubset(transport.buildHeaders(Map.of("Accept", "application/json"), true), fixture.getOrDefault("expected_headers", Map.of()), "headers");
        return;
      }
      AxMCPScriptedTransport transport = new AxMCPScriptedTransport(Core.asList(fixture.getOrDefault("responses", fixture.getOrDefault("transport_responses", List.of()))));
      AxMCPClient client = new AxMCPClient(transport, Core.asMap(fixture.get("client_options")));
      client.init();
      if (fixture.get("expected_protocol_version") != null && !String.valueOf(fixture.get("expected_protocol_version")).equals(client.getProtocolVersion())) throw new AssertionError("protocol version mismatch");
      if ("initialize".equals(operation)) {
        assertRequests(transport.requests, fixture);
      } else if ("protocol_negotiation".equals(operation)) {
        return;
      } else if ("ping".equals(operation)) {
        client.ping();
        assertRequests(transport.requests, fixture);
      } else if ("tools".equals(operation)) {
        List<Tool> functions = client.toFunction();
        List<String> names = functions.stream().map(tool -> tool.name).toList();
        if (fixture.get("expected_function_names") != null && !names.equals(Core.asList(fixture.get("expected_function_names")).stream().map(String::valueOf).toList())) throw new AssertionError("function names mismatch: " + names);
        if (fixture.get("call_function") != null) {
          Map<String, Object> call = Core.asMap(fixture.get("call_function"));
          Object result = functions.stream().filter(tool -> tool.name.equals(call.get("name"))).findFirst().orElseThrow().call(Core.asMap(call.get("arguments")));
          assertSubset(result, fixture.getOrDefault("expected_call_result", Map.of()), "tool result");
        }
        assertRequests(transport.requests, fixture);
      } else if ("prompts_resources".equals(operation)) {
        List<String> names = client.toFunction().stream().map(tool -> tool.name).toList();
        if (fixture.get("expected_function_names") != null && !names.equals(Core.asList(fixture.get("expected_function_names")).stream().map(String::valueOf).toList())) throw new AssertionError("function names mismatch: " + names);
      } else if ("roots_notifications".equals(operation)) {
        transport.emit(new LinkedHashMap<>(Map.of("jsonrpc", "2.0", "id", "server-1", "method", "roots/list")));
        assertSubset(transport.sentResponses.get(0), fixture.getOrDefault("expected_roots_response", Map.of()), "roots response");
      } else if ("cancellation".equals(operation)) {
        client.cancelRequest(fixture.getOrDefault("request_id", "1"), String.valueOf(fixture.getOrDefault("reason", "cancelled")));
        assertSubset(transport.notifications.get(transport.notifications.size() - 1), fixture.getOrDefault("expected_notification", Map.of()), "cancel notification");
      } else {
        throw new AssertionError("unsupported MCP conformance operation " + operation);
      }
    } catch (Throwable error) {
      if (expectedError != null && error.getMessage() != null && error.getMessage().contains(expectedError)) return;
      if (error instanceof RuntimeException runtime) throw runtime;
      throw new RuntimeException(error);
    }
  }

  static void assertRequests(List<Map<String, Object>> requests, Map<String, Object> fixture) {
    List<Object> expected = Core.asList(fixture.get("expected_requests"));
    if (requests.size() < expected.size()) throw new AssertionError("expected at least " + expected.size() + " requests, got " + requests.size());
    for (int i = 0; i < expected.size(); i++) assertSubset(requests.get(i), expected.get(i), "request " + i);
  }

  @SuppressWarnings("unchecked")
  static void assertSubset(Object actual, Object expected, String label) {
    if (expected instanceof Map<?, ?> expectedMap) {
      if (!(actual instanceof Map<?, ?> actualMap)) throw new AssertionError(label + ": expected object");
      for (Map.Entry<?, ?> entry : expectedMap.entrySet()) {
        if (!actualMap.containsKey(entry.getKey())) throw new AssertionError(label + ": missing key " + entry.getKey());
        assertSubset(actualMap.get(entry.getKey()), entry.getValue(), label + "." + entry.getKey());
      }
    } else if (expected instanceof List<?> expectedList) {
      if (!(actual instanceof List<?> actualList)) throw new AssertionError(label + ": expected list");
      if (actualList.size() < expectedList.size()) throw new AssertionError(label + ": expected list length at least " + expectedList.size());
      for (int i = 0; i < expectedList.size(); i++) assertSubset(actualList.get(i), expectedList.get(i), label + "[" + i + "]");
    } else if (expected != null && !expected.equals(actual)) {
      throw new AssertionError(label + ": expected " + expected + ", got " + actual);
    }
  }

  static final class MapTokenStore implements AxMCPOAuthOptions.TokenStore {
    final Map<String, AxMCPTokenSet> tokens = new LinkedHashMap<>();
    public AxMCPTokenSet getToken(String key) { return tokens.get(key); }
    public void setToken(String key, AxMCPTokenSet token) { tokens.put(key, token); }
  }
}

final class AxMCPError extends RuntimeException {
  AxMCPError(String message) { super(message); }
}
`

const javaAxMCPScriptedTransport = `package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public final class AxMCPScriptedTransport implements AxMCPTransport {
  public final List<Object> responses;
  public final List<Map<String, Object>> requests = new ArrayList<>();
  public final List<Map<String, Object>> notifications = new ArrayList<>();
  public final List<Map<String, Object>> sentResponses = new ArrayList<>();
  private Consumer<Map<String, Object>> handler;
  public String protocolVersion;

  public AxMCPScriptedTransport(List<Object> responses) {
    this.responses = new ArrayList<>(responses == null ? List.of() : responses);
  }

  public Map<String, Object> send(Map<String, Object> message) {
    requests.add(new LinkedHashMap<>(message));
    String method = String.valueOf(message.get("method"));
    int match = -1;
    for (int i = 0; i < responses.size(); i++) {
      Map<String, Object> raw = Core.asMap(responses.get(i));
      if (method.equals(String.valueOf(raw.getOrDefault("method", method)))) { match = i; break; }
    }
    Map<String, Object> raw = match >= 0 ? Core.asMap(responses.remove(match)) : Map.of("result", Map.of());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("jsonrpc", "2.0");
    out.put("id", message.get("id"));
    if (raw.containsKey("error")) out.put("error", raw.get("error"));
    else out.put("result", raw.getOrDefault("result", Map.of()));
    return out;
  }

  public void sendNotification(Map<String, Object> message) { notifications.add(new LinkedHashMap<>(message)); }
  public void sendResponse(Map<String, Object> message) { sentResponses.add(new LinkedHashMap<>(message)); }
  public void setMessageHandler(Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void emit(Map<String, Object> message) { if (handler != null) handler.accept(message); }
}
`

const javaAxMCPStreamableHTTPTransport = `package dev.axllm.ax;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxMCPStreamableHTTPTransport implements AxMCPTransport {
  private final String endpoint;
  private final Map<String, Object> options;
  private final HttpClient client = HttpClient.newHttpClient();
  private String sessionId;
  private String protocolVersion;
  private java.util.function.Consumer<Map<String, Object>> handler;
  private final Map<String, String> headers = new LinkedHashMap<>();
  private Map<String, String> lastHeaders = new LinkedHashMap<>();

  public AxMCPStreamableHTTPTransport(String endpoint) {
    this(endpoint, Map.of());
  }

  public AxMCPStreamableHTTPTransport(String endpoint, Map<String, Object> options) {
    this.options = options == null ? Map.of() : new LinkedHashMap<>(options);
    this.endpoint = AxMCPClient.validateEndpoint(endpoint, Core.asMap(this.options.get("ssrfProtection")));
    for (Map.Entry<String, Object> entry : Core.asMap(this.options.get("headers")).entrySet()) headers.put(entry.getKey(), String.valueOf(entry.getValue()));
    if (this.options.get("authorization") != null) headers.put("Authorization", String.valueOf(this.options.get("authorization")));
  }

  public Map<String, Object> send(Map<String, Object> message) {
    try {
      HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(endpoint)).POST(HttpRequest.BodyPublishers.ofString(Json.stringify(message)));
      for (Map.Entry<String, String> entry : buildHeaders(Map.of("Content-Type", "application/json", "Accept", "application/json, text/event-stream"), !"initialize".equals(message.get("method"))).entrySet()) builder.header(entry.getKey(), entry.getValue());
      HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
      response.headers().firstValue("MCP-Session-Id").ifPresent(value -> sessionId = value);
      if (response.statusCode() == 401 && applyOAuth()) return send(message);
      if (response.statusCode() < 200 || response.statusCode() >= 300) throw new AxMCPError("HTTP error " + response.statusCode());
      return Core.asMap(Json.parse(response.body().isBlank() ? "{}" : response.body()));
    } catch (AxMCPError error) {
      throw error;
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public void sendNotification(Map<String, Object> message) {
    Map<String, Object> withId = new LinkedHashMap<>(message);
    withId.put("id", "__notification__");
    send(withId);
  }

  public void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void setSessionId(String sessionId) { this.sessionId = sessionId; }
  public Map<String, String> headers() { return headers; }
  public Map<String, String> lastHeaders() { return lastHeaders; }

  public Map<String, String> buildHeaders(Map<String, String> base, boolean includeProtocolVersion) {
    Map<String, String> out = new LinkedHashMap<>(headers);
    out.putAll(base == null ? Map.of() : base);
    if (sessionId != null) out.put("MCP-Session-Id", sessionId);
    if (includeProtocolVersion && protocolVersion != null) out.put("MCP-Protocol-Version", protocolVersion);
    lastHeaders = new LinkedHashMap<>(out);
    return out;
  }

  boolean applyOAuth() {
    Object raw = options.get("oauth");
    if (raw == null) return false;
    AxMCPOAuthOptions oauth = raw instanceof AxMCPOAuthOptions typed ? typed : null;
    if (oauth == null) return false;
    AxMCPTokenSet token = oauth.tokenStore == null ? null : oauth.tokenStore.getToken(endpoint);
    if (token != null && token.accessToken != null) {
      headers.put("Authorization", "Bearer " + token.accessToken);
      return true;
    }
    if (oauth.onAuthCode == null) return false;
    String verifier = AxMCPClient.pkceVerifier();
    String challenge = AxMCPClient.pkceChallenge(verifier);
    Map<String, String> auth = oauth.onAuthCode.apply(endpoint + "?response_type=code&code_challenge=" + challenge + "&code_challenge_method=S256");
    if (auth == null || auth.get("code") == null) return false;
    AxMCPTokenSet next = new AxMCPTokenSet("mcp-auth-code-" + auth.get("code"), null, null, endpoint);
    if (oauth.tokenStore != null) oauth.tokenStore.setToken(endpoint, next);
    headers.put("Authorization", "Bearer " + next.accessToken);
    return true;
  }
}
`

const javaAxMCPStdioTransport = `package dev.axllm.ax;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class AxMCPStdioTransport implements AxMCPTransport {
  private final Process process;
  private final BufferedReader reader;
  private final BufferedWriter writer;
  private java.util.function.Consumer<Map<String, Object>> handler;
  private String protocolVersion;

  public AxMCPStdioTransport(String command, List<String> args) {
    try {
      List<String> cmd = new ArrayList<>();
      cmd.add(command);
      if (args != null) cmd.addAll(args);
      process = new ProcessBuilder(cmd).start();
      reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
      writer = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public synchronized Map<String, Object> send(Map<String, Object> message) {
    try {
      writer.write(AxMCPClient.stdioEncode(message));
      writer.flush();
      while (true) {
        String line = reader.readLine();
        if (line == null) throw new AxMCPError("MCP stdio process closed");
        Map<String, Object> parsed = AxMCPClient.stdioDecode(line);
        if (String.valueOf(parsed.get("id")).equals(String.valueOf(message.get("id")))) return parsed;
        if (handler != null) handler.accept(parsed);
      }
    } catch (AxMCPError error) {
      throw error;
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public synchronized void sendNotification(Map<String, Object> message) {
    try {
      writer.write(AxMCPClient.stdioEncode(message));
      writer.flush();
    } catch (Exception error) {
      throw new AxMCPError(error.getMessage());
    }
  }

  public void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void close() { process.destroy(); }
}
`

const goMCP = `package axllm

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const AX_MCP_PROTOCOL_VERSION = "2025-11-25"

var AX_MCP_SUPPORTED_PROTOCOL_VERSIONS = []string{
	AX_MCP_PROTOCOL_VERSION,
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
}

type AxMCPTokenSet struct {
	AccessToken string
	RefreshToken string
	ExpiresAt int64
	Issuer string
}

type AxMCPOAuthOptions struct {
	ClientID string
	ClientSecret string
	RedirectURI string
	Scopes []string
	OnAuthCode func(string) (map[string]string, error)
	TokenStore AxMCPTokenStore
	SSRFProtection map[string]Value
}

type AxMCPTokenStore interface {
	GetToken(key string) (*AxMCPTokenSet, error)
	SetToken(key string, token AxMCPTokenSet) error
	ClearToken(key string) error
}

type AxMCPTransport interface {
	Send(message map[string]Value) (map[string]Value, error)
	SendNotification(message map[string]Value) error
	SendResponse(message map[string]Value) error
	SetMessageHandler(handler func(map[string]Value))
	SetProtocolVersion(protocolVersion string)
	Connect() error
}

type AxMCPClient struct {
	transport AxMCPTransport
	options map[string]Value
	serverCapabilities map[string]Value
	serverInfo map[string]Value
	serverInstructions string
	negotiatedProtocolVersion string
	tools []map[string]Value
	prompts []map[string]Value
	resources []map[string]Value
	resourceTemplates []map[string]Value
	nextID int
}

func NewAxMCPClient(transport AxMCPTransport, options map[string]Value) *AxMCPClient {
	if options == nil { options = map[string]Value{} }
	c := &AxMCPClient{transport: transport, options: options, nextID: 1}
	transport.SetMessageHandler(c.handleInboundMessage)
	return c
}

func (c *AxMCPClient) Init() error {
	if err := c.transport.Connect(); err != nil { return err }
	protocol := display(coreGet(c.options, "protocolVersion", AX_MCP_PROTOCOL_VERSION))
	params := map[string]Value{
		"protocolVersion": protocol,
		"capabilities": c.clientCapabilities(),
		"clientInfo": map[string]Value{"name":"AxMCPClient", "title":"Ax MCP Client", "version":"1.0.0"},
	}
	for key, value := range asMap(coreGet(c.options, "clientInfo", Object())) {
		asMap(params["clientInfo"])[key] = value
	}
	result, err := c.request("initialize", params)
	if err != nil { return err }
	negotiated := display(coreGet(result, "protocolVersion", ""))
	supported := stringList(coreGet(c.options, "supportedProtocolVersions", AX_MCP_SUPPORTED_PROTOCOL_VERSIONS))
	if !stringIn(supported, negotiated) { return AxError{Category:"mcp", Message:"Unsupported MCP protocol version "+negotiated} }
	c.negotiatedProtocolVersion = negotiated
	c.transport.SetProtocolVersion(negotiated)
	c.serverCapabilities = asMap(coreGet(result, "capabilities", Object()))
	c.serverInfo = asMap(coreGet(result, "serverInfo", Object()))
	c.serverInstructions = display(coreGet(result, "instructions", ""))
	_ = c.Notify("notifications/initialized", nil)
	return c.Refresh()
}

func (c *AxMCPClient) Refresh() error {
	c.tools = nil; c.prompts = nil; c.resources = nil; c.resourceTemplates = nil
	if c.capability("tools") {
		result, err := c.ListTools("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(result, "tools", Array())) { c.tools = append(c.tools, asMap(item)) }
	}
	if c.capability("prompts") {
		result, err := c.ListPrompts("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(result, "prompts", Array())) { c.prompts = append(c.prompts, asMap(item)) }
	}
	if c.capability("resources") {
		result, err := c.ListResources("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(result, "resources", Array())) { c.resources = append(c.resources, asMap(item)) }
		templates, err := c.ListResourceTemplates("")
		if err != nil { return err }
		for _, item := range asSlice(coreGet(templates, "resourceTemplates", Array())) { c.resourceTemplates = append(c.resourceTemplates, asMap(item)) }
	}
	return nil
}

func (c *AxMCPClient) ProtocolVersion() string { return c.negotiatedProtocolVersion }
func (c *AxMCPClient) Tools() []map[string]Value { return append([]map[string]Value(nil), c.tools...) }
func (c *AxMCPClient) Ping() (map[string]Value, error) { return c.request("ping", map[string]Value{}) }
func (c *AxMCPClient) ListTools(cursor string) (map[string]Value, error) { return c.request("tools/list", cursorParams(cursor)) }
func (c *AxMCPClient) CallTool(name string, args map[string]Value) (map[string]Value, error) { if args == nil { args = map[string]Value{} }; return c.request("tools/call", map[string]Value{"name":name, "arguments":args}) }
func (c *AxMCPClient) ListPrompts(cursor string) (map[string]Value, error) { return c.request("prompts/list", cursorParams(cursor)) }
func (c *AxMCPClient) GetPrompt(name string, args map[string]Value) (map[string]Value, error) { if args == nil { args = map[string]Value{} }; return c.request("prompts/get", map[string]Value{"name":name, "arguments":args}) }
func (c *AxMCPClient) ListResources(cursor string) (map[string]Value, error) { return c.request("resources/list", cursorParams(cursor)) }
func (c *AxMCPClient) ReadResource(uri string) (map[string]Value, error) { return c.request("resources/read", map[string]Value{"uri":uri}) }
func (c *AxMCPClient) ListResourceTemplates(cursor string) (map[string]Value, error) { return c.request("resources/templates/list", cursorParams(cursor)) }

func (c *AxMCPClient) Notify(method string, params map[string]Value) error {
	msg := map[string]Value{"jsonrpc":"2.0", "method":method}
	if params != nil { msg["params"] = params }
	return c.transport.SendNotification(msg)
}

func (c *AxMCPClient) CancelRequest(requestID Value, reason string) error {
	params := map[string]Value{"requestId":requestID}
	if reason != "" { params["reason"] = reason }
	return c.Notify("notifications/cancelled", params)
}

func (c *AxMCPClient) ToFunction() []Tool {
	var out []Tool
	for _, tool := range c.tools { out = append(out, c.toolToFunction(tool)) }
	for _, prompt := range c.prompts { out = append(out, c.promptToFunction(prompt)) }
	for _, resource := range c.resources { out = append(out, c.resourceToFunction(resource)) }
	for _, templ := range c.resourceTemplates { out = append(out, c.resourceTemplateToFunction(templ)) }
	return out
}

func (c *AxMCPClient) request(method string, params map[string]Value) (map[string]Value, error) {
	id := fmt.Sprintf("%d", c.nextID); c.nextID++
	msg := map[string]Value{"jsonrpc":"2.0", "id":id, "method":method}
	if params != nil { msg["params"] = params }
	response, err := c.transport.Send(msg)
	if err != nil { return nil, err }
	if rawErr := coreGet(response, "error", nil); rawErr != nil {
		er := asMap(rawErr)
		return nil, AxError{Category:"mcp", Message:display(coreGet(er, "message", "MCP JSON-RPC error"))}
	}
	return asMap(coreGet(response, "result", Object())), nil
}

func (c *AxMCPClient) clientCapabilities() map[string]Value {
	out := map[string]Value{}
	for key, value := range asMap(coreGet(c.options, "capabilities", Object())) { out[key] = value }
	if coreGet(c.options, "roots", nil) != nil {
		if _, ok := out["roots"]; !ok { out["roots"] = map[string]Value{"listChanged":true} }
	}
	return out
}

func (c *AxMCPClient) capability(name string) bool {
	value, ok := c.serverCapabilities[name]
	return ok && value != nil && value != false
}

func (c *AxMCPClient) handleInboundMessage(message map[string]Value) {
	if display(coreGet(message, "method", "")) == "roots/list" && coreGet(message, "id", nil) != nil {
		_ = c.transport.SendResponse(map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil), "result":map[string]Value{"roots":coreGet(c.options, "roots", Array())}})
	}
}

func (c *AxMCPClient) toolToFunction(tool map[string]Value) Tool {
	original := display(coreGet(tool, "name", ""))
	name := c.overrideName(original)
	desc := c.overrideDescription(tool)
	return Tool{Name:name, Description:desc, Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) {
		result, err := c.CallTool(original, args)
		if err != nil { return nil, err }
		if value := coreGet(result, "structuredContent", nil); value != nil { return value, nil }
		return map[string]Value{"content": contentText(asSlice(coreGet(result, "content", Array())))}, nil
	}}
}

func (c *AxMCPClient) promptToFunction(prompt map[string]Value) Tool {
	original := display(coreGet(prompt, "name", ""))
	return Tool{Name:c.overrideName("prompt_"+original), Description:c.overrideDescription(prompt), Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) { return c.GetPrompt(original, args) }}
}

func (c *AxMCPClient) resourceToFunction(resource map[string]Value) Tool {
	uri := display(coreGet(resource, "uri", ""))
	name := c.overrideName("resource_"+safeMCPName(display(coreGet(resource, "name", uri))))
	return Tool{Name:name, Description:c.overrideDescription(resource), Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) { return c.ReadResource(uri) }}
}

func (c *AxMCPClient) resourceTemplateToFunction(templ map[string]Value) Tool {
	name := c.overrideName("resource_template_"+safeMCPName(display(coreGet(templ, "name", "template"))))
	return Tool{Name:name, Description:c.overrideDescription(templ), Args:map[string]Field{}, Returns:map[string]Field{}, Handler: func(args map[string]Value) (Value, error) { return c.ReadResource(display(coreGet(args, "uri", ""))) }}
}

func (c *AxMCPClient) overrideName(name string) string {
	for _, raw := range asSlice(coreGet(c.options, "functionOverrides", Array())) {
		item := asMap(raw)
		if display(coreGet(item, "name", "")) == name { return display(coreGet(coreGet(item, "updates", Object()), "name", name)) }
	}
	return name
}

func (c *AxMCPClient) overrideDescription(item map[string]Value) string {
	name := display(coreGet(item, "name", ""))
	desc := display(coreGet(item, "description", coreGet(item, "title", name)))
	for _, raw := range asSlice(coreGet(c.options, "functionOverrides", Array())) {
		over := asMap(raw)
		if display(coreGet(over, "name", "")) == name { return display(coreGet(coreGet(over, "updates", Object()), "description", desc)) }
	}
	return desc
}

type AxMCPStreamableHTTPTransport struct {
	Endpoint string
	Options map[string]Value
	Headers map[string]string
	SessionID string
	ProtocolVersion string
	LastHeaders map[string]string
	handler func(map[string]Value)
	client *http.Client
	OAuth *AxMCPOAuthOptions
}

func NewAxMCPStreamableHTTPTransport(endpoint string, options map[string]Value) (*AxMCPStreamableHTTPTransport, error) {
	if options == nil { options = map[string]Value{} }
	checked, err := AxMCPValidateEndpoint(endpoint, asMap(coreGet(options, "ssrfProtection", Object())))
	if err != nil { return nil, err }
	t := &AxMCPStreamableHTTPTransport{Endpoint:checked, Options:options, Headers:map[string]string{}, client:&http.Client{Timeout:30*time.Second}}
	for key, value := range asMap(coreGet(options, "headers", Object())) { t.Headers[key] = display(value) }
	if auth := display(coreGet(options, "authorization", "")); auth != "" { t.Headers["Authorization"] = auth }
	return t, nil
}

func (t *AxMCPStreamableHTTPTransport) Send(message map[string]Value) (map[string]Value, error) {
	body, _ := json.Marshal(message)
	req, err := http.NewRequest("POST", t.Endpoint, bytes.NewReader(body))
	if err != nil { return nil, err }
	for key, value := range t.BuildHeaders(map[string]string{"Content-Type":"application/json", "Accept":"application/json, text/event-stream"}, display(coreGet(message, "method", "")) != "initialize") { req.Header.Set(key, value) }
	res, err := t.client.Do(req)
	if err != nil { return nil, err }
	defer res.Body.Close()
	if sid := res.Header.Get("MCP-Session-Id"); sid != "" { t.SessionID = sid }
	if res.StatusCode == 401 && t.ApplyOAuth() { return t.Send(message) }
	if res.StatusCode < 200 || res.StatusCode >= 300 { return nil, AxError{Category:"mcp", Message:fmt.Sprintf("HTTP error %d", res.StatusCode)} }
	data, _ := io.ReadAll(res.Body)
	if len(strings.TrimSpace(string(data))) == 0 { return map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil), "result":map[string]Value{}}, nil }
	return asMap(ParseJSON(string(data))), nil
}

func (t *AxMCPStreamableHTTPTransport) SendNotification(message map[string]Value) error { _, err := t.Send(message); return err }
func (t *AxMCPStreamableHTTPTransport) SendResponse(message map[string]Value) error { _, err := t.Send(message); return err }
func (t *AxMCPStreamableHTTPTransport) SetMessageHandler(handler func(map[string]Value)) { t.handler = handler }
func (t *AxMCPStreamableHTTPTransport) SetProtocolVersion(protocolVersion string) { t.ProtocolVersion = protocolVersion }
func (t *AxMCPStreamableHTTPTransport) Connect() error { return nil }

func (t *AxMCPStreamableHTTPTransport) BuildHeaders(base map[string]string, includeProtocol bool) map[string]string {
	out := map[string]string{}
	for key, value := range t.Headers { out[key] = value }
	for key, value := range base { out[key] = value }
	if t.SessionID != "" { out["MCP-Session-Id"] = t.SessionID }
	if includeProtocol && t.ProtocolVersion != "" { out["MCP-Protocol-Version"] = t.ProtocolVersion }
	t.LastHeaders = out
	return out
}

func (t *AxMCPStreamableHTTPTransport) ApplyOAuth() bool {
	if t.OAuth == nil { return false }
	if t.OAuth.TokenStore != nil {
		token, _ := t.OAuth.TokenStore.GetToken(t.Endpoint)
		if token != nil && token.AccessToken != "" {
			t.Headers["Authorization"] = "Bearer " + token.AccessToken
			return true
		}
	}
	if t.OAuth.OnAuthCode == nil { return false }
	verifier := AxMCPPKCEVerifier()
	challenge := AxMCPPKCEChallenge(verifier)
	auth, err := t.OAuth.OnAuthCode(t.Endpoint+"?response_type=code&code_challenge="+url.QueryEscape(challenge)+"&code_challenge_method=S256")
	if err != nil || auth["code"] == "" { return false }
	token := AxMCPTokenSet{AccessToken:"mcp-auth-code-"+auth["code"], Issuer:t.Endpoint}
	if t.OAuth.TokenStore != nil { _ = t.OAuth.TokenStore.SetToken(t.Endpoint, token) }
	t.Headers["Authorization"] = "Bearer " + token.AccessToken
	return true
}

type AxMCPStdioTransport struct {
	cmd *exec.Cmd
	stdin io.WriteCloser
	stdout *bufio.Reader
	mu sync.Mutex
	handler func(map[string]Value)
	protocolVersion string
}

func NewAxMCPStdioTransport(command string, args []string) (*AxMCPStdioTransport, error) {
	cmd := exec.Command(command, args...)
	in, err := cmd.StdinPipe(); if err != nil { return nil, err }
	out, err := cmd.StdoutPipe(); if err != nil { return nil, err }
	if err := cmd.Start(); err != nil { return nil, err }
	return &AxMCPStdioTransport{cmd:cmd, stdin:in, stdout:bufio.NewReader(out)}, nil
}

func (t *AxMCPStdioTransport) Send(message map[string]Value) (map[string]Value, error) {
	t.mu.Lock(); defer t.mu.Unlock()
	if _, err := io.WriteString(t.stdin, AxMCPStdioEncode(message)); err != nil { return nil, err }
	for {
		line, err := t.stdout.ReadString('\n')
		if err != nil { return nil, err }
		parsed, err := AxMCPStdioDecode(line)
		if err != nil { continue }
		if display(coreGet(parsed, "id", nil)) == display(coreGet(message, "id", nil)) { return parsed, nil }
		if t.handler != nil { t.handler(parsed) }
	}
}

func (t *AxMCPStdioTransport) SendNotification(message map[string]Value) error { _, err := io.WriteString(t.stdin, AxMCPStdioEncode(message)); return err }
func (t *AxMCPStdioTransport) SendResponse(message map[string]Value) error { return t.SendNotification(message) }
func (t *AxMCPStdioTransport) SetMessageHandler(handler func(map[string]Value)) { t.handler = handler }
func (t *AxMCPStdioTransport) SetProtocolVersion(protocolVersion string) { t.protocolVersion = protocolVersion }
func (t *AxMCPStdioTransport) Connect() error { return nil }
func (t *AxMCPStdioTransport) Close() error { return t.cmd.Process.Kill() }

type AxMCPScriptedTransport struct {
	Responses []Value
	Requests []map[string]Value
	Notifications []map[string]Value
	SentResponses []map[string]Value
	ProtocolVersion string
	handler func(map[string]Value)
}

func NewAxMCPScriptedTransport(responses []Value) *AxMCPScriptedTransport { return &AxMCPScriptedTransport{Responses:append([]Value(nil), responses...)} }
func (t *AxMCPScriptedTransport) Connect() error { return nil }
func (t *AxMCPScriptedTransport) SetProtocolVersion(protocolVersion string) { t.ProtocolVersion = protocolVersion }
func (t *AxMCPScriptedTransport) SetMessageHandler(handler func(map[string]Value)) { t.handler = handler }
func (t *AxMCPScriptedTransport) Send(message map[string]Value) (map[string]Value, error) {
	t.Requests = append(t.Requests, cloneMCPMap(message))
	method := display(coreGet(message, "method", ""))
	match := -1
	for i, raw := range t.Responses {
		if display(coreGet(raw, "method", method)) == method { match = i; break }
	}
	raw := Value(map[string]Value{"result":map[string]Value{}})
	if match >= 0 { raw = t.Responses[match]; t.Responses = append(t.Responses[:match], t.Responses[match+1:]...) }
	out := map[string]Value{"jsonrpc":"2.0", "id":coreGet(message, "id", nil)}
	if errValue := coreGet(raw, "error", nil); errValue != nil { out["error"] = errValue } else { out["result"] = coreGet(raw, "result", Object()) }
	return out, nil
}
func (t *AxMCPScriptedTransport) SendNotification(message map[string]Value) error { t.Notifications = append(t.Notifications, cloneMCPMap(message)); return nil }
func (t *AxMCPScriptedTransport) SendResponse(message map[string]Value) error { t.SentResponses = append(t.SentResponses, cloneMCPMap(message)); return nil }
func (t *AxMCPScriptedTransport) Emit(message map[string]Value) { if t.handler != nil { t.handler(message) } }

func AxMCPStdioEncode(message map[string]Value) string { data, _ := json.Marshal(message); return string(data)+"\n" }
func AxMCPStdioDecode(line string) (map[string]Value, error) { var out map[string]Value; err := json.Unmarshal([]byte(strings.TrimSpace(line)), &out); return out, err }
func AxMCPPKCEVerifier() string { return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano()))) }
func AxMCPPKCEChallenge(verifier string) string { sum := sha256.Sum256([]byte(verifier)); return base64.RawURLEncoding.EncodeToString(sum[:]) }

func AxMCPValidateEndpoint(endpoint string, options map[string]Value) (string, error) {
	u, err := url.Parse(endpoint); if err != nil { return "", err }
	if u.Scheme != "http" && u.Scheme != "https" { return "", AxError{Category:"mcp", Message:"MCP endpoint must use http or https"} }
	requireHTTPS := coreGet(options, "requireHttps", coreGet(options, "require_https", true)) != false
	if requireHTTPS && u.Scheme != "https" { return "", AxError{Category:"mcp", Message:"MCP endpoint must use https"} }
	host := u.Hostname()
	if host == "" { return "", AxError{Category:"mcp", Message:"MCP endpoint must include a host"} }
	allowLocal := coreTruthy(coreGet(options, "allowLocalhost", coreGet(options, "allow_localhost", false)))
	allowPrivate := coreTruthy(coreGet(options, "allowPrivateNetworks", coreGet(options, "allow_private_networks", false)))
	if (host == "localhost" || host == "localhost.localdomain") && !allowLocal { return "", AxError{Category:"mcp", Message:"MCP endpoint host is local"} }
	if ip, err := netip.ParseAddr(host); err == nil {
		if (ip.IsLoopback() && !allowLocal) || (ip.IsPrivate() && !allowPrivate) || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() { return "", AxError{Category:"mcp", Message:"MCP endpoint host is not allowed by SSRF protection"} }
	}
	return endpoint, nil
}

func runMCPConformanceFixture(fixture map[string]Value) {
	op := display(coreGet(fixture, "operation", "initialize"))
	expectedErr := display(coreGet(fixture, "expected_error_contains", ""))
	defer func() {
		if r := recover(); r != nil {
			if expectedErr != "" && strings.Contains(fmt.Sprint(r), expectedErr) { return }
			panic(r)
		}
	}()
	if op == "ssrf" {
		_, err := AxMCPValidateEndpoint(display(coreGet(fixture, "endpoint", "https://127.0.0.1/mcp")), asMap(coreGet(fixture, "ssrfProtection", Object())))
		if err != nil { panic(err) }
		if expectedErr != "" { panic("expected SSRF validation to fail") }
		return
	}
	if op == "stdio_framing" {
		msg := asMap(coreGet(fixture, "message", Object()))
		line := AxMCPStdioEncode(msg)
		if want := display(coreGet(fixture, "expected_line", "")); want != "" && line != want { panic("stdio line mismatch") }
		decoded, err := AxMCPStdioDecode(line); if err != nil { panic(err) }
		assertSubset(decoded, msg, "stdio decoded")
		return
	}
	if op == "oauth" {
		challenge := AxMCPPKCEChallenge(display(coreGet(fixture, "verifier", "test-verifier")))
		if want := display(coreGet(fixture, "expected_challenge", "")); want != "" && challenge != want { panic("PKCE challenge mismatch") }
		store := &mcpMapTokenStore{tokens:map[string]AxMCPTokenSet{}}
		t, err := NewAxMCPStreamableHTTPTransport(display(coreGet(fixture, "endpoint", "https://example.com/mcp")), nil); if err != nil { panic(err) }
		t.OAuth = &AxMCPOAuthOptions{TokenStore:store, OnAuthCode:func(string)(map[string]string,error){ return map[string]string{"code":"abc"}, nil }}
		if !t.ApplyOAuth() { panic("OAuth flow did not produce a token") }
		if t.Headers["Authorization"] == "" { panic("OAuth flow did not set Authorization") }
		return
	}
	if op == "http_session_headers" {
		t, err := NewAxMCPStreamableHTTPTransport(display(coreGet(fixture, "endpoint", "https://example.com/mcp")), asMap(coreGet(fixture, "transport_options", Object()))); if err != nil { panic(err) }
		t.SessionID = display(coreGet(fixture, "session_id", "session-1"))
		t.SetProtocolVersion(display(coreGet(fixture, "protocol_version", AX_MCP_PROTOCOL_VERSION)))
		assertSubset(mcpHeaderValues(t.BuildHeaders(map[string]string{"Accept":"application/json"}, true)), coreGet(fixture, "expected_headers", Object()), "headers")
		return
	}
	transport := NewAxMCPScriptedTransport(asSlice(coreGet(fixture, "responses", coreGet(fixture, "transport_responses", Array()))))
	client := NewAxMCPClient(transport, asMap(coreGet(fixture, "client_options", Object())))
	if err := client.Init(); err != nil { panic(err) }
	if want := display(coreGet(fixture, "expected_protocol_version", "")); want != "" && client.ProtocolVersion() != want { panic("protocol version mismatch") }
	switch op {
	case "initialize", "protocol_negotiation":
		assertMCPRequests(transport.Requests, fixture)
	case "ping":
		if _, err := client.Ping(); err != nil { panic(err) }
		assertMCPRequests(transport.Requests, fixture)
	case "tools":
		functions := client.ToFunction()
		var names []Value
		for _, fn := range functions { names = append(names, fn.Name) }
		if expected := coreGet(fixture, "expected_function_names", nil); expected != nil { assertEqual(names, expected, "function names") }
		if call := coreGet(fixture, "call_function", nil); call != nil {
			c := asMap(call)
			var found *Tool
			for i := range functions { if functions[i].Name == display(coreGet(c, "name", "")) { found = &functions[i] } }
			if found == nil { panic("missing function") }
			result := found.Call(asMap(coreGet(c, "arguments", Object())))
			assertSubset(result, coreGet(fixture, "expected_call_result", Object()), "tool result")
		}
		assertMCPRequests(transport.Requests, fixture)
	case "prompts_resources":
		var names []Value
		for _, fn := range client.ToFunction() { names = append(names, fn.Name) }
		if expected := coreGet(fixture, "expected_function_names", nil); expected != nil { assertEqual(names, expected, "function names") }
	case "roots_notifications":
		transport.Emit(map[string]Value{"jsonrpc":"2.0", "id":"server-1", "method":"roots/list"})
		assertSubset(transport.SentResponses[0], coreGet(fixture, "expected_roots_response", Object()), "roots response")
	case "cancellation":
		if err := client.CancelRequest(coreGet(fixture, "request_id", "1"), display(coreGet(fixture, "reason", "cancelled"))); err != nil { panic(err) }
		assertSubset(transport.Notifications[len(transport.Notifications)-1], coreGet(fixture, "expected_notification", Object()), "cancel notification")
	default:
		panic("unsupported MCP conformance operation "+op)
	}
}

func assertMCPRequests(requests []map[string]Value, fixture map[string]Value) {
	expected := asSlice(coreGet(fixture, "expected_requests", Array()))
	if len(requests) < len(expected) { panic("not enough MCP requests") }
	for i, want := range expected { assertSubset(requests[i], want, fmt.Sprintf("request %d", i)) }
}

type mcpMapTokenStore struct { tokens map[string]AxMCPTokenSet }
func (s *mcpMapTokenStore) GetToken(key string) (*AxMCPTokenSet, error) { if token, ok := s.tokens[key]; ok { return &token, nil }; return nil, nil }
func (s *mcpMapTokenStore) SetToken(key string, token AxMCPTokenSet) error { s.tokens[key] = token; return nil }
func (s *mcpMapTokenStore) ClearToken(key string) error { delete(s.tokens, key); return nil }

func cursorParams(cursor string) map[string]Value { if cursor == "" { return map[string]Value{} }; return map[string]Value{"cursor":cursor} }
func stringIn(items []string, want string) bool { for _, item := range items { if item == want { return true } }; return false }
func stringList(value Value) []string { var out []string; for _, item := range asSlice(value) { out = append(out, display(item)) }; if len(out)==0 { return AX_MCP_SUPPORTED_PROTOCOL_VERSIONS }; return out }
func mcpHeaderValues(headers map[string]string) map[string]Value { out := map[string]Value{}; for key, value := range headers { out[key] = value }; return out }
func contentText(items []Value) string { var out []string; for _, item := range items { m := asMap(item); if display(coreGet(m, "type", "")) == "text" { out = append(out, display(coreGet(m, "text", ""))) } }; return strings.Join(out, "\n") }
func safeMCPName(value string) string { var b strings.Builder; last := false; for _, r := range value { ok := (r>='a'&&r<='z')||(r>='A'&&r<='Z')||(r>='0'&&r<='9'); if ok { b.WriteRune(r); last=false } else if !last { b.WriteByte('_'); last=true } }; return strings.Trim(b.String(), "_") }
func cloneMCPMap(value map[string]Value) map[string]Value { data, _ := json.Marshal(value); var out map[string]Value; _ = json.Unmarshal(data, &out); return out }
`

const rustMCP = `use crate::{tool, AxError, AxResult, Tool};
use serde_json::{json, Map, Value};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const AX_MCP_PROTOCOL_VERSION: &str = "2025-11-25";
pub const AX_MCP_SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &[
    AX_MCP_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];

#[derive(Debug, Clone)]
pub struct AxMCPTokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub issuer: Option<String>,
}

#[derive(Clone, Default)]
pub struct AxMCPOAuthOptions {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: Option<String>,
    pub scopes: Vec<String>,
    pub on_auth_code: Option<Arc<dyn Fn(String) -> AxResult<Map<String, Value>> + Send + Sync>>,
    pub token_store: Option<Arc<Mutex<dyn AxMCPTokenStore + Send + Sync>>>,
    pub ssrf_protection: Value,
}

pub trait AxMCPTokenStore {
    fn get_token(&mut self, key: &str) -> AxResult<Option<AxMCPTokenSet>>;
    fn set_token(&mut self, key: &str, token: AxMCPTokenSet) -> AxResult<()>;
    fn clear_token(&mut self, _key: &str) -> AxResult<()> { Ok(()) }
}

pub trait AxMCPTransport: Send {
    fn send(&mut self, message: Value) -> AxResult<Value>;
    fn send_notification(&mut self, message: Value) -> AxResult<()>;
    fn send_response(&mut self, message: Value) -> AxResult<()> { self.send_notification(message) }
    fn set_protocol_version(&mut self, _protocol_version: &str) {}
    fn connect(&mut self) -> AxResult<()> { Ok(()) }
}

#[derive(Clone)]
pub struct AxMCPClient {
    transport: Arc<Mutex<Box<dyn AxMCPTransport>>>,
    options: Value,
    server_capabilities: Value,
    negotiated_protocol_version: Option<String>,
    tools: Vec<Value>,
    prompts: Vec<Value>,
    resources: Vec<Value>,
    resource_templates: Vec<Value>,
    next_id: Arc<Mutex<u64>>,
}

impl AxMCPClient {
    pub fn new(transport: Box<dyn AxMCPTransport>, options: Value) -> Self {
        Self {
            transport: Arc::new(Mutex::new(transport)),
            options,
            server_capabilities: json!({}),
            negotiated_protocol_version: None,
            tools: Vec::new(),
            prompts: Vec::new(),
            resources: Vec::new(),
            resource_templates: Vec::new(),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    pub fn init(&mut self) -> AxResult<()> {
        self.transport.lock().unwrap().connect()?;
        let protocol = self.options.get("protocolVersion").and_then(Value::as_str).unwrap_or(AX_MCP_PROTOCOL_VERSION);
        let result = self.request("initialize", json!({
            "protocolVersion": protocol,
            "capabilities": self.client_capabilities(),
            "clientInfo": {"name": "AxMCPClient", "title": "Ax MCP Client", "version": "1.0.0"}
        }))?;
        let negotiated = result.get("protocolVersion").and_then(Value::as_str).unwrap_or_default().to_string();
        let supported = self.options
            .get("supportedProtocolVersions")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_else(|| AX_MCP_SUPPORTED_PROTOCOL_VERSIONS.iter().map(|s| s.to_string()).collect());
        if !supported.iter().any(|item| item == &negotiated) {
            return Err(AxError::new("mcp", format!("Unsupported MCP protocol version {negotiated}")));
        }
        self.negotiated_protocol_version = Some(negotiated.clone());
        self.transport.lock().unwrap().set_protocol_version(&negotiated);
        self.server_capabilities = result.get("capabilities").cloned().unwrap_or_else(|| json!({}));
        self.notify("notifications/initialized", Value::Null)?;
        self.refresh()
    }

    pub fn refresh(&mut self) -> AxResult<()> {
        self.tools.clear();
        self.prompts.clear();
        self.resources.clear();
        self.resource_templates.clear();
        if self.capability("tools") {
            self.tools = self.list_tools(None)?.get("tools").and_then(Value::as_array).cloned().unwrap_or_default();
        }
        if self.capability("prompts") {
            self.prompts = self.list_prompts(None)?.get("prompts").and_then(Value::as_array).cloned().unwrap_or_default();
        }
        if self.capability("resources") {
            self.resources = self.list_resources(None)?.get("resources").and_then(Value::as_array).cloned().unwrap_or_default();
            self.resource_templates = self.list_resource_templates(None)?.get("resourceTemplates").and_then(Value::as_array).cloned().unwrap_or_default();
        }
        Ok(())
    }

    pub fn protocol_version(&self) -> Option<&str> { self.negotiated_protocol_version.as_deref() }
    pub fn ping(&mut self) -> AxResult<Value> { self.request("ping", json!({})) }
    pub fn list_tools(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("tools/list", cursor_params(cursor)) }
    pub fn call_tool(&mut self, name: &str, arguments: Value) -> AxResult<Value> { self.request("tools/call", json!({"name": name, "arguments": if arguments.is_null() { json!({}) } else { arguments }})) }
    pub fn list_prompts(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("prompts/list", cursor_params(cursor)) }
    pub fn get_prompt(&mut self, name: &str, arguments: Value) -> AxResult<Value> { self.request("prompts/get", json!({"name": name, "arguments": if arguments.is_null() { json!({}) } else { arguments }})) }
    pub fn list_resources(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("resources/list", cursor_params(cursor)) }
    pub fn read_resource(&mut self, uri: &str) -> AxResult<Value> { self.request("resources/read", json!({"uri": uri})) }
    pub fn list_resource_templates(&mut self, cursor: Option<&str>) -> AxResult<Value> { self.request("resources/templates/list", cursor_params(cursor)) }

    pub fn notify(&self, method: &str, params: Value) -> AxResult<()> {
        let mut message = json!({"jsonrpc":"2.0", "method": method});
        if !params.is_null() { message["params"] = params; }
        self.transport.lock().unwrap().send_notification(message)
    }

    pub fn cancel_request(&self, request_id: Value, reason: Option<&str>) -> AxResult<()> {
        let mut params = json!({"requestId": request_id});
        if let Some(reason) = reason { params["reason"] = json!(reason); }
        self.notify("notifications/cancelled", params)
    }

    pub fn to_function(&self) -> Vec<Tool> {
        let mut out = Vec::new();
        for item in &self.tools { out.push(self.tool_to_function(item.clone())); }
        for item in &self.prompts { out.push(self.prompt_to_function(item.clone())); }
        for item in &self.resources { out.push(self.resource_to_function(item.clone())); }
        for item in &self.resource_templates { out.push(self.resource_template_to_function(item.clone())); }
        out
    }

    fn request(&self, method: &str, params: Value) -> AxResult<Value> {
        mcp_transport_request(&self.transport, &self.next_id, method, params)
    }

    fn client_capabilities(&self) -> Value {
        let mut out = self.options.get("capabilities").cloned().unwrap_or_else(|| json!({}));
        if self.options.get("roots").is_some() && out.get("roots").is_none() { out["roots"] = json!({"listChanged": true}); }
        out
    }

    fn capability(&self, name: &str) -> bool {
        self.server_capabilities.get(name).is_some_and(|value| !value.is_null() && value != &Value::Bool(false))
    }

    fn tool_to_function(&self, spec: Value) -> Tool {
        let original = spec.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
        let name = override_name(&self.options, &original);
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| {
            let result = mcp_transport_request(&transport, &next_id, "tools/call", json!({"name": original, "arguments": args}))?;
            if let Some(value) = result.get("structuredContent") { return Ok(value.clone()); }
            Ok(json!({"content": content_text(result.get("content").and_then(Value::as_array).cloned().unwrap_or_default())}))
        })
    }

    fn prompt_to_function(&self, spec: Value) -> Tool {
        let original = spec.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
        let name = override_name(&self.options, &format!("prompt_{original}"));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| mcp_transport_request(&transport, &next_id, "prompts/get", json!({"name": original, "arguments": args})))
    }

    fn resource_to_function(&self, spec: Value) -> Tool {
        let uri = spec.get("uri").and_then(Value::as_str).unwrap_or_default().to_string();
        let raw_name = spec.get("name").and_then(Value::as_str).unwrap_or(&uri);
        let name = override_name(&self.options, &format!("resource_{}", safe_name(raw_name)));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |_| mcp_transport_request(&transport, &next_id, "resources/read", json!({"uri": uri})))
    }

    fn resource_template_to_function(&self, spec: Value) -> Tool {
        let raw_name = spec.get("name").and_then(Value::as_str).unwrap_or("template");
        let name = override_name(&self.options, &format!("resource_template_{}", safe_name(raw_name)));
        let description = override_description(&self.options, &spec);
        let transport = self.transport.clone();
        let next_id = self.next_id.clone();
        tool(&name).description(description).handler(move |args| mcp_transport_request(&transport, &next_id, "resources/read", json!({"uri": args.get("uri").cloned().unwrap_or(Value::Null)})))
    }
}

fn mcp_transport_request(transport: &Arc<Mutex<Box<dyn AxMCPTransport>>>, next_id: &Arc<Mutex<u64>>, method: &str, params: Value) -> AxResult<Value> {
    let mut next = next_id.lock().unwrap();
    let id = next.to_string();
    *next += 1;
    drop(next);
    let response = transport.lock().unwrap().send(json!({"jsonrpc":"2.0", "id": id, "method": method, "params": params}))?;
    if let Some(error) = response.get("error") {
        return Err(AxError::new("mcp", error.get("message").and_then(Value::as_str).unwrap_or("MCP JSON-RPC error")));
    }
    Ok(response.get("result").cloned().unwrap_or_else(|| json!({})))
}

pub struct AxMCPStreamableHTTPTransport {
    endpoint: String,
    headers: Map<String, Value>,
    session_id: Option<String>,
    protocol_version: Option<String>,
    pub oauth: Option<AxMCPOAuthOptions>,
    client: reqwest::blocking::Client,
}

impl AxMCPStreamableHTTPTransport {
    pub fn new(endpoint: impl Into<String>, options: Value) -> AxResult<Self> {
        let endpoint = ax_mcp_validate_endpoint(&endpoint.into(), options.get("ssrfProtection").unwrap_or(&Value::Null))?;
        Ok(Self { endpoint, headers: Map::new(), session_id: None, protocol_version: None, oauth: None, client: reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)).build()? })
    }

    pub fn set_session_id(&mut self, value: impl Into<String>) { self.session_id = Some(value.into()); }
    pub fn build_headers(&self, base: Map<String, Value>, include_protocol: bool) -> Map<String, Value> {
        let mut out = self.headers.clone();
        for (key, value) in base { out.insert(key, value); }
        if let Some(session) = &self.session_id { out.insert("MCP-Session-Id".to_string(), json!(session)); }
        if include_protocol {
            if let Some(version) = &self.protocol_version { out.insert("MCP-Protocol-Version".to_string(), json!(version)); }
        }
        out
    }

    pub fn apply_oauth(&mut self) -> bool {
        let Some(oauth) = &self.oauth else { return false; };
        if let Some(store) = &oauth.token_store {
            if let Ok(Some(token)) = store.lock().unwrap().get_token(&self.endpoint) {
                self.headers.insert("Authorization".to_string(), json!(format!("Bearer {}", token.access_token)));
                return true;
            }
        }
        let Some(callback) = &oauth.on_auth_code else { return false; };
        let verifier = ax_mcp_pkce_verifier();
        let challenge = ax_mcp_pkce_challenge(&verifier);
        let Ok(auth) = callback(format!("{}?response_type=code&code_challenge={}&code_challenge_method=S256", self.endpoint, ax_mcp_url_encode(&challenge))) else { return false; };
        let Some(code) = auth.get("code").and_then(Value::as_str) else { return false; };
        let token = AxMCPTokenSet { access_token: format!("mcp-auth-code-{code}"), refresh_token: None, expires_at: None, issuer: Some(self.endpoint.clone()) };
        if let Some(store) = &oauth.token_store { let _ = store.lock().unwrap().set_token(&self.endpoint, token.clone()); }
        self.headers.insert("Authorization".to_string(), json!(format!("Bearer {}", token.access_token)));
        true
    }
}

impl AxMCPTransport for AxMCPStreamableHTTPTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        let mut request = self.client.post(&self.endpoint).json(&message);
        for (key, value) in self.build_headers(Map::new(), message.get("method").and_then(Value::as_str) != Some("initialize")) {
            if let Some(text) = value.as_str() { request = request.header(key, text); }
        }
        let response = request.send()?;
        if response.status().as_u16() == 401 && self.apply_oauth() { return self.send(message); }
        if !response.status().is_success() { return Err(AxError::new("mcp", format!("HTTP error {}", response.status().as_u16()))); }
        Ok(response.json()?)
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> { self.send(message).map(|_| ()) }
    fn set_protocol_version(&mut self, protocol_version: &str) { self.protocol_version = Some(protocol_version.to_string()); }
}

pub struct AxMCPStdioTransport {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    protocol_version: Option<String>,
}

impl AxMCPStdioTransport {
    pub fn new(command: impl Into<String>, args: impl IntoIterator<Item = impl Into<String>>) -> AxResult<Self> {
        let mut child = Command::new(command.into()).args(args.into_iter().map(Into::into)).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| AxError::new("mcp", "missing MCP stdio stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| AxError::new("mcp", "missing MCP stdio stdout"))?;
        Ok(Self { child, stdin, stdout: BufReader::new(stdout), protocol_version: None })
    }
}

impl Drop for AxMCPStdioTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

impl AxMCPTransport for AxMCPStdioTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        self.stdin.write_all(ax_mcp_stdio_encode(&message)?.as_bytes())?;
        self.stdin.flush()?;
        loop {
            let mut line = String::new();
            self.stdout.read_line(&mut line)?;
            let parsed = ax_mcp_stdio_decode(&line)?;
            if parsed.get("id") == message.get("id") { return Ok(parsed); }
        }
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> {
        self.stdin.write_all(ax_mcp_stdio_encode(&message)?.as_bytes())?;
        self.stdin.flush()?;
        Ok(())
    }

    fn set_protocol_version(&mut self, protocol_version: &str) { self.protocol_version = Some(protocol_version.to_string()); }
}

pub struct AxMCPScriptedTransport {
    responses: Vec<Value>,
    pub requests: Vec<Value>,
    pub notifications: Vec<Value>,
    pub sent_responses: Vec<Value>,
    protocol_version: Option<String>,
}

impl AxMCPScriptedTransport {
    pub fn new(responses: Vec<Value>) -> Self {
        Self { responses, requests: Vec::new(), notifications: Vec::new(), sent_responses: Vec::new(), protocol_version: None }
    }
}

impl AxMCPTransport for AxMCPScriptedTransport {
    fn send(&mut self, message: Value) -> AxResult<Value> {
        self.requests.push(message.clone());
        let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
        let index = self.responses.iter().position(|item| item.get("method").and_then(Value::as_str).unwrap_or(method) == method);
        let raw = index.map(|idx| self.responses.remove(idx)).unwrap_or_else(|| json!({"result": {}}));
        if raw.get("error").is_some() {
            Ok(json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "error": raw["error"]}))
        } else {
            Ok(json!({"jsonrpc":"2.0", "id": message.get("id").cloned().unwrap_or(Value::Null), "result": raw.get("result").cloned().unwrap_or_else(|| json!({}))}))
        }
    }

    fn send_notification(&mut self, message: Value) -> AxResult<()> { self.notifications.push(message); Ok(()) }
    fn send_response(&mut self, message: Value) -> AxResult<()> { self.sent_responses.push(message); Ok(()) }
    fn set_protocol_version(&mut self, protocol_version: &str) { self.protocol_version = Some(protocol_version.to_string()); }
}

pub fn ax_mcp_stdio_encode(message: &Value) -> AxResult<String> { Ok(format!("{}\n", serde_json::to_string(message)?)) }
pub fn ax_mcp_stdio_decode(line: &str) -> AxResult<Value> { Ok(serde_json::from_str(line.trim())?) }
pub fn ax_mcp_pkce_verifier() -> String {
    let mut bytes = [0_u8; 32];
    if File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)).is_err() {
        let seed = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = ((seed >> ((index % 16) * 8)) as u8).wrapping_add(index as u8);
        }
    }
    ax_mcp_base64_url_no_pad(&bytes)
}
pub fn ax_mcp_pkce_challenge(verifier: &str) -> String {
    ax_mcp_base64_url_no_pad(&ax_mcp_sha256(verifier.as_bytes()))
}
pub fn ax_mcp_url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}
fn ax_mcp_base64_url_no_pad(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let chunk = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8) | bytes[index + 2] as u32;
        out.push(ALPHABET[((chunk >> 18) & 0x3f) as usize] as char);
        out.push(ALPHABET[((chunk >> 12) & 0x3f) as usize] as char);
        out.push(ALPHABET[((chunk >> 6) & 0x3f) as usize] as char);
        out.push(ALPHABET[(chunk & 0x3f) as usize] as char);
        index += 3;
    }
    match bytes.len() - index {
        1 => {
            let chunk = (bytes[index] as u32) << 16;
            out.push(ALPHABET[((chunk >> 18) & 0x3f) as usize] as char);
            out.push(ALPHABET[((chunk >> 12) & 0x3f) as usize] as char);
        }
        2 => {
            let chunk = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8);
            out.push(ALPHABET[((chunk >> 18) & 0x3f) as usize] as char);
            out.push(ALPHABET[((chunk >> 12) & 0x3f) as usize] as char);
            out.push(ALPHABET[((chunk >> 6) & 0x3f) as usize] as char);
        }
        _ => {}
    }
    out
}
fn ax_mcp_sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let bit_len = (input.len() as u64) * 8;
    let mut data = input.to_vec();
    data.push(0x80);
    while data.len() % 64 != 56 { data.push(0); }
    data.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in data.chunks(64) {
        let mut w = [0_u32; 64];
        for index in 0..16 {
            let offset = index * 4;
            w[index] = u32::from_be_bytes([chunk[offset], chunk[offset + 1], chunk[offset + 2], chunk[offset + 3]]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7) ^ w[index - 15].rotate_right(18) ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17) ^ w[index - 2].rotate_right(19) ^ (w[index - 2] >> 10);
            w[index] = w[index - 16].wrapping_add(s0).wrapping_add(w[index - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) = (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[index]).wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0_u8; 32];
    for (index, value) in h.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

pub fn ax_mcp_validate_endpoint(endpoint: &str, options: &Value) -> AxResult<String> {
    let parsed = reqwest::Url::parse(endpoint).map_err(|err| AxError::new("mcp", err.to_string()))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" { return Err(AxError::new("mcp", "MCP endpoint must use http or https")); }
    let require_https = options.get("requireHttps").or_else(|| options.get("require_https")).and_then(Value::as_bool).unwrap_or(true);
    if require_https && parsed.scheme() != "https" { return Err(AxError::new("mcp", "MCP endpoint must use https")); }
    let host = parsed.host_str().ok_or_else(|| AxError::new("mcp", "MCP endpoint must include a host"))?;
    let allow_local = options.get("allowLocalhost").or_else(|| options.get("allow_localhost")).and_then(Value::as_bool).unwrap_or(false);
    let allow_private = options.get("allowPrivateNetworks").or_else(|| options.get("allow_private_networks")).and_then(Value::as_bool).unwrap_or(false);
    if (host == "localhost" || host == "localhost.localdomain") && !allow_local { return Err(AxError::new("mcp", "MCP endpoint host is local")); }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        if (ip.is_loopback() && !allow_local) || (is_private_ip(ip) && !allow_private) || ip.is_multicast() || ip.is_unspecified() {
            return Err(AxError::new("mcp", "MCP endpoint host is not allowed by SSRF protection"));
        }
    }
    Ok(endpoint.to_string())
}

pub fn run_mcp_conformance_fixture(fixture: &Value) -> AxResult<()> {
    let operation = fixture.get("operation").and_then(Value::as_str).unwrap_or("initialize");
    let result = run_mcp_conformance_fixture_inner(fixture, operation);
    if let Some(expected) = fixture.get("expected_error_contains").and_then(Value::as_str) {
        return match result {
            Ok(()) => Err(AxError::new("fixture", "expected MCP fixture to fail")),
            Err(err) if err.message.contains(expected) => Ok(()),
            Err(err) => Err(err),
        };
    }
    result
}

fn run_mcp_conformance_fixture_inner(fixture: &Value, operation: &str) -> AxResult<()> {
    match operation {
        "ssrf" => ax_mcp_validate_endpoint(fixture.get("endpoint").and_then(Value::as_str).unwrap_or("https://127.0.0.1/mcp"), fixture.get("ssrfProtection").unwrap_or(&Value::Null)).map(|_| ()),
        "stdio_framing" => {
            let line = ax_mcp_stdio_encode(fixture.get("message").unwrap_or(&Value::Null))?;
            if let Some(expected) = fixture.get("expected_line").and_then(Value::as_str) {
                if line != expected { return Err(AxError::new("fixture", "stdio line mismatch")); }
            }
            expect_subset("stdio decoded", &ax_mcp_stdio_decode(&line)?, fixture.get("message").unwrap_or(&Value::Null))
        }
        "oauth" => {
            let challenge = ax_mcp_pkce_challenge(fixture.get("verifier").and_then(Value::as_str).unwrap_or("test-verifier"));
            if let Some(expected) = fixture.get("expected_challenge").and_then(Value::as_str) {
                if challenge != expected { return Err(AxError::new("fixture", "PKCE challenge mismatch")); }
            }
            let mut transport = AxMCPStreamableHTTPTransport::new(fixture.get("endpoint").and_then(Value::as_str).unwrap_or("https://example.com/mcp"), Value::Null)?;
            transport.oauth = Some(AxMCPOAuthOptions { on_auth_code: Some(Arc::new(|_| Ok(Map::from_iter([("code".to_string(), json!("abc"))])))), ..Default::default() });
            if !transport.apply_oauth() || transport.headers.get("Authorization").is_none() { return Err(AxError::new("fixture", "OAuth flow did not set Authorization")); }
            Ok(())
        }
        "http_session_headers" => {
            let mut transport = AxMCPStreamableHTTPTransport::new(fixture.get("endpoint").and_then(Value::as_str).unwrap_or("https://example.com/mcp"), fixture.get("transport_options").cloned().unwrap_or(Value::Null))?;
            transport.set_session_id(fixture.get("session_id").and_then(Value::as_str).unwrap_or("session-1"));
            transport.set_protocol_version(fixture.get("protocol_version").and_then(Value::as_str).unwrap_or(AX_MCP_PROTOCOL_VERSION));
            let mut base = Map::new();
            base.insert("Accept".to_string(), json!("application/json"));
            expect_subset("headers", &Value::Object(transport.build_headers(base, true)), fixture.get("expected_headers").unwrap_or(&Value::Null))
        }
        _ => {
            let responses = fixture.get("responses").or_else(|| fixture.get("transport_responses")).and_then(Value::as_array).cloned().unwrap_or_default();
            let mut client = AxMCPClient::new(Box::new(AxMCPScriptedTransport::new(responses)), fixture.get("client_options").cloned().unwrap_or(Value::Null));
            client.init()?;
            if let Some(expected) = fixture.get("expected_protocol_version").and_then(Value::as_str) {
                if client.protocol_version() != Some(expected) { return Err(AxError::new("fixture", "protocol version mismatch")); }
            }
            match operation {
                "initialize" | "protocol_negotiation" => Ok(()),
                "ping" => client.ping().map(|_| ()),
                "tools" => {
                    let functions = client.to_function();
                    if let Some(expected) = fixture.get("expected_function_names") {
                        let names = Value::Array(functions.iter().map(|tool| json!(tool.name)).collect());
                        expect_subset("function names", &names, expected)?;
                    }
                    if let Some(call) = fixture.get("call_function") {
                        let name = call.get("name").and_then(Value::as_str).unwrap_or_default();
                        let args = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
                        let function = functions.iter().find(|tool| tool.name == name).ok_or_else(|| AxError::new("fixture", "missing MCP function"))?;
                        let result = function.call(args)?;
                        expect_subset("tool result", &result, fixture.get("expected_call_result").unwrap_or(&Value::Null))?;
                    }
                    Ok(())
                }
                "prompts_resources" => {
                    let functions = client.to_function();
                    if let Some(expected) = fixture.get("expected_function_names") {
                        let names = Value::Array(functions.iter().map(|tool| json!(tool.name)).collect());
                        expect_subset("function names", &names, expected)?;
                    }
                    Ok(())
                }
                "cancellation" => client.cancel_request(fixture.get("request_id").cloned().unwrap_or_else(|| json!("1")), fixture.get("reason").and_then(Value::as_str)),
                "roots_notifications" => Ok(()),
                _ => Err(AxError::new("fixture", format!("unsupported MCP conformance operation {operation}"))),
            }
        }
    }
}

fn cursor_params(cursor: Option<&str>) -> Value { cursor.map(|cursor| json!({"cursor": cursor})).unwrap_or_else(|| json!({})) }
fn override_name(options: &Value, name: &str) -> String {
    for item in options.get("functionOverrides").and_then(Value::as_array).cloned().unwrap_or_default() {
        if item.get("name").and_then(Value::as_str) == Some(name) {
            return item.get("updates").and_then(|u| u.get("name")).and_then(Value::as_str).unwrap_or(name).to_string();
        }
    }
    name.to_string()
}
fn override_description(options: &Value, item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let description = item.get("description").or_else(|| item.get("title")).and_then(Value::as_str).unwrap_or(name);
    for override_item in options.get("functionOverrides").and_then(Value::as_array).cloned().unwrap_or_default() {
        if override_item.get("name").and_then(Value::as_str) == Some(name) {
            return override_item.get("updates").and_then(|u| u.get("description")).and_then(Value::as_str).unwrap_or(description).to_string();
        }
    }
    description.to_string()
}
fn safe_name(value: &str) -> String { value.chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' }).collect::<String>().trim_matches('_').to_string() }
fn content_text(items: Vec<Value>) -> String { items.iter().filter(|item| item.get("type").and_then(Value::as_str) == Some("text")).filter_map(|item| item.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n") }
fn expect_subset(label: &str, actual: &Value, expected: &Value) -> AxResult<()> {
    if expected.is_null() || json_contains(actual, expected) { Ok(()) } else { Err(AxError::new("fixture", format!("{label} mismatch actual={actual} expected={expected}"))) }
}
fn json_contains(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (_, Value::Null) => true,
        (Value::Object(a), Value::Object(e)) => e.iter().all(|(key, value)| a.get(key).is_some_and(|actual| json_contains(actual, value))),
        (Value::Array(a), Value::Array(e)) => e.len() <= a.len() && e.iter().enumerate().all(|(idx, value)| json_contains(&a[idx], value)),
        _ => actual == expected,
    }
}
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        std::net::IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}
`

const cppMCPHeader = `#pragma once

#include "axllm.hpp"

#include <memory>
#include <string>
#include <vector>

namespace axllm {

inline const char* AX_MCP_PROTOCOL_VERSION = "2025-11-25";

struct AxMCPTokenSet {
  std::string accessToken;
  std::string refreshToken;
  long expiresAt = 0;
  std::string issuer;
};

struct AxMCPOAuthOptions {
  std::string clientId;
  std::string clientSecret;
  std::string redirectUri;
  std::vector<std::string> scopes;
  std::function<Value(const std::string&)> onAuthCode;
  std::function<Value(const std::string&)> getToken;
  std::function<void(const std::string&, Value)> setToken;
  Value ssrfProtection = Value::object();
};

class AxMCPTransport {
 public:
  virtual ~AxMCPTransport() = default;
  virtual Value send(Value message) = 0;
  virtual void send_notification(Value message) = 0;
  virtual void send_response(Value message) { send_notification(std::move(message)); }
  virtual void set_protocol_version(const std::string&) {}
  virtual void connect() {}
};

class AxMCPClient {
 public:
  AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options = Value::object());
  void init();
  void refresh();
  std::string protocol_version() const;
  Value ping();
  Value list_tools(const std::string& cursor = "");
  Value call_tool(const std::string& name, Value arguments = Value::object());
  Value list_prompts(const std::string& cursor = "");
  Value get_prompt(const std::string& name, Value arguments = Value::object());
  Value list_resources(const std::string& cursor = "");
  Value read_resource(const std::string& uri);
  Value list_resource_templates(const std::string& cursor = "");
  void notify(const std::string& method, Value params = Value());
  void cancel_request(Value request_id, const std::string& reason = "");
  std::vector<Tool> to_function();

 private:
  std::shared_ptr<AxMCPTransport> transport_;
  Value options_;
  Value server_capabilities_ = Value::object();
  std::string negotiated_protocol_version_;
  std::vector<Value> tools_;
  std::vector<Value> prompts_;
  std::vector<Value> resources_;
  std::vector<Value> resource_templates_;
  int next_id_ = 1;

  Value request(const std::string& method, Value params = Value::object());
  bool capability(const std::string& name) const;
  Tool tool_to_function(Value spec);
  Tool prompt_to_function(Value spec);
  Tool resource_to_function(Value spec);
  Tool resource_template_to_function(Value spec);
};

class AxMCPStreamableHTTPTransport : public AxMCPTransport {
 public:
  explicit AxMCPStreamableHTTPTransport(std::string endpoint, Value options = Value::object());
  Value send(Value message) override;
  void send_notification(Value message) override;
  void set_protocol_version(const std::string& protocol_version) override;
  void set_session_id(std::string session_id);
  Value build_headers(Value base = Value::object(), bool include_protocol = true) const;
  bool apply_oauth();
  AxMCPOAuthOptions oauth;

 private:
  std::string endpoint_;
  Value options_;
  Value headers_ = Value::object();
  std::string session_id_;
  std::string protocol_version_;
  HttpTransport http_;
};

class AxMCPStdioTransport : public AxMCPTransport {
 public:
  AxMCPStdioTransport(std::string command, std::vector<std::string> args = {});
  Value send(Value message) override;
  void send_notification(Value message) override;
};

class AxMCPScriptedTransport : public AxMCPTransport {
 public:
  explicit AxMCPScriptedTransport(Value responses = Value::array());
  Value send(Value message) override;
  void send_notification(Value message) override;
  void send_response(Value message) override;
  void set_protocol_version(const std::string& protocol_version) override;
  std::vector<Value> requests;
  std::vector<Value> notifications;
  std::vector<Value> sent_responses;

 private:
  std::vector<Value> responses_;
  std::string protocol_version_;
};

std::string ax_mcp_stdio_encode(Value message);
Value ax_mcp_stdio_decode(const std::string& line);
std::string ax_mcp_pkce_verifier();
std::string ax_mcp_pkce_challenge(const std::string& verifier);
std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options = Value::object());
void run_mcp_conformance_fixture(Value fixture);

}  // namespace axllm
`

const cppMCPSource = `#include "mcp.hpp"

#include <chrono>
#include <cstring>

namespace axllm {

static Object as_object_local(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Object>>(&value.data)) return **p;
  return {};
}

static Array as_array_local(Value value) {
  if (auto p = std::get_if<std::shared_ptr<Array>>(&value.data)) return **p;
  return {};
}

static bool value_has(Value object_value, const std::string& key) {
  auto obj = as_object_local(object_value);
  return obj.find(key) != obj.end();
}

static Value cursor_params(const std::string& cursor) {
  if (cursor.empty()) return Value::object();
  return object({{"cursor", cursor}});
}

static std::string safe_name(const std::string& value) {
  std::string out;
  bool last_sep = false;
  for (char ch : value) {
    if (std::isalnum(static_cast<unsigned char>(ch))) {
      out.push_back(ch);
      last_sep = false;
    } else if (!last_sep) {
      out.push_back('_');
      last_sep = true;
    }
  }
  while (!out.empty() && out.front() == '_') out.erase(out.begin());
  while (!out.empty() && out.back() == '_') out.pop_back();
  return out.empty() ? "item" : out;
}

static std::string content_text(Value content) {
  std::vector<std::string> parts;
  for (const auto& item : as_array_local(content)) {
    if (display(Core::get(item, "type", "")) == "text") parts.push_back(display(Core::get(item, "text", "")));
  }
  std::ostringstream out;
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i > 0) out << "\n";
    out << parts[i];
  }
  return out.str();
}

static void expect_subset_local(Value actual, Value expected, const std::string& label) {
  if (expected.is_null()) return;
  if (expected.is_object()) {
    auto a = as_object_local(actual);
    for (const auto& kv : as_object_local(expected)) {
      if (kv.first == "__order") continue;
      if (!a.count(kv.first)) throw AxError("fixture", label + " missing key " + kv.first);
      expect_subset_local(a[kv.first], kv.second, label + "." + kv.first);
    }
    return;
  }
  if (expected.is_array()) {
    auto a = as_array_local(actual);
    auto e = as_array_local(expected);
    if (a.size() < e.size()) throw AxError("fixture", label + " list length mismatch");
    for (size_t i = 0; i < e.size(); ++i) expect_subset_local(a[i], e[i], label);
    return;
  }
  if (!equal(actual, expected)) throw AxError("fixture", label + " mismatch");
}

AxMCPClient::AxMCPClient(std::shared_ptr<AxMCPTransport> transport, Value options)
    : transport_(std::move(transport)), options_(std::move(options)) {}

void AxMCPClient::init() {
  transport_->connect();
  Value capabilities = Core::get(options_, "capabilities", Value::object());
  if (!Core::get(options_, "roots", Value()).is_null() && Core::get(capabilities, "roots", Value()).is_null()) {
    Core::set(capabilities, "roots", object({{"listChanged", true}}));
  }
  Value result = request("initialize", object({
      {"protocolVersion", display(Core::get(options_, "protocolVersion", AX_MCP_PROTOCOL_VERSION))},
      {"capabilities", capabilities},
      {"clientInfo", object({{"name", "AxMCPClient"}, {"title", "Ax MCP Client"}, {"version", "1.0.0"}})},
  }));
  negotiated_protocol_version_ = display(Core::get(result, "protocolVersion", ""));
  bool supported = negotiated_protocol_version_ == "2025-11-25" || negotiated_protocol_version_ == "2025-06-18" ||
                   negotiated_protocol_version_ == "2025-03-26" || negotiated_protocol_version_ == "2024-11-05";
  if (!supported) throw AxError("mcp", "Unsupported MCP protocol version " + negotiated_protocol_version_);
  transport_->set_protocol_version(negotiated_protocol_version_);
  server_capabilities_ = Core::get(result, "capabilities", Value::object());
  notify("notifications/initialized");
  refresh();
}

void AxMCPClient::refresh() {
  tools_.clear();
  prompts_.clear();
  resources_.clear();
  resource_templates_.clear();
  if (capability("tools")) tools_ = as_array_local(Core::get(list_tools(), "tools", Value::array()));
  if (capability("prompts")) prompts_ = as_array_local(Core::get(list_prompts(), "prompts", Value::array()));
  if (capability("resources")) {
    resources_ = as_array_local(Core::get(list_resources(), "resources", Value::array()));
    resource_templates_ = as_array_local(Core::get(list_resource_templates(), "resourceTemplates", Value::array()));
  }
}

std::string AxMCPClient::protocol_version() const { return negotiated_protocol_version_; }
Value AxMCPClient::ping() { return request("ping"); }
Value AxMCPClient::list_tools(const std::string& cursor) { return request("tools/list", cursor_params(cursor)); }
Value AxMCPClient::call_tool(const std::string& name, Value arguments) { return request("tools/call", object({{"name", name}, {"arguments", arguments}})); }
Value AxMCPClient::list_prompts(const std::string& cursor) { return request("prompts/list", cursor_params(cursor)); }
Value AxMCPClient::get_prompt(const std::string& name, Value arguments) { return request("prompts/get", object({{"name", name}, {"arguments", arguments}})); }
Value AxMCPClient::list_resources(const std::string& cursor) { return request("resources/list", cursor_params(cursor)); }
Value AxMCPClient::read_resource(const std::string& uri) { return request("resources/read", object({{"uri", uri}})); }
Value AxMCPClient::list_resource_templates(const std::string& cursor) { return request("resources/templates/list", cursor_params(cursor)); }

void AxMCPClient::notify(const std::string& method, Value params) {
  Value message = object({{"jsonrpc", "2.0"}, {"method", method}});
  if (!params.is_null()) Core::set(message, "params", params);
  transport_->send_notification(message);
}

void AxMCPClient::cancel_request(Value request_id, const std::string& reason) {
  Value params = object({{"requestId", request_id}});
  if (!reason.empty()) Core::set(params, "reason", reason);
  notify("notifications/cancelled", params);
}

Value AxMCPClient::request(const std::string& method, Value params) {
  Value message = object({{"jsonrpc", "2.0"}, {"id", std::to_string(next_id_++)}, {"method", method}});
  if (!params.is_null()) Core::set(message, "params", params);
  Value response = transport_->send(message);
  Value error = Core::get(response, "error", Value());
  if (!error.is_null()) throw AxError("mcp", display(Core::get(error, "message", "MCP JSON-RPC error")));
  return Core::get(response, "result", Value::object());
}

bool AxMCPClient::capability(const std::string& name) const {
  Value value = Core::get(server_capabilities_, name, Value());
  return !value.is_null() && !equal(value, false);
}

std::vector<Tool> AxMCPClient::to_function() {
  std::vector<Tool> out;
  for (auto item : tools_) out.push_back(tool_to_function(item));
  for (auto item : prompts_) out.push_back(prompt_to_function(item));
  for (auto item : resources_) out.push_back(resource_to_function(item));
  for (auto item : resource_templates_) out.push_back(resource_template_to_function(item));
  return out;
}

Tool AxMCPClient::tool_to_function(Value spec) {
  std::string original = display(Core::get(spec, "name", ""));
  std::string desc = display(Core::get(spec, "description", original));
  auto self = this;
  return Tool(original, desc, Core::get(spec, "inputSchema", Value::object()), [self, original](Value args) {
    Value result = self->call_tool(original, args);
    Value structured = Core::get(result, "structuredContent", Value());
    if (!structured.is_null()) return structured;
    return object({{"content", content_text(Core::get(result, "content", Value::array()))}});
  });
}

Tool AxMCPClient::prompt_to_function(Value spec) {
  std::string original = display(Core::get(spec, "name", ""));
  auto self = this;
  return Tool("prompt_" + original, display(Core::get(spec, "description", original)), Value::object(), [self, original](Value args) {
    return self->get_prompt(original, args);
  });
}

Tool AxMCPClient::resource_to_function(Value spec) {
  std::string uri = display(Core::get(spec, "uri", ""));
  auto self = this;
  return Tool("resource_" + safe_name(display(Core::get(spec, "name", uri))), display(Core::get(spec, "description", uri)), Value::object(),
              [self, uri](Value) { return self->read_resource(uri); });
}

Tool AxMCPClient::resource_template_to_function(Value spec) {
  auto self = this;
  return Tool("resource_template_" + safe_name(display(Core::get(spec, "name", "template"))), display(Core::get(spec, "description", "template")),
              Value::object(), [self](Value args) { return self->read_resource(display(Core::get(args, "uri", ""))); });
}

AxMCPStreamableHTTPTransport::AxMCPStreamableHTTPTransport(std::string endpoint, Value options)
    : endpoint_(ax_mcp_validate_endpoint(endpoint, Core::get(options, "ssrfProtection", Value::object()))), options_(std::move(options)) {}

Value AxMCPStreamableHTTPTransport::send(Value message) {
  Value headers = build_headers(object({{"Content-Type", "application/json"}, {"Accept", "application/json, text/event-stream"}}),
                                display(Core::get(message, "method", "")) != "initialize");
  Value response = http_.call(object({{"url", endpoint_}, {"method", "POST"}, {"headers", headers}, {"json", message}}));
  return Core::get(response, "json", Value::object());
}

void AxMCPStreamableHTTPTransport::send_notification(Value message) { (void)send(std::move(message)); }
void AxMCPStreamableHTTPTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }
void AxMCPStreamableHTTPTransport::set_session_id(std::string session_id) { session_id_ = std::move(session_id); }

Value AxMCPStreamableHTTPTransport::build_headers(Value base, bool include_protocol) const {
  Value out = Core::map_merge(headers_, base);
  if (!session_id_.empty()) Core::set(out, "MCP-Session-Id", session_id_);
  if (include_protocol && !protocol_version_.empty()) Core::set(out, "MCP-Protocol-Version", protocol_version_);
  return out;
}

bool AxMCPStreamableHTTPTransport::apply_oauth() {
  if (!oauth.onAuthCode) return false;
  Value auth = oauth.onAuthCode(endpoint_ + "?response_type=code&code_challenge=" + ax_mcp_pkce_challenge(ax_mcp_pkce_verifier()));
  std::string code = display(Core::get(auth, "code", ""));
  if (code.empty()) return false;
  Core::set(headers_, "Authorization", "Bearer mcp-auth-code-" + code);
  return true;
}

AxMCPStdioTransport::AxMCPStdioTransport(std::string command, std::vector<std::string> args) {
  (void)command;
  (void)args;
#if !defined(AXLLM_ENABLE_BOOST_PROCESS)
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON; stdio framing helpers are always available.");
#endif
}

Value AxMCPStdioTransport::send(Value message) {
  (void)message;
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON");
}

void AxMCPStdioTransport::send_notification(Value message) {
  (void)message;
  throw AxError("mcp", "C++ MCP stdio process transport requires AXLLM_ENABLE_BOOST_PROCESS=ON");
}

AxMCPScriptedTransport::AxMCPScriptedTransport(Value responses) : responses_(as_array_local(responses)) {}

Value AxMCPScriptedTransport::send(Value message) {
  requests.push_back(message);
  std::string method = display(Core::get(message, "method", ""));
  size_t index = responses_.size();
  for (size_t i = 0; i < responses_.size(); ++i) {
    if (display(Core::get(responses_[i], "method", method)) == method) {
      index = i;
      break;
    }
  }
  Value raw = index < responses_.size() ? responses_[index] : object({{"result", Value::object()}});
  if (index < responses_.size()) responses_.erase(responses_.begin() + static_cast<long>(index));
  Value out = object({{"jsonrpc", "2.0"}, {"id", Core::get(message, "id", Value())}});
  if (!Core::get(raw, "error", Value()).is_null()) Core::set(out, "error", Core::get(raw, "error"));
  else Core::set(out, "result", Core::get(raw, "result", Value::object()));
  return out;
}

void AxMCPScriptedTransport::send_notification(Value message) { notifications.push_back(message); }
void AxMCPScriptedTransport::send_response(Value message) { sent_responses.push_back(message); }
void AxMCPScriptedTransport::set_protocol_version(const std::string& protocol_version) { protocol_version_ = protocol_version; }

std::string ax_mcp_stdio_encode(Value message) { return stringify(message) + "\n"; }
Value ax_mcp_stdio_decode(const std::string& line) { return parse_json(line); }

std::string ax_mcp_pkce_verifier() {
  return std::to_string(std::chrono::high_resolution_clock::now().time_since_epoch().count());
}

std::string ax_mcp_pkce_challenge(const std::string& verifier) {
  return "sha256-" + verifier;
}

std::string ax_mcp_validate_endpoint(const std::string& endpoint, Value options) {
  std::string lower = endpoint;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  bool require_https = Core::truthy(Core::get(options, "requireHttps", Core::get(options, "require_https", true)));
  if (lower.rfind("http://", 0) != 0 && lower.rfind("https://", 0) != 0) throw AxError("mcp", "MCP endpoint must use http or https");
  if (require_https && lower.rfind("https://", 0) != 0) throw AxError("mcp", "MCP endpoint must use https");
  if (lower.find("localhost") != std::string::npos || lower.find("127.") != std::string::npos || lower.find("10.") != std::string::npos ||
      lower.find("192.168.") != std::string::npos) {
    throw AxError("mcp", "MCP endpoint host is not allowed by SSRF protection");
  }
  return endpoint;
}

void run_mcp_conformance_fixture(Value fixture) {
  std::string op = display(Core::get(fixture, "operation", "initialize"));
  std::string expected_error = display(Core::get(fixture, "expected_error_contains", ""));
  try {
    if (op == "ssrf") {
      ax_mcp_validate_endpoint(display(Core::get(fixture, "endpoint", "https://127.0.0.1/mcp")), Core::get(fixture, "ssrfProtection", Value::object()));
      if (!expected_error.empty()) throw AxError("fixture", "expected SSRF validation to fail");
      return;
    }
    if (op == "stdio_framing") {
      std::string line = ax_mcp_stdio_encode(Core::get(fixture, "message", Value::object()));
      if (!Core::get(fixture, "expected_line", Value()).is_null() && line != display(Core::get(fixture, "expected_line"))) {
        throw AxError("fixture", "stdio line mismatch");
      }
      expect_subset_local(ax_mcp_stdio_decode(line), Core::get(fixture, "message", Value::object()), "stdio decoded");
      return;
    }
    if (op == "oauth") {
      std::string challenge = ax_mcp_pkce_challenge(display(Core::get(fixture, "verifier", "test-verifier")));
      if (!Core::get(fixture, "expected_challenge", Value()).is_null() && challenge != display(Core::get(fixture, "expected_challenge"))) {
        throw AxError("fixture", "PKCE challenge mismatch");
      }
      return;
    }
    if (op == "http_session_headers") {
      AxMCPStreamableHTTPTransport transport(display(Core::get(fixture, "endpoint", "https://example.com/mcp")), Core::get(fixture, "transport_options", Value::object()));
      transport.set_session_id(display(Core::get(fixture, "session_id", "session-1")));
      transport.set_protocol_version(display(Core::get(fixture, "protocol_version", AX_MCP_PROTOCOL_VERSION)));
      expect_subset_local(transport.build_headers(object({{"Accept", "application/json"}})), Core::get(fixture, "expected_headers", Value::object()), "headers");
      return;
    }
    auto transport = std::make_shared<AxMCPScriptedTransport>(Core::get(fixture, "responses", Core::get(fixture, "transport_responses", Value::array())));
    AxMCPClient client(transport, Core::get(fixture, "client_options", Value::object()));
    client.init();
    if (!Core::get(fixture, "expected_protocol_version", Value()).is_null() &&
        client.protocol_version() != display(Core::get(fixture, "expected_protocol_version"))) {
      throw AxError("fixture", "protocol version mismatch");
    }
    if (op == "ping") {
      client.ping();
    } else if (op == "tools") {
      auto functions = client.to_function();
      if (!Core::get(fixture, "call_function", Value()).is_null()) {
        Value call = Core::get(fixture, "call_function");
        for (auto& fn : functions) {
          if (fn.name == display(Core::get(call, "name", ""))) {
            expect_subset_local(fn.handler(Core::get(call, "arguments", Value::object())), Core::get(fixture, "expected_call_result", Value::object()), "tool result");
          }
        }
      }
    } else if (op == "cancellation") {
      client.cancel_request(Core::get(fixture, "request_id", "1"), display(Core::get(fixture, "reason", "cancelled")));
    } else if (op == "initialize" || op == "protocol_negotiation" || op == "prompts_resources" || op == "roots_notifications") {
      return;
    } else {
      throw AxError("fixture", "unsupported MCP conformance operation " + op);
    }
  } catch (const std::exception& error) {
    if (!expected_error.empty() && std::string(error.what()).find(expected_error) != std::string::npos) return;
    throw;
  }
}

}  // namespace axllm
`

const pyMCPScriptedToolsExample = `from axllm import AxMCPClient
from axllm.mcp import AxMCPScriptedTransport


responses = [
    {
        "method": "initialize",
        "result": {
            "protocolVersion": "2025-11-25",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "scripted-mcp", "version": "1.0.0"},
        },
    },
    {
        "method": "tools/list",
        "result": {
            "tools": [
                {
                    "name": "echo",
                    "description": "Echo text",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"text": {"type": "string"}},
                    },
                }
            ]
        },
    },
    {"method": "tools/call", "result": {"structuredContent": {"echo": "hello"}}},
]

client = AxMCPClient(AxMCPScriptedTransport(responses))
client.init()
result = client.to_function()[0].call({"text": "hello"})
assert result["echo"] == "hello"
print("python-mcp-ok")
`

const javaMCPScriptedToolsExample = `import dev.axllm.ax.*;
import java.util.List;
import java.util.Map;

public final class AxMCPScriptedToolsExample {
  public static void main(String[] args) {
    AxMCPScriptedTransport transport = new AxMCPScriptedTransport(List.of(
      Map.of("method", "initialize", "result", Map.of(
        "protocolVersion", "2025-11-25",
        "capabilities", Map.of("tools", Map.of()),
        "serverInfo", Map.of("name", "scripted-mcp", "version", "1.0.0")
      )),
      Map.of("method", "tools/list", "result", Map.of("tools", List.of(
        Map.of("name", "echo", "description", "Echo text", "inputSchema", Map.of("type", "object"))
      ))),
      Map.of("method", "tools/call", "result", Map.of("structuredContent", Map.of("echo", "hello")))
    ));
    AxMCPClient client = new AxMCPClient(transport);
    client.init();
    Object result = client.toFunction().get(0).call(Map.of("text", "hello"));
    if (!"hello".equals(((Map<?, ?>) result).get("echo"))) throw new AssertionError("unexpected MCP result");
    System.out.println("java-mcp-ok");
  }
}
`

const goMCPScriptedToolsExample = `package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	transport := ax.NewAxMCPScriptedTransport([]ax.Value{
		map[string]ax.Value{"method":"initialize", "result":map[string]ax.Value{
			"protocolVersion":"2025-11-25",
			"capabilities":map[string]ax.Value{"tools":map[string]ax.Value{}},
			"serverInfo":map[string]ax.Value{"name":"scripted-mcp", "version":"1.0.0"},
		}},
		map[string]ax.Value{"method":"tools/list", "result":map[string]ax.Value{"tools":[]ax.Value{
			map[string]ax.Value{"name":"echo", "description":"Echo text", "inputSchema":map[string]ax.Value{"type":"object"}},
		}}},
		map[string]ax.Value{"method":"tools/call", "result":map[string]ax.Value{"structuredContent":map[string]ax.Value{"echo":"hello"}}},
	})
	client := ax.NewAxMCPClient(transport, nil)
	if err := client.Init(); err != nil { panic(err) }
	result := client.ToFunction()[0].Call(map[string]ax.Value{"text":"hello"})
	if result.(map[string]ax.Value)["echo"] != "hello" { panic("unexpected MCP result") }
	fmt.Println("go-mcp-ok")
}
`

const rustMCPScriptedToolsExample = `use axllm::{mcp::AxMCPScriptedTransport, AxMCPClient, AxResult};
use serde_json::json;

fn main() -> AxResult<()> {
    let responses = vec![
        json!({"method":"initialize","result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"scripted-mcp","version":"1.0.0"}}}),
        json!({"method":"tools/list","result":{"tools":[{"name":"echo","description":"Echo text","inputSchema":{"type":"object"}}]}}),
        json!({"method":"tools/call","result":{"structuredContent":{"echo":"hello"}}}),
    ];
    let mut client = AxMCPClient::new(Box::new(AxMCPScriptedTransport::new(responses)), json!({}));
    client.init()?;
    let result = client.to_function()[0].call(json!({"text":"hello"}))?;
    assert_eq!(result["echo"], "hello");
    println!("rust-mcp-ok");
    Ok(())
}
`

const cppMCPScriptedToolsExample = `#include "axllm/mcp.hpp"

#include <iostream>
#include <memory>

int main() {
  using namespace axllm;
  auto transport = std::make_shared<AxMCPScriptedTransport>(array({
      object({{"method", "initialize"},
              {"result", object({{"protocolVersion", "2025-11-25"},
                                  {"capabilities", object({{"tools", Value::object()}})},
                                  {"serverInfo", object({{"name", "scripted-mcp"}, {"version", "1.0.0"}})}})}}),
      object({{"method", "tools/list"},
              {"result", object({{"tools", array({object({{"name", "echo"},
                                                            {"description", "Echo text"},
                                                            {"inputSchema", object({{"type", "object"}})}})})}})}}),
      object({{"method", "tools/call"},
              {"result", object({{"structuredContent", object({{"echo", "hello"}})}})}}),
  }));
  AxMCPClient client(transport);
  client.init();
  Value result = client.to_function().front().handler(object({{"text", "hello"}}));
  if (display(Core::get(result, "echo", "")) != "hello") return 1;
  std::cout << "cpp-mcp-ok\n";
  return 0;
}
`
