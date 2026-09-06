"""Drive a realtime audio TURN through the productized realtime_chat() driver
using ScriptedRealtimeTransport: the deterministic, credential-free path that
exercises the full send-setup -> send-input -> fold-events -> merge loop without
a live socket (the live socket path is verified separately against the real API).
Exits non-zero on any mismatch so `axir verify` fails if the driver regresses."""

import json

from axllm import OpenAIResponsesClient
from axllm.ai import ScriptedRealtimeTransport

client = OpenAIResponsesClient(model="gpt-realtime-2", api_key="test-key")
request = {
    "model": "gpt-realtime-2",
    "chat_prompt": [
        {"role": "system", "content": "You are a concise voice agent."},
        {"role": "user", "content": "Say hello."},
    ],
    "audio": {"output": {"voice": "alloy"}},
}

# Canned server frames: session handshake, two transcript deltas, an audio delta,
# then the terminal response.done.
inbound = [
    {"type": "session.created"},
    {"type": "session.updated"},
    {"type": "response.output_audio_transcript.delta", "response_id": "rt", "delta": "hel"},
    {"type": "response.output_audio_transcript.delta", "response_id": "rt", "delta": "lo"},
    {"type": "response.output_audio.delta", "response_id": "rt", "delta": "AQI="},
    {
        "type": "response.done",
        "response": {"id": "rt", "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}},
    },
]

transport = ScriptedRealtimeTransport(inbound)
final = client.realtime_chat(request, transport=transport)
result = final["results"][0]

sent_types = [event.get("type") for event in transport.sent]
print("driver sent:", json.dumps(sent_types))
print("merged result:", json.dumps(result, sort_keys=True))

# The driver must send the Core-built session.update first, then the input events.
assert sent_types == ["session.update", "conversation.item.create", "response.create"], sent_types
# Transcript deltas concatenated, audio chunk surfaced, turn finished.
assert result["content"] == "hello", result
assert result["finish_reason"] == "stop", result
assert result.get("audio", {}).get("data") == "AQI=", result
from axllm import ai
meta = ai("meta", model="muse-voice-transcribe-1.0", api_key="test-key")
assert meta.realtime_audio_setup({"model": "muse-voice-transcribe-1.0"})["authorization"]["accessToken"] == "Bearer test-key"
custom_meta = ai("meta", model="muse-voice-transcribe-1.0", api_key="test-key", base_url="https://proxy.example/v1")
assert custom_meta._realtime_ws_target("muse-voice-transcribe-1.0")[0] == "wss://proxy.example/v1/asr/realtime"
meta_request = {
    "model": "muse-voice-transcribe-1.0",
    "chat_prompt": [{"role": "user", "content": [{"type": "audio", "data": "AAE=", "format": "pcm16"}]}],
    "audio": {"input": {"sampleRate": 16000, "channels": 1}},
    "model_config": {"realtimeTranscription": {"partialMode": "delta"}},
}
meta_transport = ScriptedRealtimeTransport([
    {"sessionId": "meta-session"},
    {"type": "speechStart", "turnId": "one"},
    {"type": "transcript", "transcript": "Hello"},
    {"type": "transcript", "transcript": " world"},
    {"type": "speaker", "speaker": "A"},
    {"type": "speechStart", "turnId": "two"},
    {"type": "transcript", "transcript": "Second"},
    {"type": "speechComplete", "turnId": "one", "transcript": "Hello world!"},
    {"type": "speechComplete", "turnId": "two", "transcript": "Second turn"},
])
meta_final = meta.realtime_chat(meta_request, transport=meta_transport)
assert meta_final["remote_session_id"] == "meta-session", meta_final
assert [r["content"] for r in meta_final["results"]] == ["Hello world!", "Second turn"], meta_final
assert meta_transport.sent[0]["authorization"]["accessToken"] == "Bearer test-key", meta_transport.sent
assert [e.get("type") for e in meta_transport.sent] == [None, "binary", "endStream"], meta_transport.sent
import base64
import queue
import importlib
wire = importlib.import_module('axllm.ai')

class DuplexProbe:
    instance = None
    def __init__(self, *args):
        DuplexProbe.instance = self
        self.inbound = queue.Queue()
        self.sent = []
        self.closed = False
    def send(self, event):
        self.sent.append(event)
        if 'authorization' in event:
            self.inbound.put({'sessionId': 'duplex'})
        elif event.get('type') == 'binary' and len(self.sent) == 2:
            self.inbound.put({'type': 'transcript', 'transcript': 'wrong hypothesis'})
        elif event.get('type') == 'endStream':
            self.inbound.put({'type': 'transcript', 'transcript': 'Correct final.', 'final': True})
            self.inbound.put(None)
    def recv(self):
        return self.inbound.get(timeout=3)
    def close(self):
        self.closed = True
        self.inbound.put(None)

original_socket = wire._WebSocketRealtimeTransport
wire._WebSocketRealtimeTransport = DuplexProbe
try:
    duplex_request = {**meta_request, 'model_config': {}, 'chat_prompt': [{'role': 'user', 'content': [{'type': 'audio', 'data': base64.b64encode(bytes(9600)).decode(), 'format': 'pcm16'}]}]}
    stream = meta.stream(duplex_request)
    partial = next(stream)
    assert partial['results'][0]['transcript']['text'] == 'wrong hypothesis', partial
    assert not any(x.get('type') == 'endStream' for x in DuplexProbe.instance.sent)
    content = ''.join(r.get('content', '') for chunk in stream for r in chunk['results'])
    assert content == 'Correct final.', content
    assert DuplexProbe.instance.closed
    stream = meta.stream(duplex_request)
    next(stream)
    stream.close()
    assert DuplexProbe.instance.closed
    assert not any(x.get('type') == 'endStream' for x in DuplexProbe.instance.sent)
finally:
    wire._WebSocketRealtimeTransport = original_socket
from axllm import AxMemory
memory = AxMemory()
memory.update_result({"thought_blocks": [{"id": "r", "data": "Plan"}], "images": [{"id": "image", "data": "partial"}]})
memory.update_result({"thought_blocks": [{"id": "r", "data": "Plan.", "summary": "Plan.", "encrypted_content": "opaque"}]})
assert memory.get_last()["response"]["thought_blocks"] == [{"id": "r", "data": "Plan.", "summary": "Plan.", "encrypted_content": "opaque"}]
assert memory.get_last()["response"]["images"][0]["id"] == "image"
print("realtime-audio-turn-ok")
