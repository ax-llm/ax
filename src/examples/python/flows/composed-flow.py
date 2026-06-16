# ax-example:start
# title: Python Composed Flow
# group: flows
# description: Composes multiple typed programs into one OpenAI-backed flow.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 30
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, flow


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
step = ax('topic:string -> outline:string[]')
program = (
    flow({"id": "examples.composedFlow"})
    .execute("step", step)
    .map("note", lambda state: {"note": "Mapped flow state after the provider-backed step."})
    .returns({"outline": "step", "brief": "note"})
)
output = program.forward(client, {"topic": "How Ax moves from typed generation to agents, flows, and optimization"})
print(json.dumps(output, indent=2, sort_keys=True))
