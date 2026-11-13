# ax-example:start
# title: Python Gemini 4 Hydrogen
# group: generation
# description: Uses Hydrogen with a thinking level and an explicit output limit.
# provider: google-gemini
# env: GOOGLE_API_KEY, GOOGLE_APIKEY
# level: beginner
# order: 51
# ax-example:end
import os

from axllm import ai

api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_APIKEY")
if not api_key:
    raise SystemExit("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.")

client = ai("google-gemini", api_key=api_key, model="gemini-4-hydrogen")
result = client.chat(
    {
        "chat_prompt": [{"role": "user", "content": "Why does a hash table usually provide fast lookups?"}],
        "model_config": {"max_tokens": 4096},
    },
    # Use "highest" for Hydrogen's xhigh level; "low" keeps this example quick.
    {"thinking_token_budget": "low"},
)
print(result["results"][0]["content"])
