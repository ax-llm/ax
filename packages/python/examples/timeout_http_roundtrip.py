"""Time requests out through the REAL urllib transport against in-process
loopback servers. A call's timeout (TypeScript's per-call timeout, in
milliseconds) ends a chat or a stream whose response has not started, and the
request layer does not retry it. A stream whose response has started runs past
it, because the timer stops at the response headers, as in TypeScript's
apiCall. Exits non-zero on any mismatch so `axir verify` fails if it regresses."""

import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from axllm import AxAIServiceTimeoutError, OpenAICompatibleClient

# A server that accepts connections and never answers.
silent = socket.socket()
silent.bind(("127.0.0.1", 0))
silent.listen(16)
accepted = []


def hold():
    while True:
        try:
            connection, _ = silent.accept()
        except OSError:
            return
        accepted.append(connection)


threading.Thread(target=hold, daemon=True).start()
request = {"chat_prompt": [{"role": "user", "content": "hi"}]}
client = OpenAICompatibleClient(
    api_key="test-key", base_url=f"http://127.0.0.1:{silent.getsockname()[1]}", model="gpt-5.4-mini"
)


def expect_timeout(label, run):
    started = time.monotonic()
    try:
        run()
    except AxAIServiceTimeoutError as error:
        assert "Request timed out after 200ms" in str(error), f"{label}: {error}"
        elapsed = time.monotonic() - started
        assert elapsed < 5, f"{label}: timed out after {elapsed:.2f} s"
        return
    raise AssertionError(f"{label}: the request did not time out")


expect_timeout("chat", lambda: client.chat(request, {"timeout": 200}))
expect_timeout("stream", lambda: list(client.stream(request, {"timeout": 200})))
assert len(accepted) == 2, f"a timed-out request was retried: {len(accepted)} connections"


# A stream whose headers arrive at once and whose second event comes after more
# than the timeout.
def event(content, finish):
    return (
        '{"id":"chatcmpl_slow","model":"gpt-5.4-mini","choices":[{"index":0,"delta":{"content":"'
        + content
        + '"},"finish_reason":'
        + finish
        + "}]}"
    )


class Slow(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(("data: " + event("Hel", "null") + "\n\n").encode())
        self.wfile.flush()
        time.sleep(1.5)
        self.wfile.write(("data: " + event("lo", '"stop"') + "\n\ndata: [DONE]\n\n").encode())
        self.wfile.flush()


server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    slow = OpenAICompatibleClient(
        api_key="test-key", base_url=f"http://127.0.0.1:{server.server_address[1]}", model="gpt-5.4-mini"
    )
    events = list(slow.stream(request, {"timeout": 1000}))
    text = "".join((event.get("results") or [{}])[0].get("content") or "" for event in events)
    assert text == "Hello", f"a started stream was cut off: {text!r}"
finally:
    server.shutdown()
    silent.close()

print("timeout-http-roundtrip-ok")
