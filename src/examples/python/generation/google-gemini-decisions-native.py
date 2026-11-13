# ax-example:start
# title: Python Native Google Gemini Decisions
# group: generation
# description: Evaluate named yes/no, choice and score questions with native probabilities and confidence.
# provider: google-gemini-decisions
# env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
# level: intermediate
# order: 48
# ax-example:end
import json
import os
from axllm import google_gemini_decisions

api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or os.environ["GOOGLE_APIKEY"]
client = google_gemini_decisions(api_key=api_key)
result = client.create({'input': 'Checkout is unavailable for all customers after the latest deployment.', 'questions': {'urgent': {'type': 'noul', 'instructions': 'Are customers unable to complete a core task?'}, 'team': {'type': 'choice', 'instructions': 'Which team should investigate?', 'criteria': {'support': 'Usage guidance', 'billing': 'Individual invoice disputes', 'engineering': 'Broken functionality or service outages'}}, 'severity': {'type': 'score', 'instructions': 'How severe is the customer impact?', 'criteria': ['Minor inconvenience', 'Feature impaired', 'Core task blocked']}}})
print(json.dumps(result, indent=2))
