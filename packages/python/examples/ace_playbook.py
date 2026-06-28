import json

from axllm import ax, playbook


# A scripted client stands in for a real provider so this example runs without
# a key. Swap it for ai("openai", api_key=...) to grow a playbook against a live
# model. The canned JSON satisfies the bound program AND the playbook's internal
# reflector/curator sub-programs, so the full ACE loop is exercised offline.
class ScriptedClient:
    def complete(self, request):
        return {
            "content": json.dumps(
                {
                    "answer": "Ax composes typed LLM programs.",
                    "reasoning": "The playbook lacked a brevity rule.",
                    "errorIdentification": "Answer was too verbose.",
                    "rootCauseAnalysis": "No guidance on conciseness.",
                    "correctApproach": "Add a concise-answer guideline.",
                    "keyInsight": "Prefer one-sentence answers.",
                    "bulletTags": [],
                    "operations": [
                        {"type": "ADD", "section": "Guidelines", "content": "Answer in one concise sentence."}
                    ],
                }
            )
        }


client = ScriptedClient()
program = ax("question:string -> answer:string", {"id": "qa", "instruction": "Answer the question."})

pb = playbook(program, {"studentAI": client, "maxEpochs": 1})


def metric(args):
    prediction = args.get("prediction") or {}
    answer = str(prediction.get("answer") or "")
    return 1.0 if answer else 0.0


examples = [{"question": "What is Ax?"}, {"question": "Why typed signatures?"}]
result = pb.evolve(examples, metric)
rendered = pb.render()
state = pb.to_json()
assert "bestScore" in result, result
assert "playbook" in state and "artifact" in state, state
print(json.dumps({"bestScore": result["bestScore"], "rendered": rendered}, indent=2, sort_keys=True))
print("python-ace-playbook-ok")
