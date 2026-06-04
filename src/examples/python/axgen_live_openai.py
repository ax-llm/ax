import json
import os

from axllm import OpenAICompatibleClient, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_LIVE_MODEL", "gpt-4.1-mini"),
    model_config={"temperature": 0},
)

program = ax("question:string -> answer:string")
output = program.forward(
    client,
    {
        "question": "In one sentence, explain Ax as a language-agnostic LLM programming library."
    },
)

print(json.dumps(output, indent=2, sort_keys=True))
