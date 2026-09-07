# ax-example:start
# title: Python Controlled Background Flow
# group: flows
# description: Uses ordinary generation with background tools, steering, and a reasoning update.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 12
# ax-example:end
import json
import os
import threading
import time
from axllm import ai, ax, fn, flow, run_control

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
program = ax("question -> answer", {"functions": [
    fn("slow_reference").description("Look up a reference; takes a few seconds.")
        .execution("background").handler(slow_reference).build(),
    fn("local_label").description("Read an independent local label immediately.")
        .handler(local_label).build(),
]})
workflow = flow().execute("lookup", program, {"writes":["answer"]}).execute("verify", ax('answer -> report "Repeat the exact reference, label, and verification word from the answer."'), {"reads":["answer"]}).returns({"answer":"report"})
result = workflow.forward(client, {"question": "First call slow_reference. While it is pending, call local_label. Call each tool only once; do not call a tool again while its result is pending. If a required tool result is still pending, end this response with a brief progress message. The application will continue with the result when it arrives; do not spend reasoning tokens waiting for it. Once both results arrive, return them in one sentence."},
                         {"control": control, "serviceTier": "standard", "maxSteps": 6})
assert overlap.is_set(), "The model did not perform independent work while the background tool was pending"
assert all(word in result["answer"] for word in ("REF-42", "LAUNCH", "VERIFIED")), result
assert applied.count("next-response") == 4, applied
print(json.dumps({"result": result, "background_overlap": True, "control_timing": applied[1:]}, indent=2))
