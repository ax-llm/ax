# ax-example:start
# title: Python Sonnet 5.5 Between-Tool Thinking
# group: generation
# description: Disables pre-response thinking while retaining signed updates for replay.
# provider: anthropic
# env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
# level: intermediate
# order: 46
# ax-example:end
import os
from axllm import ai

api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_APIKEY")
if not api_key:
    raise SystemExit("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example.")
client = ai("anthropic", api_key=api_key, model="claude-sonnet-5-5")
response = client.chat({
    "chat_prompt": [{"role": "user", "content": "Reply with exactly: Sonnet 5.5 works"}],
    "model_config": {"thinkingTokenBudget": "none", "effort": "high", "maxTokens": 128},
})
print(response["results"][0]["content"])
