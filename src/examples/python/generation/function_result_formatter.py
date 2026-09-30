# ax-example:start
# title: Python Tool Result Formatting
# group: generation
# description: Formats a structured inventory tool result as concise text for the model.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 48
# ax-example:end
import os
from axllm import ai, ax, fn

key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY.")
client = ai("openai", api_key=key, model=os.getenv("AX_OPENAI_MODEL", "gpt-6-luna"))
inventory = fn("inventory").description("Read the current stock count.").handler(
    lambda _: {"available": 12, "warehouse": "A"}
).build()
program = ax("question:string -> answer:string", {"functions": [inventory]})
# The model receives this text; tool traces retain the original object.
program.set_function_result_formatter(lambda result: f"{result['available']} units available")
result = program.forward(client, {"question": "Call inventory and report how many units are available."})
print(result["answer"])
