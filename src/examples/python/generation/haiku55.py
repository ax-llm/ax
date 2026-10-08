# ax-example:start
# title: Python Haiku 5.5 Adaptive Thinking
# group: generation
# description: Uses Haiku 5.5 adaptive thinking at low effort for a short response.
# provider: anthropic
# env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
# level: intermediate
# order: 47
# ax-example:end
import os
from axllm import ai

api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_APIKEY")
if not api_key:
    raise SystemExit("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example.")
client = ai("anthropic", api_key=api_key, model="claude-haiku-5-5")
response = client.chat({
    "chat_prompt": [{"role": "user", "content": "Reply with exactly: Haiku 5.5 works"}],
    "model_config": {"thinkingTokenBudget": "low", "showThoughts": False, "maxTokens": 2048},
})
print(response["results"][0]["content"])
