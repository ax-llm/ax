// ax-example:start
// title: Go Smart Defaults Agent
// group: long-agents
// description: Shows AxAgent smart defaults: oversized undeclared context stays out of the prompt while relevance hints and runtime tools guide the agent.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 60
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

var timeline = []string{
	"09:12 checkout-edge v812 deployed behind 25% of traffic",
	"09:18 payments gateway p95 rose from 420ms to 4.8s",
	"09:22 cart completion dropped 31% for enterprise accounts",
	"09:27 retries saturated the checkout-edge connection pool",
	"09:31 rollback to v811 started",
	"09:36 p95 returned below 700ms after pool reset",
}

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

func buildIncidentLog() string {
	var out strings.Builder
	for i := 0; i < 28; i++ {
		if i > 0 {
			out.WriteString("\n\n")
		}
		out.WriteString(fmt.Sprintf("# log shard %d\n", i+1))
		out.WriteString(strings.Join(timeline, "\n"))
	}
	return out.String()
}

func asMap(value ax.Value) map[string]ax.Value {
	if out, ok := value.(map[string]ax.Value); ok {
		return out
	}
	return map[string]ax.Value{}
}

func asString(value ax.Value) string {
	if value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}

func summarizeIncidentTool(params ax.Value) (ax.Value, error) {
	service := asString(asMap(params)["service"])
	if service == "" {
		service = "checkout"
	}
	return ax.Object(
		"service", service,
		"severity", "sev-1",
		"rootCause", "checkout-edge v812 retried payment gateway calls without bounded concurrency, saturating the shared connection pool.",
		"errorRate", "38%",
		"affectedSessions", 1284,
		"candidateRunbook", "payments-timeout-runbook",
		"relevantMemory", "decision-enterprise-comms",
	), nil
}

func getTimelineTool(params ax.Value) (ax.Value, error) {
	service := asString(asMap(params)["service"])
	if service == "" {
		service = "checkout"
	}
	events := []ax.Value{}
	for _, event := range timeline {
		events = append(events, ax.Object("service", service, "event", event))
	}
	return ax.Array(events...), nil
}

func getRunbookTool(params ax.Value) (ax.Value, error) {
	id := asString(asMap(params)["id"])
	if id == "" {
		id = "payments-timeout-runbook"
	}
	return ax.Object(
		"id", id,
		"steps", ax.Array(
			"Freeze checkout deploys and page the payments owner.",
			"Rollback checkout-edge to v811 and reset saturated pools.",
			"Post enterprise status update after error rate stays below 2%.",
		),
	), nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	client := geminiClient()

	runtime := axgoja.NewRuntime(
		axgoja.WithCallable("summarizeIncident", summarizeIncidentTool),
		axgoja.WithCallable("getTimeline", getTimelineTool),
		axgoja.WithCallable("getRunbook", getRunbookTool),
	)

	analyst := ax.NewAgent(
		`incidentLog:string, question:string -> rootCause:string, actions:string[] "Recommended remediation actions from the runbook", evidence:string[]`,
		map[string]ax.Value{
			"name":        "SmartDefaultsIncidentAgent",
			"description": "Investigate checkout incidents using runtime tools, relevance hints, and compact evidence.",
			// No contextFields and no autoUpgrade option: oversized incidentLog is promoted by default.
			"functions": ax.Array(
				ax.Object(
					"name", "summarizeIncident",
					"description", "Summarize the current checkout incident and name the strongest runbook and memory matches.",
					"parameters", ax.Object(
						"type", "object",
						"properties", ax.Object("service", ax.Object("type", "string")),
						"required", ax.Array("service"),
					),
				),
				ax.Object(
					"name", "getTimeline",
					"description", "Return concrete timestamped evidence for the checkout incident.",
					"parameters", ax.Object(
						"type", "object",
						"properties", ax.Object("service", ax.Object("type", "string")),
						"required", ax.Array("service"),
					),
				),
				ax.Object(
					"name", "getRunbook",
					"description", "Fetch the operational runbook steps for a relevant incident pattern.",
					"parameters", ax.Object(
						"type", "object",
						"properties", ax.Object("id", ax.Object("type", "string")),
						"required", ax.Array("id"),
					),
				),
			),
			"skillsCatalog": ax.Array(
				ax.Object(
					"id", "payments-timeout-runbook",
					"name", "Payments timeout runbook",
					"content", "Use when checkout latency follows payment gateway retry amplification.",
				),
				ax.Object(
					"id", "status-comms-runbook",
					"name", "Status communications",
					"content", "Use when customer-facing enterprise account updates are required.",
				),
			),
			"memoriesCatalog": ax.Array(
				ax.Object(
					"id", "decision-enterprise-comms",
					"content", "For sev-1 checkout incidents, send an enterprise status update only after rollback is complete and error rate is below 2%.",
				),
				ax.Object(
					"id", "checkout-v812-rollback",
					"content", "checkout-edge v812 rollback completed cleanly once saturated payment pools were reset.",
				),
			),
			"executorOptions": ax.Object("description", strings.Join([]string{
				"Call the bare async runtime functions summarizeIncident, getTimeline, and getRunbook before answering.",
				"Use top-level await, for example: const s = await summarizeIncident({service:'checkout'});",
				"The large incidentLog input is intentionally not declared as a context field; smart defaults keep it available at runtime without flooding the prompt.",
				"Return the root cause, the first three remediation actions, and concrete evidence.",
			}, "\n")),
			"runtime": ax.Object("language", "JavaScript"),
		},
	)

	result, err := analyst.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"incidentLog": buildIncidentLog(),
			"question":    "Find the root cause, first three remediation actions, and concrete evidence for the checkout payment incident.",
		},
		map[string]ax.Value{"runtime": runtime, "max_actor_steps": 30},
	)
	if err != nil {
		panic(err)
	}

	printJSON(result)
}
