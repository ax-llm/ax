# ax-example:start
# title: Python Vertex Gemini Routing
# group: generation
# description: Calls Gemini through Vertex with project and multi-region routing.
# provider: google-gemini
# env: GOOGLE_VERTEX_ACCESS_TOKEN, GOOGLE_PROJECT_ID, GOOGLE_REGION
# level: intermediate
# order: 35
# ax-example:end
import json
import os

from axllm import GoogleGeminiClient


def required(name):
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Set {name} to run this example.")
    return value


client = GoogleGeminiClient(
    api_key=required("GOOGLE_VERTEX_ACCESS_TOKEN"),
    project_id=required("GOOGLE_PROJECT_ID"),
    region=required("GOOGLE_REGION"),
    model=os.getenv("AX_VERTEX_MODEL", "gemini-3.5-flash"),
)
out = client.chat({"chat_prompt": [{"role": "user", "content": "Reply with the word ready."}]})
print(json.dumps(out, indent=2, sort_keys=True))
