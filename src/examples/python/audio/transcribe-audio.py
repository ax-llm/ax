# ax-example:start
# title: Python Speech To Text
# group: audio
# description: Transcribes a checked-in WAV file through OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
# ax-example:end
import base64
import json
import os
from pathlib import Path

from axllm import OpenAIResponsesClient


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAIResponsesClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_AUDIO_MODEL", "gpt-4o-mini-tts"),
    model_config={"temperature": 0},
)
audio = Path("src/examples/assets/presentation.wav").read_bytes()
transcript = client.transcribe({"audio": base64.b64encode(audio).decode(), "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"})
print(json.dumps(transcript, indent=2, sort_keys=True))
