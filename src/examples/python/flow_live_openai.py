import json
import os

from axllm import OpenAICompatibleClient, ax, flow


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this live example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_LIVE_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
outline = ax("topic:string -> outline:string")
program = (
    flow({"id": "examples.liveFlow"})
    .execute("outline", outline)
    .map("summary", lambda state: {"summary": "Generated outline with typed Ax program steps."})
    .returns({"outline": "outline", "summary": "summary"})
)
output = program.forward(client, {"topic": "how Ax composes typed LLM programs"})

print(json.dumps(output, indent=2, sort_keys=True))
