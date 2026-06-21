# ax-example:start
# title: Python Sequential Flow
# group: flows
# description: Runs a two-step Ax flow against OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 10
# story: 30
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, flow


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
step = ax('documentText:string -> summaryText:string')
program = (
    flow({"id": "examples.sequentialFlow"})
    .execute("step", step)
    .map("note", lambda state: {"note": "Mapped flow state after the provider-backed step."})
    .returns({"summary": "step", "note": "note"})
)
output = program.forward(client, {"documentText": "Ax gives developers signatures, provider clients, agents, flows, tracing, and optimization."})
print(json.dumps(output, indent=2, sort_keys=True))
