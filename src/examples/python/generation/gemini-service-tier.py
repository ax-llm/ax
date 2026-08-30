# ax-example:start
# title: Python Gemini Flex Inference
# group: generation
# description: Sends latency-tolerant work through Gemini Flex and reports the applied tier.
# provider: google-gemini
# env: GOOGLE_API_KEY, GOOGLE_APIKEY
# level: intermediate
# order: 50
# ax-example:end
import json
import os

from axllm import GoogleGeminiClient


api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_APIKEY")
if not api_key:
    raise SystemExit("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.")

client = GoogleGeminiClient(
    api_key=api_key,
    model=os.getenv("AX_GEMINI_MODEL", "gemini-3.7-flash"),
)
out = client.chat(
    {
        "chat_prompt": [
            {
                "role": "user",
                "content": "Explain in one sentence why batch evaluations save time.",
            }
        ]
    },
    {"service_tier": "flex"},
)
print(json.dumps(out, indent=2, sort_keys=True))
