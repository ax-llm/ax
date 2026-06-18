// ax-example:start
// title: Go Incident Triage Agent
// group: short-agents
// description: Triages a noisy incident report held in contextFields, using a lean contextPolicy to keep the raw log out of the prompt while it reasons.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
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

// A raw, noisy incident report. It lives in `contextFields`, so the agent works
// it inside the runtime; `contextPolicy: lean` keeps the prompt compact by
// preferring live runtime state and summaries over replaying the raw text.
var report = strings.TrimSpace(`
[2026-03-02 14:01:22Z] INFO  gateway       deploy svc-checkout-edge v812 -> prod (channel: canary 10%)
[2026-03-02 14:03:10Z] WARN  checkout-api  p95 latency 1180ms (baseline 240ms) region=eu-west-1
[2026-03-02 14:04:55Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise
[2026-03-02 14:05:01Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise
[2026-03-02 14:05:40Z] WARN  payments-gw   circuit half-open, 3 retries exhausted for order=ord_99214
[2026-03-02 14:06:12Z] INFO  gateway       canary widened 10% -> 50% for svc-checkout-edge v812
[2026-03-02 14:07:33Z] ERROR checkout-api  502 from svc-payments-gw: upstream timeout (10s) tenant_tier=enterprise
[2026-03-02 14:08:02Z] ERROR checkout-api  user-visible: "Payment could not be processed" shown to 1,284 sessions
[2026-03-02 14:09:48Z] WARN  payments-gw   connection pool exhausted (max=64) waiting=210
[2026-03-02 14:11:20Z] INFO  on-call       paged: SEV-2 opened (eu-west-1 checkout error rate 38%)
[2026-03-02 14:14:05Z] INFO  gateway       rollback svc-checkout-edge v812 -> v811 (channel: prod 100%)
[2026-03-02 14:17:41Z] INFO  checkout-api  p95 latency 260ms, error rate 0.4% region=eu-west-1
[2026-03-02 14:19:10Z] INFO  on-call       SEV-2 mitigated, monitoring for 30m
`)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := openAIClient()

	triage := ax.NewAgent(
		`report:string, question:string -> severity:class "low, medium, high, critical", rootCause:string, nextSteps:string[], evidence:string[] "Quoted log lines that support the assessment"`,
		map[string]ax.Value{
			"contextFields": ax.Array("report"),
			"contextPolicy": ax.Object("preset", "lean", "budget", "balanced"),
			"runtime":       ax.Object("language", "JavaScript"),
		},
	)

	output, err := triage.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"report":   report,
			"question": "What happened, how bad was it, and what should the on-call do next? Cite the lines you relied on.",
		},
		map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 12},
	)
	if err != nil {
		panic(err)
	}
	printJSON(output)
}
