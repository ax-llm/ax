# ax-example:start
# title: Python Concurrent Astra Flow
# group: flows
# description: Independent conversations overlap, retain their tool results, and receive scoped controls.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 13
# ax-example:end
import json
import os
import threading
from axllm import ai, ax, fn, flow, run_control

key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY.")
client = ai("openai", api_key=key, model="gpt-6-astra",
            model_config={"thinkingTokenBudget": "low", "max_tokens": 4096})
barrier = threading.Barrier(2, timeout=45)
control = run_control()
updates_ready = threading.Event()
started_paths, applied = set(), []

def lookup(_):
    # Both nodes must start their own tool before either can finish.
    barrier.wait()
    if not updates_ready.wait(5):
        raise RuntimeError("Controller did not observe both active nodes")
    return "REF-42"

def observe(event):
    if event["type"] == "tool.started":
        started_paths.add(event["path"])
        if len(started_paths) == 2:
            control.steer("Include VERIFIED with the exact reference in your final answer.")
            control.set_thinking_token_budget("medium", target="root/left")
            updates_ready.set()
    if event["type"] == "applied":
        applied.append({"path": event["path"], "timing": event["timing"]})

control.on_event(observe)
program = ax("question -> answer", {"functions": [
    fn("lookup").description("Look up the exact reference once.")
      .execution("background").handler(lookup).build()
]})
workflow = flow().execute("left", program).execute("right", program).returns({
    "left": "leftResult", "right": "rightResult"
})
result = workflow.forward(client, {
    "question": "Call lookup exactly once. If its result is pending, return a brief progress message without calling it again. Return the exact reference when its result arrives."
}, {"control": control, "serviceTier": "standard", "maxSteps": 6})
assert started_paths == {"root/left", "root/right"}, started_paths
assert all("REF-42" in result[node]["answer"] and "VERIFIED" in result[node]["answer"] for node in ("left", "right")), result
assert len(applied) == 3, applied
print(json.dumps({"result": result, "parallel_overlap": True, "applied_controls": applied}, indent=2))
