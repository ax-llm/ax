# ax-example:start
# title: Python Adaptive Provider Balancing
# group: generation
# description: Routes equivalent chat traffic using shared reliability, latency, and cost statistics.
# provider: openai-compatible
# env: OPENAI_API_KEY, OPENAI_APIKEY
# level: advanced
# order: 45
# story: 45
# ax-example:end
import os

from axllm import (
    AxBalancer,
    AxBalancerAdaptiveStrategy,
    AxBalancerOptions,
    AxInMemoryBalancerStatsStore,
    OpenAICompatibleClient,
)


api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
if not api_key:
    raise SystemExit("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")

model = os.getenv("AX_OPENAI_MODEL", "gpt-5.4-mini")
services = [
    OpenAICompatibleClient(
        api_key=api_key,
        model=model,
        base_url=os.getenv("OPENAI_PRIMARY_BASE_URL", "https://api.openai.com/v1"),
    ),
    OpenAICompatibleClient(
        api_key=os.getenv("OPENAI_BACKUP_API_KEY", api_key),
        model=model,
        base_url=os.getenv("OPENAI_BACKUP_BASE_URL", "https://api.openai.com/v1"),
    ),
]

# Reuse this store across balancers in one process. A Redis/database adapter can
# implement the same atomic get/observe contract for multi-process state.
stats_store = AxInMemoryBalancerStatsStore()
route_keys = ["openai-primary", "openai-backup"]
events = []
strategy = AxBalancerAdaptiveStrategy(
    deadline_ms=6_000,
    bad_outcome_cost=0.02,
    expected_tokens={"promptTokens": 1_200, "completionTokens": 300},
    namespace="support-summary-v1",
    route_key=lambda _service, index: route_keys[index],
    slice=lambda context: "streaming" if context["options"].get("stream") else "interactive",
    stats_store=stats_store,
    on_routing_event=lambda event: events.append(event),
)
balancer = AxBalancer(services, AxBalancerOptions(strategy=strategy))
response = balancer.chat(
    {"model": model, "chat_prompt": [{"role": "user", "content": "Summarize why shared routing state matters."}]}
)
print(response["results"][0]["content"])
print([event["type"] for event in events])
