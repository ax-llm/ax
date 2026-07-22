from axllm import (
    AxBalancerAdaptiveStrategy,
    AxInMemoryBalancerStatsStore,
)

store = AxInMemoryBalancerStatsStore()
key = {
    "namespace": "checkout",
    "slice": "interactive",
    "logicalModel": "fast-chat",
    "routeKey": "openai-us",
}
store.observe(key, {"outcome": "success", "latencyMs": 180})

strategy = AxBalancerAdaptiveStrategy(
    deadline_ms=800,
    bad_outcome_cost=0.05,
    namespace="checkout",
    stats_store=store,
    route_key=lambda service, _index: service.get_id(),
)
print(strategy.namespace, store.get(key)["successes"])
