"""Drive transcribe()/speak() through the REAL urllib transport against an
in-process loopback server, exercising the wire-level encoders the conformance
ScriptedTransport bypasses: the multipart/form-data request body (transcribe)
and binary (non-UTF8) response handling (speak). Exits non-zero on any mismatch
so `axir verify` fails if either regresses."""

import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from axllm import OpenAIResponsesClient

# Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression on the binary
# path corrupts them detectably.
audio_bytes = bytes([0, 1, 2, 255, 254, 16, 127])
audio_b64 = base64.b64encode(audio_bytes).decode()
speech_bytes = bytes([255, 216, 255, 0, 17, 34, 254])
want_audio = base64.b64encode(speech_bytes).decode()

state = {"saw_multipart": False, "file_bytes": b""}


def extract_file_bytes(body, content_type):
    boundary = content_type.split("boundary=", 1)[1].encode()
    delimiter = b"--" + boundary
    for segment in body.split(delimiter):
        if b'name="file"' in segment:
            sep = segment.find(b"\r\n\r\n")
            if sep >= 0:
                content = segment[sep + 4 :]
                if content.endswith(b"\r\n"):
                    content = content[:-2]
                return content
    return b""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if "transcriptions" in self.path:
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data; boundary="):
                raise RuntimeError(f"transcribe request was not multipart: {content_type}")
            state["saw_multipart"] = True
            state["file_bytes"] = extract_file_bytes(body, content_type)
            payload = json.dumps(
                {"text": "hello world", "language": "en", "duration": 1.25}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif "speech" in self.path:
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(speech_bytes)))
            self.end_headers()
            self.wfile.write(speech_bytes)
        else:
            self.send_response(404)
            self.end_headers()


server = HTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

try:
    client = OpenAIResponsesClient(api_key="test-key", base_url=f"http://127.0.0.1:{port}")
    transcript = client.transcribe(
        {"audio": audio_b64, "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"}
    )
    assert state["saw_multipart"], "loopback server never received a multipart transcribe request"
    assert base64.b64encode(state["file_bytes"]).decode() == audio_b64, (
        f"multipart file bytes mismatch: {state['file_bytes']!r}"
    )
    assert transcript["text"] == "hello world", transcript

    speech = client.speak(
        {"text": "hello", "voice": "alloy", "format": "mp3", "model": "gpt-4o-mini-tts"}
    )
    assert speech["audio"] == want_audio, f"speak binary base64 mismatch: {speech}"
finally:
    server.shutdown()

print("audio-http-roundtrip-ok")
