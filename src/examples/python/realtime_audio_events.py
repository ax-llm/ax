import json

from axllm import GoogleGeminiClient, GrokClient


grok = GrokClient(model="grok-voice-think-fast-1.0", api_key="test-key")
grok_request = {
    "model": "grok-voice-think-fast-1.0",
    "chat_prompt": [
        {"role": "system", "content": "You are a concise voice agent."},
        {"role": "user", "content": "Say hello."},
    ],
    "audio": {"input": {"sampleRate": 24000}, "output": {"sampleRate": 24000, "voice": "eve"}},
}
grok_events = [
    {"type": "response.output_audio_transcript.delta", "response_id": "grok_rt", "delta": "hello "},
    {"type": "response.output_audio.delta", "response_id": "grok_rt", "delta": "AQI="},
    {
        "type": "response.done",
        "response": {
            "id": "grok_rt",
            "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
        },
    },
]

gemini = GoogleGeminiClient(
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    api_key="test-key",
)
gemini_request = {
    "model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "chat_prompt": [
        {"role": "system", "content": "Answer with audio."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Live question"},
                {"type": "audio", "data": "AAAA", "format": "pcm16", "sampleRate": 16000},
            ],
        },
    ],
    "audio": {"output": {"transcript": True, "voice": "Kore"}},
}
gemini_events = [
    {"id": "gemini_live_1", "serverContent": {"outputTranscription": {"text": "spoken "}}},
    {
        "id": "gemini_live_2",
        "serverContent": {
            "modelTurn": {
                "parts": [{"inlineData": {"data": "AQI=", "mimeType": "audio/pcm"}}]
            }
        },
    },
    {
        "id": "gemini_live_3",
        "toolCall": {"functionCalls": [{"name": "lookup", "args": {"q": "ax"}}]},
    },
    {
        "id": "gemini_live_done",
        "serverContent": {"turnComplete": True},
        "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 4, "totalTokenCount": 7},
    },
]

print("grok setup:")
print(json.dumps(grok.realtime_audio_setup(grok_request), indent=2, sort_keys=True))
print("grok normalized events:")
print(json.dumps(list(grok.realtime(grok_events)), indent=2, sort_keys=True))

print("gemini setup:")
print(json.dumps(gemini.realtime_audio_setup(gemini_request), indent=2, sort_keys=True))
print("gemini input messages:")
print(json.dumps(gemini.realtime_audio_input(gemini_request), indent=2, sort_keys=True))
print("gemini normalized events:")
print(json.dumps(list(gemini.realtime(gemini_events)), indent=2, sort_keys=True))
