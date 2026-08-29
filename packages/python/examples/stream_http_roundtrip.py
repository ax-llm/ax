"""Drive a streaming chat through the REAL urllib transport against an
in-process loopback server that returns a spec-legal text/event-stream body
with a MULTI-LINE data: event and CRLF line endings. The conformance
ScriptedTransport only ever feeds single-line data: JSON, so this is the only
end-to-end coverage for the SSE line-folding that src/ax/util/sse.ts performs.
Exits non-zero on any mismatch so `axir verify` fails if it regresses."""

import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from axllm import OpenAICompatibleClient

# One logical chat-completion delta whose JSON is split across two data: lines
# (folded with "\n" into ...,"delta":\n{"content":"Hello "}}), then a normal
# single-line delta accepted at EOF without a trailing delimiter.
EVENT1A = '{"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":'
EVENT1B = '{"content":"Hello 🌍 "}}]}'
EVENT2 = '{"id":"chatcmpl_stream","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":"stop"}]}'
SSE_FIRST = (
    "\ufeffdatabase: ignored\r\n"
    + "data: " + EVENT1A + "\r\n"
    + "data: " + EVENT1B + "\r\n"
    + "\r\n"
).encode()
SSE_REST = ("data: " + EVENT2).encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(SSE_FIRST) + len(SSE_REST)))
        self.end_headers()
        for byte in SSE_FIRST:
            self.wfile.write(bytes([byte]))
            self.wfile.flush()
        time.sleep(0.3)
        self.wfile.write(SSE_REST)
        self.wfile.flush()


server = HTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    client = OpenAICompatibleClient(
        api_key="test-key", base_url=f"http://127.0.0.1:{port}", model="gpt-5.4-mini"
    )
    started = time.perf_counter()
    stream = client.stream({"chat_prompt": [{"role": "user", "content": "stream"}]})
    first = next(stream)
    ttft = time.perf_counter() - started
    events = [first, *stream]
    completion = time.perf_counter() - started
    assert completion - ttft >= 0.2, f"first event was not incremental: ttft={ttft} completion={completion}"
    deltas = [(event.get("results") or [{}])[0].get("content") for event in events]
    deltas = [delta for delta in deltas if delta]
    assert deltas[:1] == ["Hello 🌍 "], (
        f"multi-line data: event was not folded into one JSON value: {deltas}"
    )
    assert "".join(deltas) == "Hello 🌍 world", f"bad stream fold: {deltas}"
finally:
    server.shutdown()

print("stream-http-roundtrip-ok")
