import json

from axllm import OpenAIResponsesClient


transport_requests = []


def scripted_transport(request):
    transport_requests.append(request)
    if request["url"].endswith("/audio/speech"):
        return {"status": 200, "json": {"audio": "base64-speech"}}
    if request["url"].endswith("/audio/transcriptions"):
        return {
            "status": 200,
            "json": {"text": "hello world", "language": "en", "duration": 1.25},
        }
    raise RuntimeError(f"unexpected request: {request}")


client = OpenAIResponsesClient(api_key="test-key", transport=scripted_transport)
speech = client.speak({"text": "hello", "voice": "alloy", "format": "mp3"})
transcript = client.transcribe(
    {"audio": "base64-audio", "language": "en", "model": "whisper-1", "format": "json"}
)
assert speech["audio"] == "base64-speech", speech
assert transcript["text"] == "hello world", transcript

print("normalized output:")
print(json.dumps({"speak": speech, "transcribe": transcript}, indent=2, sort_keys=True))
print("transport requests:")
print(json.dumps(transport_requests, indent=2, sort_keys=True))
