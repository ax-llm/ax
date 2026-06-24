"""Drive AxMCPStreamableHTTPTransport.send() through the REAL urllib transport
against an in-process loopback server that answers the JSON-RPC POST with
Content-Type: text/event-stream -- the MCP Streamable HTTP SSE path the
ScriptedTransport conformance fixtures bypass. The SSE body interleaves a
notification ahead of the id-matched response, so a transport that ignored the
Content-Type (json.loads on the raw stream) or returned the first data frame
would fail. Exits non-zero on any mismatch so axir verify fails if the SSE
branch regresses."""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from axllm import AxMCPStreamableHTTPTransport

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
        self.rfile.read(length)
        payload = SSE_BODY.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


server = HTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    transport = AxMCPStreamableHTTPTransport(
        f"http://127.0.0.1:{port}/mcp",
        {"ssrfProtection": {"requireHttps": False, "allowLocalhost": True, "allowPrivateNetworks": True}},
    )
    response = transport.send(
        {"jsonrpc": "2.0", "id": "ax-sse-1", "method": "tools/call", "params": {"name": "noop"}}
    )
    assert response.get("id") == "ax-sse-1", f"SSE selector returned wrong message: {response}"
    assert response.get("result", {}).get("ok") is True, f"SSE result not decoded: {response}"
finally:
    server.shutdown()

print("mcp-sse-roundtrip-ok")
