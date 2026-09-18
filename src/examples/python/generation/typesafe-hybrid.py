# ax-example:start
# title: Python Jev Hybrid Reply
# group: generation
# description: Passes Jev decisions to a second Ax program to generate a customer reply.
# provider: typesafe, openai
# env: TYPESAFE_APIKEY, OPENAI_APIKEY, OPENAI_API_KEY
# level: intermediate
# order: 37
# ax-example:end
import json
import os
from axllm import ai, ax, typesafe

model = ai("typesafe", api_key=os.environ["TYPESAFE_APIKEY"], trueThreshold=0.9)
triage = ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"")
decision = triage.forward(model, {"ticket": "Checkout is unavailable for all customers after the latest deployment."})
assert isinstance(decision["urgent"], bool)
assert decision["team"] in ("support", "billing", "engineering")
writer = ai("openai", api_key=os.environ.get("OPENAI_API_KEY") or os.environ["OPENAI_APIKEY"], model="gpt-5.6-luna", model_config={"temperature": 1})
reply = ax("ticket:string, urgent:boolean, team:string -> reply:string").forward(writer, {"ticket": "Checkout is unavailable for all customers after the latest deployment.", **decision})
assert isinstance(reply["reply"], str) and reply["reply"].strip()
print(json.dumps({"decision": decision, **reply}, indent=2))
