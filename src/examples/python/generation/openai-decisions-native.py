# ax-example:start
# title: Python OpenAI Native Decisions
# group: generation
# description: Uses ordered predicate, choice, and score questions with explicit rubrics and raw probabilities.
# provider: openai-decisions
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 45
# ax-example:end
import json
import os
from axllm import openai_decisions

client = openai_decisions(api_key=(os.getenv("OPENAI_API_KEY") or os.environ["OPENAI_APIKEY"]))
response = client.create(json.loads('{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": [{"type": "predicate", "name": "urgent", "instructions": "Are customers unable to complete a core task?"}, {"type": "choice", "name": "team", "instructions": "Who should handle the ticket?", "choices": [{"value": "support", "description": "Usage guidance"}, {"value": "billing", "description": "Invoices and payments"}, {"value": "engineering", "description": "Product failures"}]}, {"type": "score", "name": "severity", "instructions": "Rate customer impact", "levels": [{"label": "Minor inconvenience"}, {"label": "One task blocked"}, {"label": "Core task unavailable"}, {"label": "Widespread outage"}]}]}'))
# Handle per-question refusals before using probability, choice, or score.
assert [answer["name"] for answer in response["answers"]] == ["urgent", "team", "severity"]
print(json.dumps(response, indent=2))
