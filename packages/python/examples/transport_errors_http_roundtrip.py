"""Send requests through the REAL urllib transport to in-process loopback
servers that fail the way networks do, and check that the failures surface as
TypeScript's apiCall reports fetch's: a refused or dropped connection is
AxAIServiceNetworkError ("Network Error: ..."), which a stream's request layer
retries under the call's retry options; a timeout is AxAIServiceTimeoutError
("Request timed out after <ms>ms", the client's timeout in milliseconds), which
the request layer never retries; and AxGen retries both as infrastructure
errors. Exits non-zero on any mismatch so `axir verify` fails if it regresses."""

import http.client
import socket
import threading
import time

from axllm import (
    AxAIServiceError,
    AxAIServiceNetworkError,
    AxAIServiceTimeoutError,
    OpenAICompatibleClient,
    ax,
    typesafe,
)

GATEWAY_BODY = b'{"error":{"message":"upstream timed out","type":"server_error"}}'
GATEWAY_RESPONSE = (
    b"HTTP/1.1 504 Gateway Timeout\r\nContent-Type: application/json\r\n"
    + f"Content-Length: {len(GATEWAY_BODY)}\r\nConnection: close\r\n\r\n".encode()
    + GATEWAY_BODY
)
DROP_EVENT = (
    b'data: {"id":"chatcmpl_drop","object":"chat.completion.chunk","created":0,"model":"gpt-6-luna",'
    b'"choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n\n'
)


def read_request(connection):
    """Read the request headers and its Content-Length body."""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = connection.recv(65536)
        if not chunk:
            return
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    length = 0
    for line in head.split(b"\r\n")[1:]:
        name, _, value = line.partition(b":")
        if name.strip().lower() == b"content-length":
            length = int(value.strip())
    while len(body) < length:
        chunk = connection.recv(65536)
        if not chunk:
            return
        body += chunk


