# ax-example:start
# title: Python AxGen Multi-Sampling
# group: generation
# description: Generates three validated structured candidates and selects the highest-scoring result.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 20
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax


def pick_highest_score(samples):
    return max(range(len(samples)), key=lambda index: samples[index]["sample"]["score"])


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0.8},
)
program = ax(
    "topic:string -> answer:string, score:number",
    sample_count=3,
    result_picker=pick_highest_score,
)
out = program.forward(
    client,
    {"topic": "Explain why typed signatures make LLM programs easier to maintain."},
)
print(json.dumps(out, indent=2, sort_keys=True))
