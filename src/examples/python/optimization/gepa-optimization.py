# ax-example:start
# title: Python GEPA Optimization
# group: optimization
# description: Scores real OpenAI predictions before and after GEPA instruction search.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
# ax-example:end
import json
import os

from axllm import AxGEPA, OptimizerEvaluator, ai, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-6-luna"),
)
program = ax('emailText:string -> priority:class "high, normal, low", rationale:string', {"id": "priority", "instruction": "Classify the email priority."})
baseline = program.forward(client, {"emailText": "Production checkout is failing for enterprise customers."})


class PriorityEvaluator(OptimizerEvaluator):
    def evaluate(self, candidate_map, options=None):
        result = program.evaluate_optimization(client, options["dataset"], candidate_map, options)
        for row in result["rows"]:
            expected = row["input"]["expectedOutput"]["priority"]
            actual = row["prediction"].get("output", {}).get("priority")
            score = float(actual == expected)
            row.update(scores={"accuracy": score}, scalar=score)
        result["avg"] = sum(row["scalar"] for row in result["rows"]) / result["count"]
        return result


def task(text, priority):
    return {"input": {"emailText": text}, "expectedOutput": {"priority": priority}}


request = {
    "programKind": "axgen",
    "components": program.get_optimizable_components(),
    "dataset": {
        "train": [task("URGENT: checkout is down", "high"), task("Weekly product newsletter", "low")],
        "validation": [task("Production payments are failing", "high"), task("Optional community meetup invite", "low")],
    },
    "options": {"numTrials": 1, "minibatchSize": 2, "maxMetricCalls": 12, "bootstrap": False, "seed": 7},
}
artifact = AxGEPA(client, seed=7).optimize(request, PriorityEvaluator())
original = artifact["baselineScore"]
best = artifact["metadata"]["bestScore"]
print(json.dumps({"baselinePrediction": baseline, "baselineScore": original, "baselineScores": artifact["baselineScores"], "optimizedScore": best, "delta": best - original}, indent=2))
