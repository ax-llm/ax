# ax-example:start
# title: Python Audio Summary Pipeline
# group: audio
# description: Transcribes audio and summarizes the transcript with an OpenAI-backed generator.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 30
# ax-example:end
import base64
import json
import os
from pathlib import Path

from axllm import OpenAICompatibleClient, OpenAIResponsesClient, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

text_client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
audio_client = OpenAIResponsesClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_AUDIO_MODEL", "gpt-4o-mini-tts"),
    model_config={"temperature": 0},
)
audio = Path("src/examples/assets/presentation.wav").read_bytes()
transcript = audio_client.transcribe({"audio": base64.b64encode(audio).decode(), "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"})
summarize = ax("transcript:string -> summary:string, followUps:string[]")
result = summarize.forward(text_client, {"transcript": transcript["text"]})
print(json.dumps({"transcript": transcript["text"], "result": result}, indent=2, sort_keys=True))
