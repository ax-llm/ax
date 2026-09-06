# ax-example:start
# title: Python Astra Generation
# group: generation
# description: Runs Astra through the standard generator with automatic Responses routing and prompt caching.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 11
# ax-example:end
import json
import os

from axllm import ai, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-6-astra"),
    model_config={"thinkingTokenBudget": "low", "max_tokens": 2048},
)
program = ax('question:string -> answer:string')
out = program.forward(
    client,
    {"question": "In one sentence, explain Ax as a language-agnostic LLM programming library."},
    {"serviceTier": "standard", "promptCacheKey": "ax-openai-example", "contextCache": {}},
)
print(json.dumps(out, indent=2, sort_keys=True))
