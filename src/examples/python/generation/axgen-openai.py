# ax-example:start
# title: Python Prompt-Cached Generation
# group: generation
# description: Runs GPT-6 structured generation with stable OpenAI prompt-cache affinity.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 10
# story: 10
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
    model=os.getenv("AX_OPENAI_MODEL", "gpt-6-luna"),
)
program = ax('question:string -> answer:string')
out = program.forward(
    client,
    {"question": "In one sentence, explain Ax as a language-agnostic LLM programming library."},
    {"timeout": 30000, "promptCacheKey": "ax-openai-example", "contextCache": {}},
)
print(json.dumps(out, indent=2, sort_keys=True))
