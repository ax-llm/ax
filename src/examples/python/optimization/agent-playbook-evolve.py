# ax-example:start
# title: Python Agent Playbook — Learn And Verify
# group: optimization
# description: Attach a persistent playbook, add validated hidden citations and stage guidance, then mine a task set into playbook rules with a verification gate.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 42
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
)

seed = {
    "playbook": {
        "version": 1,
        "sections": {
            "failures_to_avoid": [
                {
                    "id": "failures-to-avoid-00001",
                    "section": "failures_to_avoid",
                    "content": "Check the available evidence before answering.",
                    "helpfulCount": 0,
                    "harmfulCount": 0,
                    "createdAt": "2026-07-15T00:00:00.000Z",
                    "updatedAt": "2026-07-15T00:00:00.000Z",
                }
            ]
        },
        "updatedAt": "2026-07-15T00:00:00.000Z",
    },
    "artifact": {"feedback": [], "history": []},
}

observed_citations = []
playbook_updates = []
assistant = agent(
    "question:string -> answer:string",
    {
        "ai": client,
        "contextFields": [],
        "runtime": {"language": "JavaScript"},
        "playbook": {"seed": seed, "onUpdate": playbook_updates.append},
        "citations": {
            "surface": "hidden",
            "onCitations": observed_citations.append,
        },
    },
)
assistant.set_instruction("Answer from evidence and state uncertainty plainly.")
assistant.add_actor_instruction("Before finishing, verify the answer against the collected evidence.")

runtime = AxQuickJsCodeRuntime()
answer = assistant.forward(
    client,
    {"question": "What should a support agent verify before answering?"},
    {"runtime": runtime, "max_actor_steps": 8},
)

# A score below scoreThreshold becomes a deterministic failure cluster. The
# default verification gate re-runs the task and rolls back a proposal that
# does not improve the held-in score. Add validation for production workloads.
evolution = assistant.playbook().evolve(
    {
        "train": [
            {
                "input": {"question": "Give a concise evidence-first answer."},
                "score": 0,
            }
        ]
    },
    {"verify": True, "maxProposals": 1, "runtime": runtime},
)

print(json.dumps(answer, indent=2, sort_keys=True))
print("citations:", observed_citations[-1] if observed_citations else [])
print("run-end updates:", len(playbook_updates))
print("outcomes:", evolution["outcomes"])
print(assistant.get_playbook().render())
