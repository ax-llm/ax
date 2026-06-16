# ax-example:start
# title: Python Branching Flow
# group: flows
# description: Routes a classification through follow-up flow logic backed by OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
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
step = ax('request:string -> route:class "support, sales, engineering"')
program = (
    flow({"id": "examples.branchFlow"})
    .execute("step", step)
    .map("note", lambda state: {"note": "Mapped flow state after the provider-backed step."})
    .returns({"route": "step", "response": "note"})
)
output = program.forward(client, {"request": "A customer says checkout is down for their enterprise account."})
print(json.dumps(output, indent=2, sort_keys=True))
