# ax-example:start
# title: Python Jev Signature Decisions
# group: generation
# description: Converts Jev probabilities into boolean and class outputs with a provider threshold.
# provider: typesafe
# env: TYPESAFE_APIKEY
# level: beginner
# order: 35
# ax-example:end
import json
import os
from axllm import ai, ax, typesafe

model = ai("typesafe", api_key=os.environ["TYPESAFE_APIKEY"], trueThreshold=0.9)
triage = ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"")
decision = triage.forward(model, {"ticket": "Checkout is unavailable for all customers after the latest deployment."})
assert isinstance(decision["urgent"], bool)
assert decision["team"] in ("support", "billing", "engineering")
print(json.dumps(decision, indent=2))
