from __future__ import annotations
import os

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


# AXIR_CORE_MCP_FUNCTIONS


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


@dataclass
class AxMCPContinuationState:
    namespaces: list[str]
    tasks: list[dict[str, Any]]
    subscriptions: list[dict[str, Any]]
    catalogFingerprint: str


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

    def namespace(self) -> str:
        return str(self.options.get("namespace") or (self.server_info or {}).get("name") or "mcp")

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
                return self.send(message)
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
