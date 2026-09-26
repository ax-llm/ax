import json

from axllm import ax, playbook


# A scripted client stands in for a real provider so this example runs without
# a key. Swap it for ai("openai", api_key=...) to grow a playbook against a live
# model. Each program answers in its own output format, chosen by the output
# wire keys in its prompt: the bound program, then the playbook's reflector and
# curator, so the full ACE loop is exercised offline.
class ScriptedClient:
    @staticmethod
    def outputs(request, key):
        return "(wire key: " + chr(96) + key + chr(96) + ")" in json.dumps(request.get("chat_prompt"))

    def complete(self, request):
        if self.outputs(request, "errorIdentification"):
            content = "\n".join([
                "Reasoning: The playbook lacked a brevity rule.",
                "Error Identification: Answer was too verbose.",
                "Root Cause Analysis: No guidance on conciseness.",
                "Correct Approach: Add a concise-answer guideline.",
                "Key Insight: Prefer one-sentence answers.",
                "Bullet Tags: []",
            ])
        elif self.outputs(request, "operations"):
            content = "\n".join([
                "Reasoning: The playbook lacked a brevity rule.",
                'Operations: [{"type": "ADD", "section": "Guidelines", "content": "Answer in one concise sentence."}]',
            ])
        else:
            content = "Answer: Ax composes typed LLM programs."
        return {"content": content}


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
