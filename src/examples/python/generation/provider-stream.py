# ax-example:start
# title: Python Incremental Provider Stream
# group: generation
# description: Consumes OpenAI SSE incrementally and closes the upstream response when finished.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 45
# ax-example:end
import os
import time

from axllm import ai


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

client = ai(
    "openai",
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.6-luna"),
)
started = time.perf_counter()
stream = client.stream(
    {
        "chat_prompt": [{"role": "user", "content": "Reply with exactly: streaming works"}],
        "model_config": {"temperature": 1},
    }
)
try:
    for event in stream:
        results = event.get("results") or []
        content = (results[0].get("content") or "") if results else ""
        if content:
            print(f"[{(time.perf_counter() - started) * 1000:.0f} ms] {content}", end="", flush=True)
finally:
    stream.close()
print()
