import json

from axllm import AxCodeRuntime, AxCodeSession, RuntimeEnvelope, agent


# The actor returns model-authored Python code and a real runtime executes it.
# The same offline response also satisfies the playbook reflector and curator.
class ScriptedClient:
    def complete(self, request):
        return {
            "content": json.dumps(
                {
                    "pythonCode": "final('Answer', {'answer': 'Ax composes typed LLM programs.'})",
                    "answer": "Ax composes typed LLM programs.",
                    "reasoning": "The playbook lacked a brevity rule.",
                    "errorIdentification": "Answer was too verbose.",
                    "rootCauseAnalysis": "No guidance on conciseness.",
                    "correctApproach": "Add a concise-answer guideline.",
                    "keyInsight": "Prefer one-sentence answers.",
                    "weaknessDescription": "The agent does not verify its final step.",
                    "rootCause": "The final step is accepted without a check.",
                    "proposedGuidance": "Verify the final step before completing the task.",
                    "evidenceQuotes": ["final", "snapshot", "Answer"],
                    "configRecommendations": [],
                    "bulletTags": [],
                    "operations": [
                        {"type": "ADD", "section": "Guidelines", "content": "Answer in one concise sentence."}
                    ],
                }
            )
        }


class RuntimeSession(AxCodeSession):
    def execute(self, code, options=None):
        assert "pythonCode" not in code, code
        return RuntimeEnvelope.final({"answer": "Ax composes typed LLM programs."})

    def snapshot_globals(self, options=None):
        return {"version": 1, "bindings": {}, "globals": {}, "closed": False}

    def patch_globals(self, snapshot, options=None):
        return snapshot


class Runtime(AxCodeRuntime):
    language = "Python"

    def create_session(self, globals, options=None):
        return RuntimeSession()


client = ScriptedClient()
runtime = Runtime()
# agent.playbook() binds an evolving context playbook to an agent stage. The
# "responder" target grows the user-facing answer stage; ACE remains an
# implementation detail behind playbook(), just as optimize() hides GEPA.
ag = agent(
    "question:string -> answer:string",
    {"name": "qa", "description": "Answer the question.", "ai": client, "runtime": runtime},
)
pb = ag.playbook({"target": "responder", "studentAI": client, "maxEpochs": 1})
dataset = {"train": [{"input": {"question": "Answer briefly."}, "score": 0}]}

# A zero minimum gain exercises verified acceptance. A positive minimum gain
# rejects the same flat score and must restore the exact pre-proposal snapshot.
accepted = pb.evolve(
    dataset,
    {"verify": True, "minHeldInGain": 0, "maxProposals": 1, "maxMetricCalls": 2},
)
before_rejection = json.dumps(pb.to_json(), sort_keys=True)
rejected = pb.evolve(
    dataset,
    {"verify": True, "minHeldInGain": 0.1, "maxProposals": 1, "maxMetricCalls": 2},
)
after_rejection = json.dumps(pb.to_json(), sort_keys=True)

assert accepted.get("metricCallsUsed") == 2, accepted
assert accepted["outcomes"][0]["accepted"] is True, accepted
assert rejected.get("metricCallsUsed") == 2, rejected
assert rejected["outcomes"][0]["accepted"] is False, rejected
assert after_rejection == before_rejection, (before_rejection, after_rejection)
assert "playbook" in pb.to_json() and "artifact" in pb.to_json(), pb.to_json()
print(json.dumps({"accepted": accepted["outcomes"][0], "rejected": rejected["outcomes"][0]}, indent=2, sort_keys=True))
print("python-agent-playbook-ok")
