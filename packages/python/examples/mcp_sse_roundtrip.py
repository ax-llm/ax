"""Drive AxMCPStreamableHTTPTransport.send() through the REAL urllib transport
against an in-process loopback server that answers the JSON-RPC POST with
Content-Type: text/event-stream -- the MCP Streamable HTTP SSE path the
ScriptedTransport conformance fixtures bypass. The SSE body interleaves a
notification ahead of the id-matched response, so a transport that ignored the
Content-Type (json.loads on the raw stream) or returned the first data frame
would fail. Exits non-zero on any mismatch so axir verify fails if the SSE
branch regresses."""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from axllm import AxMCPClient, AxMCPStreamableHTTPTransport

SSE_BODY = (
    ": keepalive\n"
    "event: message\n"
    'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info"}}\n'
    "\n"
    "event: message\n"
    'data: {"jsonrpc":"2.0","id":"ax-sse-1","result":{"ok":true,"protocolVersion":"2025-11-25"}}\n'
    "\n"
)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        method = request.get("method")
        if method == "server/discover":
            payload = json.dumps({"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32601, "message": "Method not found"}}).encode()
            content_type = "application/json"
        elif method == "initialize":
            payload = json.dumps({"jsonrpc": "2.0", "id": request.get("id"), "result": {"protocolVersion": "2025-11-25", "capabilities": {}, "serverInfo": {"name": "legacy-loopback", "version": "1.0.0"}}}).encode()
            content_type = "application/json"
        elif method == "notifications/initialized":
            payload = b""
            content_type = "application/json"
        else:
            payload = SSE_BODY.replace('"ax-sse-1"', json.dumps(request.get("id"))).encode()
            content_type = "text/event-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.send_response(405)
        self.send_header("Content-Length", "0")
        self.end_headers()


server = HTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    transport = AxMCPStreamableHTTPTransport(
        f"http://127.0.0.1:{port}/mcp",
        {"ssrfProtection": {"requireHttps": False, "allowLocalhost": True, "allowPrivateNetworks": True}},
    )
    client = AxMCPClient(transport)
    client.init()
    assert client.get_era() == "legacy", f"auto discovery did not fall back: {client.get_era()}"
    response = client.call_tool("noop", {})
    assert response.get("ok") is True, f"SSE result not decoded: {response}"
    client.close()
finally:
    server.shutdown()

print("mcp-sse-roundtrip-ok")
