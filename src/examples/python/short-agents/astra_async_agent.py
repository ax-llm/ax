# ax-example:start
# title: Python Agent Background Tools
# group: short-agents
# description: Runs declared background agent tools with steering and verifies final result incorporation.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 12
# ax-example:end
import json
import os
import threading
import time
from axllm import ai, agent, fn, run_control
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY.")
client = ai("openai", api_key=key, model="gpt-6-astra",
            model_config={"thinkingTokenBudget": "low", "max_tokens": 4096})
pending, finished, overlap = threading.Event(), threading.Event(), threading.Event()
control = run_control()
applied = []

def slow_reference(_):
    pending.set()
    time.sleep(6)
    finished.set()
    return "REF-42"

def local_label(_):
    if pending.wait(3) and not finished.is_set():
        overlap.set()
    return "LAUNCH"

def on_event(event):
    if event["type"] == "tool.started" and not applied:
        applied.append("queued")
        control.steer("Include the word VERIFIED in the final answer.")
        control.set_thinking_token_budget("medium")
    if event["type"] == "applied":
        applied.append(event["timing"])

control.on_event(on_event)
program = agent("question -> answer", {"directResponse": "off", "runtime": {"language": "JavaScript"}, "functions": [
    fn("slow_reference").description("Look up a reference; takes a few seconds.")
        .execution("background").handler(slow_reference).build(),
    fn("local_label").description("Read an independent local label immediately.")
        .execution("background").handler(local_label).build(),
]})
result = program.forward(client, {"question": "Use the native tools tools_slow_reference and tools_local_label. First call tools_slow_reference. While it is pending, call tools_local_label. Call each tool only once; do not call a tool again while its result is pending. In the executor, call the native tools directly rather than invoking them from actor code; then use final(...) in the code runtime to pass their results to the responder. Return both exact results in one sentence."},
                         {"control": control, "runtime": AxQuickJsCodeRuntime(), "serviceTier": "standard", "maxSteps": 6, "max_actor_steps": 12})
assert overlap.is_set(), "The model did not perform independent work while the background tool was pending"
assert all(word in result["answer"] for word in ("REF-42", "LAUNCH", "VERIFIED")), result
assert "next-response" in applied, applied
print(json.dumps({"result": result, "background_overlap": True, "control_timing": applied[1:]}, indent=2))
