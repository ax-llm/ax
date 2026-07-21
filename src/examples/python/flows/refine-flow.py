# ax-example:start
# title: Python Refinement Flow
# group: flows
# description: Drafts, critiques, and revises an answer through three OpenAI-backed steps.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 50
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
draft = ax("topicText:string -> draftText:string")
critique = ax("draftText:string -> critiqueText:string")
revise = ax("draftText:string, critiqueText:string -> revisedText:string")
program = (
    flow({"id": "examples.refineFlow"})
    .execute(
        "draft",
        draft,
        {"reads": ["topicText"], "writes": ["draftResult", "draftText"]},
    )
    .execute(
        "critique",
        critique,
        {"reads": ["draftText"], "writes": ["critiqueResult", "critiqueText"]},
    )
    .execute(
        "revise",
        revise,
        {
            "reads": ["draftText", "critiqueText"],
            "writes": ["reviseResult", "revisedText"],
        },
    )
    .returns({"revisedText": "revisedText"})
)
output = program.forward(
    client,
    {"topicText": "Explain automatic flow parallelism to a backend engineer."},
)
print(json.dumps(output, indent=2, sort_keys=True))
