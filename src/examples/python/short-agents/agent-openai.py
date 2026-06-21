# ax-example:start
# title: Python Grounded Support Agent
# group: short-agents
# description: Answers a support question grounded in a handbook that is kept out of the model prompt via contextFields.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 10
# story: 20
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
    model_config={"temperature": 0},
)

# The handbook can be arbitrarily large. Listing it in `contextFields` keeps it
# in the agent's runtime so it never inflates the model prompt -- the agent reads
# it through code, not through tokens. That is the whole point of an Ax agent
# over a plain gen() call: the source material stays out of the context window.
handbook = """
# Acme Cloud -- Support Handbook

## Billing
- Invoices are issued on the 1st of each month and are due net-15.
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Access
- Seats can be added by any workspace Owner under Settings -> Members.
- SSO (SAML) is available on Enterprise; SCIM provisioning is Owner-only.

## Incidents
- Status and uptime are published at status.acme.example.
- Sev-1 incidents page the on-call within 5 minutes; updates post every 30 minutes.

## Data
- Exports are available in CSV and JSON from Settings -> Data.
- Deleted workspaces are recoverable for 30 days, then permanently purged.
""".strip()

assistant = agent(
    'question:string, handbook:string -> answer:string, citations:string[] "Handbook sections the answer relies on"',
    # Keep the handbook in the runtime, out of the prompt.
    {"contextFields": ["handbook"], "runtime": {"language": "JavaScript"}},
)

result = assistant.forward(
    client,
    {
        "question": "A customer downgraded their plan today. When does it take effect, and can they get a refund for the current cycle?",
        "handbook": handbook,
    },
    {"runtime": AxQuickJsCodeRuntime(), "max_actor_steps": 12},
)

print(json.dumps(result, indent=2, sort_keys=True))
