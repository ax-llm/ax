# ax-example:start
# title: Centralized Usage Observer
# group: generation
# description: Attributes every completed model call to a tenant, user, and request from one global observer.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: intermediate
# order: 45
# ax-example:end
import json
import os
import uuid

from axllm import OpenAICompatibleClient, set_usage_observer


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

events = []
set_usage_observer(events.append)
client = OpenAICompatibleClient(
    api_key=api_key,
    model=os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini"),
    usage_context={
        "tenantId": "tenant-42",
        "feature": "support-chat",
        "attributes": {"environment": "example"},
    },
)

try:
    client.chat(
        {"chat_prompt": [{"role": "user", "content": "Reply with one short greeting."}]},
        {"usageContext": {"userId": "user-7", "requestId": str(uuid.uuid4())}},
    )
    print(json.dumps(events, indent=2, sort_keys=True))
finally:
    set_usage_observer(None)
