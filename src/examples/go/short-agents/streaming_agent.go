// ax-example:start
// title: Go Streaming Agent
// group: short-agents
// description: Streams an agent's answer as field deltas while its evidence citations are checked against what the agent read from a handbook kept out of the prompt.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 15
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func openAIClient() ax.AIClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-5.4-mini"
	}
	return ax.NewAI("openai", map[string]ax.Value{"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0)})
}

var handbook = strings.TrimSpace(`
# Acme Cloud -- Support Handbook

## Billing
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Data
- Deleted workspaces are recoverable for 30 days, then permanently purged.
`)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// The handbook stays in the agent's runtime, out of the prompt. With
	// citations on, the answer cites the evidence it used, and ids the run never
	// gathered are sent back to the model for a correction.
	assistant := ax.NewAgent("question:string, handbook:string -> answer:string", map[string]ax.Value{
		"contextFields": ax.Array("handbook"),
		"runtime":       ax.Object("language", "JavaScript"),
		"citations":     ax.Object("onCitations", func(ids []ax.Value) { fmt.Printf("\ncited: %v\n", ids) }),
	})

	// The distiller and the executor run first; then the responder's answer
	// streams. Merge each delta and start over when the version changes (a retry).
	version := 0
	for delta, err := range assistant.StreamingForward(ctx, openAIClient(), map[string]ax.Value{
		"question": "I downgraded today. When does it take effect, and is my data safe if I delete the workspace?",
		"handbook": handbook,
	}, map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 12}) {
		if err != nil {
			panic(err)
		}
		if delta.Version != version {
			version = delta.Version
			fmt.Println("\n[retry: starting over]")
		}
		if text, ok := delta.Delta["answer"].(string); ok {
			fmt.Print(text)
		}
	}
	fmt.Println()
}
