import json
import os

from axllm import ai, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY to run this provider API example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.6-luna"),
)
program = ax("question:string -> answer:string")
out = program.forward(
    client,
    {
        "question": "In one sentence, explain Ax as a language-agnostic LLM programming library."
    },
    {"promptCacheKey": "ax-openai-example", "contextCache": {}},
)
print(json.dumps(out, indent=2, sort_keys=True))
