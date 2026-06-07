import json

from axllm import AxGEPA, OptimizerEvaluator


class LocalEvaluator(OptimizerEvaluator):
    def evaluate(self, candidate_map, options=None):
        rows = []
        examples = ((options or {}).get("dataset") or {}).get("train") or []
        instruction = candidate_map.get("qa::instruction", "")
        for example in examples:
            quality = 0.9 if "concise" in instruction.lower() else 0.65
            brevity = 0.8
            scalar = (quality + brevity) / 2
            rows.append(
                {
                    "input": example,
                    "prediction": {"answer": "Ax composes typed LLM programs."},
                    "scores": {"quality": quality, "brevity": brevity},
                    "scalar": scalar,
                }
            )
        total = sum(row["scalar"] for row in rows)
        return {"rows": rows, "avg": total / len(rows), "sum": total, "count": len(rows)}


request = {
    "programKind": "axgen",
    "components": [
        {
            "id": "qa::instruction",
            "owner": "qa",
            "kind": "instruction",
            "current": "Answer clearly and concisely.",
        }
    ],
    "dataset": {
        "train": [{"question": "What is Ax?"}, {"question": "Why use typed signatures?"}],
        "validation": [{"question": "Summarize Ax."}],
    },
    "options": {"numTrials": 0, "maxMetricCalls": 8, "seed": 7},
}

artifact = AxGEPA(seed=7).optimize(request, LocalEvaluator())
assert "qa::instruction" in artifact["componentMap"], artifact
print(json.dumps({"componentMap": artifact["componentMap"], "metadata": artifact["metadata"]}, indent=2, sort_keys=True))
