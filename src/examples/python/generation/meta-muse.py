# ax-example:start
# title: Python Meta Muse Spark
# group: generation
# description: Selects any of Meta's three protocols through the existing chat API.
# provider: meta
# env: MODEL_API_KEY
# level: beginner
# order: 52
# ax-example:end
import os

from axllm import ai

key = os.getenv("MODEL_API_KEY")
if not key:
    raise SystemExit("Set MODEL_API_KEY to run this example.")

for profile in ("meta", "meta-chat", "meta-messages"):
    client = ai(profile, api_key=key, model="muse-spark-1.3")
    response = client.chat({
        "chat_prompt": [{"role": "user", "content": "Name a solar-powered sailboat."}],
        "model_config": {"thinking_token_budget": "highest"},
    })
    print(profile, response["results"][0].get("content"))
