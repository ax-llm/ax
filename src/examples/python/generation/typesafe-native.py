# ax-example:start
# title: Python Jev Native Questions
# group: generation
# description: Uses structured criteria, native scoring, model discovery, and probability-based decisions.
# provider: typesafe
# env: TYPESAFE_APIKEY
# level: advanced
# order: 36
# ax-example:end
import json
import os
from axllm import typesafe

client = typesafe(api_key=os.environ["TYPESAFE_APIKEY"])
models = client.list_models()
assert models and all(model["name"] for model in models)
response = client.system_one(
    {
        "state": {
            "ticket": "Checkout is unavailable for all customers after the latest deployment.",
            "account": {
                "tier": "enterprise",
                "notes": None
            }
        },
        "questions": {
            "urgent": {
                "type": "noul",
                "instructions": {
                    "question": "Does this need immediate attention?"
                },
                "criteria": {
                    "true": "Customers cannot complete a core task",
                    "false": "Routine request"
                }
            },
            "team": {
                "type": "choice",
                "instructions": "Who should handle the ticket?",
                "criteria": {
                    "support": "Usage guidance",
                    "billing": {
                        "scope": "Invoices and payments"
                    },
                    "engineering": "Product failures"
                }
            },
            "severity": {
                "type": "score",
                "instructions": "Rate customer impact",
                "criteria": [
                    "Minor inconvenience",
                    "One task blocked",
                    "Core task unavailable",
                    "Widespread outage"
                ]
            }
        }
    }
)
answers = response["answers"]
urgent, severity, team = answers["urgent"], answers["severity"], answers["team"]
assert urgent["type"] == "noul"
assert severity["type"] == "score"
assert team["type"] == "choice"
assert 0 <= urgent["noul"] <= 1
assert 0 <= severity["score"] <= 3
assert team["choice"] in ("support", "billing", "engineering")
# Probability policies and score scales are application decisions.
print(json.dumps({"page_on_call": urgent["noul"] >= 0.9, "severity_1_to_5": 1 + 4 * severity["score"] / 3, "response": response}, indent=2))
