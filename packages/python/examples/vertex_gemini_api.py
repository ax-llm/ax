import json
import os

from axllm import GoogleGeminiClient


def required(name):
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Set {name} to run this Vertex provider API example.")
    return value


client = GoogleGeminiClient(
    api_key=required("GOOGLE_VERTEX_ACCESS_TOKEN"),
    project_id=required("GOOGLE_PROJECT_ID"),
    region=required("GOOGLE_REGION"),
    model=os.getenv("AX_VERTEX_MODEL", "gemini-3.5-flash"),
)
out = client.chat(
    {"chat_prompt": [{"role": "user", "content": "Reply with the word ready."}]}
)
print(json.dumps(out, indent=2, sort_keys=True))
