# ax-example:start
# title: Python AxGen Optimization
# group: optimization
# description: Runs a baseline OpenAI prediction and applies an optimizer artifact.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 10
# story: 50
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, OptimizerEngine


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
program = ax('emailText:string -> priority:class "high, normal, low", rationale:string', {"id": "priority", "instruction": "Classify the email priority."})
baseline = program.forward(client, {"emailText": "Production checkout is failing for enterprise customers."})


class ExampleOptimizer(OptimizerEngine):
    name = "example"
    version = "1"

    def optimize(self, request, evaluator=None):
        return {"componentMap": {"priority::instruction": "Classify operational risk. Use high for production-impacting urgency."}, "metadata": {"source": "axgen"}}


artifact = program.optimize_with(ExampleOptimizer(), [{"emailText": "URGENT: checkout is down", "priority": "high"}], {"apply": False})
program.apply_optimization(json.dumps(artifact))
after = program.forward(client, {"emailText": "Production checkout is failing for enterprise customers."})
print(json.dumps({"baseline": baseline, "after": after}, indent=2, sort_keys=True))
