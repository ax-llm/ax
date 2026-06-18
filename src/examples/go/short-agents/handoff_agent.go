// ax-example:start
// title: Go Specialist Planner Agent
// group: short-agents
// description: A specialist that plans a migration from a long brief held in contextFields, using a checkpointed contextPolicy and a runtime-output cap to stay compact.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/go"
	axgoja "github.com/ax-llm/ax/go/runtime/goja"
)

func openAIClient() *ax.OpenAICompatibleClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0)})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

// A long, messy brief -- exactly the kind of input you do not want replayed into
// the prompt on every turn. `contextFields` holds it in the runtime, the
// `checkpointed` policy compacts older turns once the prompt grows, and
// `maxRuntimeChars` caps how much runtime output is echoed back.
var brief = strings.TrimSpace(`
# Migration brief: monolith -> services (draft, unordered notes)

Current: single Rails monolith, Postgres primary + 1 replica, Sidekiq for jobs.
Pain: deploys take 40m, one bad migration locks the orders table, on-call burnout.
Constraints: no downtime windows > 5m, PCI scope must shrink, team of 6, 2 quarters.
Hot paths: checkout (writes orders, payments), search (read-heavy), notifications (async).
Known landmines: payments code has no tests; search shares the orders DB; a nightly
cron rebuilds the catalog and pins CPU for ~20m; the replica lags up to 90s under load.
Org wants: independent deploys for checkout, smaller blast radius, an audit trail.
Nice to have: event log for orders, read-model for search, feature flags.
Hard no: a big-bang rewrite; introducing Kubernetes this year.
`)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := openAIClient()

	specialist := ax.NewAgent(
		`brief:string, goal:string -> plan:string[] "Ordered, concrete steps", answer:string, risks:string[]`,
		map[string]ax.Value{
			"contextFields":   ax.Array("brief"),
			"contextPolicy":   ax.Object("preset", "checkpointed", "budget", "balanced"),
			"maxRuntimeChars": 3000,
			"runtime":         ax.Object("language", "JavaScript"),
		},
	)

	output, err := specialist.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"brief": brief,
			"goal":  "Propose a safe, incremental 2-quarter plan to split checkout out first, respecting the hard constraints.",
		},
		map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 12},
	)
	if err != nil {
		panic(err)
	}
	printJSON(output)
}
