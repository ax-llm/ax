# ax-example:start
# title: Python Cancel Background Work
# group: generation
# description: Cancels a live Astra run through the high-level controller and observes cooperative tool cancellation.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 13
# ax-example:end
import json
import os
import threading
import time
from axllm import ai, ax, fn, run_control

key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY.")
control = run_control()
settled = threading.Event()
started = {}
def lookup(args, context):
    started.update(call_id=context["call_id"], at=time.monotonic())
    control.abort()
    if not context["signal"].wait(2):
        raise RuntimeError("Tool did not receive cancellation")
    settled.set()
    return "LATE: discard this result"
program = ax("question -> answer", {"functions": [
    fn("lookup").description("Look up the reference.").execution("background")
      .context_handler(lookup).build()
]})
client = ai("openai", api_key=key, model="gpt-6-astra",
            model_config={"thinkingTokenBudget":"low", "max_tokens":2048})
try:
    program.forward(client, {"question":"Call lookup once and return its result."},
                    {"control":control, "serviceTier":"standard"})
except RuntimeError as error:
    assert started and started["call_id"] in str(error), error
    elapsed = time.monotonic() - started["at"]
    assert elapsed < 2 and settled.wait(2), "Cancellation did not settle promptly"
    print(json.dumps({"cancelled":True, "unresolved_call_id":started["call_id"], "seconds":elapsed}))
else:
    raise AssertionError("Cancelled run returned a successful answer")
