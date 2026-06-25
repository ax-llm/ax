# ax-example:start
# title: Python Contextual Generation
# group: generation
# description: Answers from supplied context and returns compact citations with OpenAI.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 30
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
program = ax('context:string, question:string -> answer:string, citations:string[]')
out = program.forward(client, {"context": "Ax uses signatures, ai(), ax(), agent(), flow(), and optimize() for production LLM programs.", "question": "How should a new developer think about Ax?"})
print(json.dumps(out, indent=2, sort_keys=True))
