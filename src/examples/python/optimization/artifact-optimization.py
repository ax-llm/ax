# ax-example:start
# title: Python Optimization Artifact Reuse
# group: optimization
# description: Saves and reapplies an optimizer artifact after a real OpenAI baseline.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 30
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, OptimizerEngine


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
program = ax('emailText:string -> priority:class "high, normal, low", rationale:string', {"id": "priority", "instruction": "Classify the email priority."})
baseline = program.forward(client, {"emailText": "Production checkout is failing for enterprise customers."})


class ExampleOptimizer(OptimizerEngine):
    name = "example"
    version = "1"

    def optimize(self, request, evaluator=None):
        return {"componentMap": {"priority::instruction": "Classify operational risk. Use high for production-impacting urgency."}, "metadata": {"source": "artifact"}}


artifact = program.optimize_with(ExampleOptimizer(), [{"emailText": "URGENT: checkout is down", "priority": "high"}], {"apply": False})
program.apply_optimization(json.dumps(artifact))
after = program.forward(client, {"emailText": "Production checkout is failing for enterprise customers."})
print(json.dumps({"baseline": baseline, "after": after}, indent=2, sort_keys=True))
