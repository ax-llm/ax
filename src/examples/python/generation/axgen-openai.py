# ax-example:start
# title: Python Typed Generation
# group: generation
# description: Runs a small typed generation program against OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: beginner
# order: 10
# story: 10
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
program = ax('question:string -> answer:string')
out = program.forward(client, {"question": "In one sentence, explain Ax as a language-agnostic LLM programming library."})
print(json.dumps(out, indent=2, sort_keys=True))
