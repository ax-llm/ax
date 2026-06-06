import json

from axllm import OptimizerEngine, ax


class FakeOptimizer(OptimizerEngine):
    name = "fixture"
    version = "1"

    def optimize(self, request, evaluator=None):
        return {
            "componentMap": {"qa::instruction": "Prefer artifact-backed answers."},
            "metadata": {
                "evidence": {"avg": 1},
                "provenance": {"sourceProgramKind": "axgen"},
            },
        }


qa = ax("question:string -> answer:string", {"id": "qa", "instruction": "Base."})
artifact = qa.optimize_with(FakeOptimizer(), [], {"apply": False})
assert any(item["id"] == "qa::instruction" and item["current"] == "Base." for item in qa.get_optimizable_components())
qa.apply_optimization(json.dumps(artifact))
assert any(
    item["id"] == "qa::instruction" and item["current"] == "Prefer artifact-backed answers."
    for item in qa.get_optimizable_components()
)
print("python-optimizer-artifact-ok")
