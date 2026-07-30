"""Exercise the modern MCP client through a real in-process HTTP loopback."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from axllm import AxMCPClient, AxMCPStreamableHTTPTransport


class Handler(BaseHTTPRequestHandler):
    calls = 0
    tool_lists = 0
    failures = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        method = request.get("method")
        params = request.get("params") or {}
        if method == "initialize":
            self.failures.append("modern client sent initialize")
        if method != "server/discover" and "_meta" not in params:
            self.failures.append(f"{method} omitted request _meta")
        Handler.calls += 1
        meta = {"io.modelcontextprotocol/serverInfo": {"name": "modern-loopback", "version": f"1.0.{self.calls}"}}
        result = {"resultType": "complete", "_meta": meta}
        if method == "server/discover":
            result = {"resultType": "complete", "supportedVersions": ["2026-07-28"], "capabilities": {"tools": {}, "extensions": {"io.modelcontextprotocol/tasks": {}}}, "ttlMs": 60000, "cacheScope": "public", "_meta": meta}
        elif method == "tools/list":
            Handler.tool_lists += 1
            result.update({
                "tools": [
                    {"name": "start_reindex", "inputSchema": {"type": "object", "properties": {"scope": {"type": "string", "x-mcp-header": "Scope"}}}},
                    {"name": "mrtr_roots_round", "inputSchema": {"type": "object", "properties": {}}},
                ],
                "ttlMs": 60000,
                "cacheScope": "public",
            })
        elif method == "tools/call" and params.get("name") == "start_reindex":
            if self.headers.get("Mcp-Param-Scope") != "all":
                self.failures.append("Mcp-Param-Scope was not propagated")
            result = {"resultType": "task", "taskId": "task-1", "status": "working", "createdAt": "2026-07-29T00:00:00Z", "lastUpdatedAt": "2026-07-29T00:00:00Z", "ttlMs": None, "_meta": meta}
        elif method == "tasks/get":
            result = {"taskId": "task-1", "status": "completed", "createdAt": "2026-07-29T00:00:00Z", "lastUpdatedAt": "2026-07-29T00:00:01Z", "ttlMs": None, "result": {"resultType": "complete", "structuredContent": {"indexed": 42}, "_meta": meta}, "_meta": meta}
        elif method == "tools/call" and "requestState" not in params:
            result = {"resultType": "input_required", "inputRequests": {"roots": {"method": "roots/list"}}, "requestState": "opaque-roots-state", "_meta": meta}
        elif method == "tools/call":
            if params.get("requestState") != "opaque-roots-state" or params.get("inputResponses", {}).get("roots", {}).get("roots", [{}])[0].get("uri") != "file:///workspace":
                self.failures.append("roots MRTR response was not echoed")
            result.update({"structuredContent": {"roots": 1}})
        payload = json.dumps({"jsonrpc": "2.0", "id": request.get("id"), "result": result}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


server = HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    transport = AxMCPStreamableHTTPTransport(
        f"http://127.0.0.1:{server.server_address[1]}/mcp",
        {"ssrfProtection": {"requireHttps": False, "allowLocalhost": True, "allowPrivateNetworks": True}},
    )
    client = AxMCPClient(transport, {"era": "modern", "roots": [{"uri": "file:///workspace", "name": "workspace"}]})
    client.init()
    assert client.get_era() == "modern"
    client.refresh(force=False)
    task = client.call_tool("start_reindex", {"scope": "all"})
    assert task.get("structuredContent", {}).get("indexed") == 42, task
    roots = client.call_tool("mrtr_roots_round", {})
    assert roots.get("structuredContent", {}).get("roots") == 1, roots
    catalog = client.inspect_catalog()
    assert Handler.tool_lists == 1, "cacheable tools/list was fetched again"
    assert not Handler.failures, Handler.failures
    assert catalog.get("serverInfo", {}).get("version") != "1.0.1", catalog.get("serverInfo")
    client.close()
finally:
    server.shutdown()

print("mcp-modern-roundtrip-ok")
