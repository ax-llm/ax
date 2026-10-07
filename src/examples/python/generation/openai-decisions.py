# ax-example:start
# title: Python OpenAI Signature Decisions
# group: generation
# description: Converts OpenAI probabilities into boolean and class outputs with a provider threshold.
# provider: openai-decisions
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 44
# ax-example:end
import json
import os
from axllm import ai, ax

model = ai("openai-decisions", api_key=(os.getenv("OPENAI_API_KEY") or os.environ["OPENAI_APIKEY"]), trueThreshold=0.9)
triage = ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"")
decision = triage.forward(model, {"ticket": "Checkout is unavailable for all customers after the latest deployment."})
assert isinstance(decision["urgent"], bool)
assert decision["team"] in ("support", "billing", "engineering")
print(json.dumps(decision, indent=2))
