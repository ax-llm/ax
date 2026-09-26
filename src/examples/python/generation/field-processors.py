# ax-example:start
# title: Python Field Processor Feedback
# group: generation
# description: Sends a field processor's note back to the model for another step, as TypeScript does, and trims the final answer with a field transform.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 47
# ax-example:end
import os

from axllm import ai, ax


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
)
summarize = ax("text:string -> summary:string")


def keep_it_short(summary, context):
    # A non-empty result goes back to the model as a user message, and the
    # next step's answer replaces this one.
    words = len(summary.split())
    return f"That summary has {words} words; answer again in at most 12 words." if words > 12 else None


summarize.add_field_processor("summary", keep_it_short, feedback=True)
summarize.add_field_transform("summary", "trim")

text = (
    "The committee met on Tuesday to review the budget. After a long debate about "
    "the new library wing, they approved the plan and asked staff to find a builder "
    "who can start in spring, while keeping the reading room open during the work."
)
print(summarize.forward(client, {"text": text})["summary"])
