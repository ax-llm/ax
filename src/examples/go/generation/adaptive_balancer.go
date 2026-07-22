// ax-example:start
// title: Go Adaptive Provider Balancing
// group: generation
// description: Routes equivalent chat traffic using shared reliability, latency, and cost statistics.
// provider: openai-compatible
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// story: 45
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	if key == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-5.4-mini"
	}
	services := []ax.AxAIService{
		ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": model}),
		ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": model}),
	}

	store := ax.NewAxInMemoryBalancerStatsStore()
	routeKeys := []string{"openai-primary", "openai-backup"}
	events := []string{}
	strategy := &ax.AxBalancerAdaptiveStrategy{
		DeadlineMs: 6_000, BadOutcomeCost: 0.02,
		ExpectedTokens: map[string]ax.Value{"promptTokens": 1_200.0, "completionTokens": 300.0},
		Namespace:      "support-summary-v1", StatsStore: store,
		RouteKey: func(_ ax.AxAIService, index int) string { return routeKeys[index] },
		Slice: func(context map[string]ax.Value) string {
			if options, ok := context["options"].(map[string]ax.Value); ok && options["stream"] == true {
				return "streaming"
			}
			return "interactive"
		},
		OnRoutingEvent: func(event ax.AxBalancerRoutingEvent) { events = append(events, fmt.Sprint(event["type"])) },
	}
	balancer, err := ax.NewAxBalancerWithOptions(services, ax.AxBalancerOptions{Strategy: strategy})
	if err != nil {
		panic(err)
	}
	response, err := balancer.Chat(context.Background(), map[string]ax.Value{"model": model, "chat_prompt": ax.Array(ax.Object("role", "user", "content", "Summarize why shared routing state matters."))}, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(response)
	fmt.Println(events)
}
