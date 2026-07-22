package main

import (
	"fmt"

	axllm "github.com/ax-llm/ax/packages/go"
)

func main() {
	store := axllm.NewAxInMemoryBalancerStatsStore()
	key := axllm.AxBalancerStatsKey{Namespace: "checkout", Slice: "interactive", LogicalModel: "fast-chat", RouteKey: "openai-us"}
	_ = store.Observe(key, axllm.AxBalancerStatsObservation{Outcome: "success", LatencyMs: 180})

	strategy := &axllm.AxBalancerAdaptiveStrategy{
		DeadlineMs:     800,
		BadOutcomeCost: 0.05,
		Namespace:      "checkout",
		StatsStore:     store,
		RouteKey: func(service axllm.AxAIService, _ int) string {
			return service.GetID()
		},
	}
	stats, _ := store.Get(key)
	fmt.Println(strategy.Namespace, stats.Successes)
}
