# ax-example:start
# title: Python Structured Extraction
# group: generation
# description: Extracts structured fields and labels from support text with OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)
program = ax('ticket:string -> priority:class "high, normal, low", summary:string, labels:string[]')
out = program.forward(client, {"ticket": "Checkout has failed for enterprise customers since 09:00. Support wants a concise summary and tags."})
print(json.dumps(out, indent=2, sort_keys=True))
