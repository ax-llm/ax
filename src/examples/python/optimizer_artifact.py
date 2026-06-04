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


program = ax("question:string -> answer:string", {"id": "qa", "instruction": "Base."})
artifact = program.optimize_with(FakeOptimizer(), [], {"apply": False})
before = program.get_optimizable_components()
program.apply_optimization(json.dumps(artifact))
after = program.get_optimizable_components()

print(json.dumps({"artifact": artifact, "before": before, "after": after}, indent=2, sort_keys=True))
