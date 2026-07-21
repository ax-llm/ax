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
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
classifier = ax('request:string -> route:class "support, sales, engineering"')
responder = ax("request:string, route:string -> response:string")
program = (
    flow({"id": "examples.branchFlow"})
    .execute(
        "classifier",
        classifier,
        {"reads": ["request"], "writes": ["classifierResult", "route"]},
    )
    .execute(
        "responder",
        responder,
        {
            "reads": ["request", "route"],
            "writes": ["responderResult", "response"],
        },
    )
    .returns({"route": "route", "response": "response"})
)
output = program.forward(
    client,
    {"request": "A customer says checkout is down for their enterprise account."},
)
print(json.dumps(output, indent=2, sort_keys=True))
