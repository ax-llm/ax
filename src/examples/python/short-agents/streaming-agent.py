# ax-example:start
# title: Python Streaming Agent
# group: short-agents
# description: Streams an agent's answer as field deltas while its evidence citations are checked against what the agent read from a handbook kept out of the prompt.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 15
# ax-example:end
import os

from axllm import agent, ai
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)

handbook = """
# Acme Cloud -- Support Handbook

## Billing
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Data
- Deleted workspaces are recoverable for 30 days, then permanently purged.
""".strip()

# The handbook stays in the agent's runtime, out of the prompt. With citations
# on, the answer cites the evidence it used, and ids the run never gathered are
# sent back to the model for a correction.
assistant = agent(
    "question:string, handbook:string -> answer:string",
    {
        "contextFields": ["handbook"],
        "runtime": {"language": "JavaScript"},
        "citations": {"onCitations": lambda ids: print(f"\ncited: {ids}")},
    },
)

# The distiller and the executor run first; then the responder's answer streams.
# Merge each delta and start over when the version changes (a retry).
merged, version = {}, 0
for delta in assistant.streaming_forward(
    client,
    {
        "question": "I downgraded today. When does it take effect, and is my data safe if I delete the workspace?",
        "handbook": handbook,
    },
    {"runtime": AxQuickJsCodeRuntime(), "max_actor_steps": 12},
):
    if delta["version"] != version:
        merged, version = {}, delta["version"]
        print("\n[retry: starting over]")
    for field, value in delta["delta"].items():
        merged[field] = merged.get(field, "") + value if isinstance(value, str) else value
        if field == "answer":
            print(value, end="", flush=True)
print()
