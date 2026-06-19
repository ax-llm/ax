# ax-example:start
# title: Python Text To Speech
# group: audio
# description: Generates speech audio through OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 10
# story: 40
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
speech = client.speak({"text": "Ax turns LLM prompts into typed programs.", "voice": "alloy", "format": "mp3"})
print(json.dumps({"format": speech.get("format"), "transcript": speech.get("transcript"), "audioBytesBase64": len(speech.get("audio") or speech.get("data") or "")}, indent=2, sort_keys=True))
