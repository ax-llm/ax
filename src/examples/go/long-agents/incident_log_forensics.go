// ax-example:start
// title: Go Incident Log Forensics (RLM)
// group: long-agents
// description: Infers service architecture and root-cause findings from a huge CloudWatch export that never enters the prompt -- held in contextFields and worked through the runtime under a lean contextPolicy.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 10
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func geminiClient() *ax.GoogleGeminiClient {
	apiKey := os.Getenv("GOOGLE_APIKEY")
	if apiKey == "" {
		panic("Set GOOGLE_APIKEY to run this example.")
	}
	model := os.Getenv("AX_GEMINI_MODEL")
	if model == "" {
		model = "gemini-3.5-flash"
	}
	return ax.NewGoogleGeminiClient(map[string]ax.Value{"api_key": apiKey, "model": model})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

// ---------------------------------------------------------------------------
// Synthetic CloudWatch-style export -- generated large on purpose. Dumping these
// raw events into a prompt would blow the context window. The agent keeps them
// in its runtime (contextFields) and only the *evidence it extracts* ever
// reaches the model. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
func buildLogDump() []ax.Value {
	start := time.Date(2026, 3, 2, 13, 0, 0, 0, time.UTC)
	events := []ax.Value{}

	push := func(i int, event map[string]ax.Value) {
		event["timestamp"] = start.Add(time.Duration(i*2) * time.Second).Format("2006-01-02T15:04:05Z")
		event["requestId"] = fmt.Sprintf("req-%d", 100000+i)
		events = append(events, ax.Value(event))
	}

	for i := 0; i < 1600; i++ {
		// Routine, healthy traffic across the fleet.
		push(i, ax.Object("level", "INFO", "service", "gateway", "statusCode", 200, "latencyMs", 40+(i%30), "message", "route ok GET /checkout"))
		push(i, ax.Object("level", "INFO", "service", "search-api", "statusCode", 200, "latencyMs", 70+(i%50), "message", "query ok q=shoes"))

		// Window A: payments-gw upstream timeouts spill into checkout-api 502s for
		// enterprise tenants, with retry storms + pool exhaustion.
		if i >= 300 && i < 520 {
			push(i, ax.Object("level", "ERROR", "service", "payments-gw", "statusCode", 504, "latencyMs", 10000, "tenantTier", "enterprise", "message", "upstream timeout calling acquirer (10s)"))
			push(i, ax.Object("level", "ERROR", "service", "checkout-api", "statusCode", 502, "tenantTier", "enterprise", "message", "bad gateway from svc-payments-gw"))
			if i%3 == 0 {
				push(i, ax.Object("level", "WARN", "service", "payments-gw", "message", "connection pool exhausted (max=64) waiting=200+"))
				push(i, ax.Object("level", "WARN", "service", "checkout-api", "tenantTier", "enterprise", "message", `user-visible: "Payment could not be processed"`))
			}
		}

		// Window B: the nightly catalog-cron pins CPU and search-api returns 429s.
		if i >= 1000 && i < 1120 {
			push(i, ax.Object("level", "WARN", "service", "catalog-cron", "latencyMs", 0, "message", "rebuild step pinning CPU at 95% on shared node"))
			push(i, ax.Object("level", "ERROR", "service", "search-api", "statusCode", 429, "message", "rate limited: downstream catalog unavailable"))
		}
	}

	return events
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	client := geminiClient()

	logs := buildLogDump()
	fmt.Printf("Generated %d log events (kept out of the prompt).\n", len(logs))

	logRLM := ax.NewAgent(
		`task:string, logs:json "Raw CloudWatch export; keep this out of the prompt" -> architecture:string[] "Services and how they call each other", findings:json[] "Each: issue, count, window, evidence, impact", overallHealth:string, nextActions:string[]`,
		map[string]ax.Value{
			// The export stays in the runtime; only extracted evidence reaches the model.
			"contextFields":   ax.Array("logs"),
			"contextPolicy":   ax.Object("preset", "lean", "budget", "balanced"),
			"maxRuntimeChars": 12000,
			"runtime":         ax.Object("language", "JavaScript"),
		},
	)

	report, err := logRLM.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"logs": ax.Array(logs...),
			"task": "Infer the service architecture from the logs alone. Then find repeated errors, throttles, retries, and bad user states -- with the affected time window, an occurrence count, and concrete log evidence for each.",
		},
		map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 40},
	)
	if err != nil {
		panic(err)
	}

	fmt.Println("\n=== Report ===")
	printJSON(report)
	fmt.Println("\n=== Usage ===")
	printJSON(logRLM.GetUsage())
}