def serve(mode):
    """Accept connections and count them: "close" closes each one without a
    response, "drop" sends one stream event and drops it, "gateway" answers 504,
    "hold" never answers."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(16)
    state = {"connections": 0, "held": []}

    def run():
        while True:
            try:
                connection, _ = listener.accept()
            except OSError:
                return
            state["connections"] += 1
            if mode == "hold":
                state["held"].append(connection)
                continue
            try:
                read_request(connection)
                if mode == "drop":
                    head = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n"
                    connection.sendall(head + f"{len(DROP_EVENT):x}\r\n".encode() + DROP_EVENT + b"\r\n")
                    time.sleep(0.05)
                elif mode == "gateway":
                    connection.sendall(GATEWAY_RESPONSE)
            except OSError:
                pass
            connection.close()

    threading.Thread(target=run, daemon=True).start()
    return listener.getsockname()[1], state


def closed_port():
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    return port


def client(port, **options):
    return OpenAICompatibleClient(api_key="test-key", base_url=f"http://127.0.0.1:{port}", model="gpt-6-luna", **options)


def expect(label, error_type, prefix, run):
    try:
        run()
    except Exception as error:  # noqa: BLE001
        current = error
        while current is not None and not isinstance(current, error_type):
            current = current.__cause__
        assert current is not None, f"{label}: want {error_type.__name__}, got {type(error).__name__}: {error}"
        assert str(current).startswith(prefix), f"{label}: {str(current)!r} does not start with {prefix!r}"
        return current
    raise AssertionError(f"{label}: no error")


request = {"chat_prompt": [{"role": "user", "content": "hi"}]}
fast_retry = {"maxRetries": 2, "initialDelayMs": 10, "maxDelayMs": 20}

# A refused connection.
refused = client(closed_port())
expect("refused chat", AxAIServiceNetworkError, "Network Error: ", lambda: refused.chat(request, {"stream": False}))
expect("refused stream", AxAIServiceNetworkError, "Network Error: ", lambda: list(refused.stream(request, {"retry": fast_retry})))

# A server that closes each connection without a response. The stream's
# request layer retries it: the first request and two retries.
closing, closed = serve("close")
expect("closed chat", AxAIServiceNetworkError, "Network Error: ", lambda: client(closing).chat(request, {"stream": False}))
before = closed["connections"]
expect("closed stream", AxAIServiceNetworkError, "Network Error: ", lambda: list(client(closing).stream(request, {"retry": fast_retry})))
assert closed["connections"] - before == 3, f"closed stream: {closed['connections'] - before} requests"

# A 504 response is retried by its status, as TS apiCall retries it: it is not a
# timeout the request ran out of.
gateway, answered = serve("gateway")
try:
    list(client(gateway).stream(request, {"retry": fast_retry}))
except AxAIServiceError:
    pass
else:
    raise AssertionError("gateway stream: no error")
assert answered["connections"] == 3, f"gateway stream: {answered['connections']} requests"

# The client's own timeout (seconds) ends a chat or a stream whose response has
# not started, in TS's words, and the request layer does not retry it.
silent, held = serve("hold")
before = held["connections"]
timeout_error = expect("timed-out chat", AxAIServiceTimeoutError, "Request timed out after 300ms", lambda: client(silent, timeout=0.3).chat(request, {"stream": False}))
assert not isinstance(timeout_error, AxAIServiceNetworkError)
expect("timed-out stream", AxAIServiceTimeoutError, "Request timed out after 300ms", lambda: list(client(silent, timeout=0.3).stream(request, {"retry": fast_retry})))
assert held["connections"] - before == 2, f"a timed-out request was retried: {held['connections'] - before} requests"

# A server that sends one event and drops the connection: the stream ends in a
# network error after the event, and is not retried.
dropping, dropped = serve("drop")
delivered = []


def consume():
    for event in client(dropping).stream(request, {"retry": fast_retry}):
        delivered.append(event)


dropped_error = expect("dropped stream", AxAIServiceNetworkError, "Network Error: ", consume)
# Ax25 exposes the Ax error type and preserves the native exception as its cause.
assert not isinstance(dropped_error, http.client.IncompleteRead), f"dropped stream: {type(dropped_error).__mro__}"
assert isinstance(dropped_error.__cause__, http.client.IncompleteRead)
assert len(delivered) == 1 and dropped["connections"] == 1, f"dropped stream: {len(delivered)} events, {dropped['connections']} requests"

# The Typesafe client types the same failures, and does not retry a timeout.
expect("Typesafe refused", AxAIServiceNetworkError, "Network Error: ", lambda: typesafe(api_key="test-key", base_url=f"http://127.0.0.1:{closed_port()}", retry=fast_retry).list_models())
before = held["connections"]
expect("Typesafe timeout", AxAIServiceTimeoutError, "Request timed out after 300ms", lambda: typesafe(api_key="test-key", base_url=f"http://127.0.0.1:{silent}", timeout=0.3, retry=fast_retry).list_models())
assert held["connections"] - before == 1, f"a timed-out Typesafe request was retried: {held['connections'] - before} requests"

# AxGen retries a network error and a timeout as infrastructure errors. The
# client's own retries are off, so each request is one AxGen attempt:
# maxRetries 1 is the first attempt and one retry.
for stream in (False, True):
    before = closed["connections"]
    expect(
        f"AxGen network (stream {stream})",
        AxAIServiceNetworkError,
        "Network Error: ",
        lambda: ax("question:string -> answer:string").forward(client(closing, retry={"maxRetries": 0}), {"question": "hi"}, {"maxRetries": 1, "stream": stream}),
    )
    assert closed["connections"] - before == 2, f"AxGen network (stream {stream}): {closed['connections'] - before} requests"
    before = held["connections"]
    expect(
        f"AxGen timeout (stream {stream})",
        AxAIServiceTimeoutError,
        "Request timed out after 200ms",
        lambda: ax("question:string -> answer:string").forward(client(silent, retry={"maxRetries": 0}), {"question": "hi"}, {"maxRetries": 1, "stream": stream, "timeoutMs": 200}),
    )
    assert held["connections"] - before == 2, f"AxGen timeout (stream {stream}): {held['connections'] - before} requests"

print("transport-errors-http-roundtrip-ok")
