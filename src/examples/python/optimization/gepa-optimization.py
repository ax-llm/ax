# ax-example:start
# title: Python GEPA Optimization
# group: optimization
# description: Pairs a real OpenAI baseline with a local GEPA optimization pass.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, AxGEPA, OptimizerEvaluator


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


class LocalEvaluator(OptimizerEvaluator):
    def evaluate(self, candidate_map, options=None):
        return {"rows": [{"prediction": {"answer": "Ax composes typed LLM programs."}, "scores": {"quality": 0.9}, "scalar": 0.9}], "avg": 0.9, "count": 1}


request = {"programKind": "axgen", "components": [{"id": "priority::instruction", "owner": "priority", "kind": "instruction", "current": "Classify priority clearly."}], "dataset": {"train": [{"emailText": "URGENT: checkout is down"}]}, "options": {"numTrials": 0, "maxMetricCalls": 4, "seed": 7}}
artifact = AxGEPA(seed=7).optimize(request, LocalEvaluator())
print(json.dumps({"baseline": baseline, "artifact": artifact}, indent=2, sort_keys=True))
