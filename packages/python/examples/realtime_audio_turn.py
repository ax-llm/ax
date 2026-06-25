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
print("realtime-audio-turn-ok")
