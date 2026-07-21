# ax-example:start
# title: Python Parallel Flow
# group: flows
# description: Runs two independent OpenAI-backed steps in parallel before joining their results.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 40
# ax-example:end
import json
import os

from axllm import OpenAICompatibleClient, ax, flow


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    model_config={"temperature": 0},
)
research = ax("topicText:string -> factList:string[]")
audience = ax("topicText:string -> audienceAngle:string")
join = ax("factList:string[], audienceAngle:string -> briefText:string")
program = (
    flow({"id": "examples.parallelFlow"})
    .execute(
        "research",
        research,
        {"reads": ["topicText"], "writes": ["researchResult", "factList"]},
    )
    .execute(
        "audience",
        audience,
        {"reads": ["topicText"], "writes": ["audienceResult", "audienceAngle"]},
    )
    .execute(
        "join",
        join,
        {
            "reads": ["factList", "audienceAngle"],
            "writes": ["joinResult", "briefText"],
        },
    )
    .returns({"briefText": "briefText"})
)
output = program.forward(
    client,
    {"topicText": "Why typed contracts make multi-step LLM systems easier to maintain"},
)
print(json.dumps(output, indent=2, sort_keys=True))
