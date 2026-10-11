# ax-example:start
# title: Python Decision Evidence Reranking
# group: generation
# description: Ranks documents through Ax signatures while retaining decision evidence and candidate IDs.
# provider: openai-decisions
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 46
# ax-example:end
import json
import os
from axllm import ai, ax

model = ai("openai-decisions", api_key=os.getenv("OPENAI_API_KEY") or os.environ["OPENAI_APIKEY"])
judge = ax('query:string, document:string -> relevant:boolean(evidence, threshold 0.7), relevance:score "Irrelevant, Related, Partial answer, Direct answer"(evidence)')
query = "How do I request a refund?"
candidates = [{'id': 'refund', 'text': 'Request a refund within 30 days through your account billing page.'}, {'id': 'password', 'text': 'Reset your password using the sign-in page.'}]
ranked = [{"id": item["id"], **judge.forward(model, {"query": query, "document": item["text"]})} for item in candidates]
ranked.sort(key=lambda item: item["relevance"]["value"], reverse=True)
print(json.dumps(ranked, indent=2))
