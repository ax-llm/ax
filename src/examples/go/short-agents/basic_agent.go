// ax-example:start
// title: Go Grounded Support Agent
// group: short-agents
// description: Answers a support question grounded in a handbook that is kept out of the model prompt via contextFields.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 20
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

// The handbook can be arbitrarily large. Listing it in `contextFields` keeps it
// in the agent's runtime so it never inflates the model prompt -- the agent reads
// it through code, not through tokens. That is the whole point of an Ax agent
// over a plain gen() call: the source material stays out of the context window.
var handbook = strings.TrimSpace(`
# Acme Cloud -- Support Handbook

## Billing
- Invoices are issued on the 1st of each month and are due net-15.
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Access
- Seats can be added by any workspace Owner under Settings -> Members.
- SSO (SAML) is available on Enterprise; SCIM provisioning is Owner-only.

## Incidents
- Status and uptime are published at status.acme.example.
- Sev-1 incidents page the on-call within 5 minutes; updates post every 30 minutes.

## Data
- Exports are available in CSV and JSON from Settings -> Data.
- Deleted workspaces are recoverable for 30 days, then permanently purged.
`)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	client := openAIClient()

	// Keep the handbook in the runtime, out of the prompt.
	assistant := ax.NewAgent(
		`question:string, handbook:string -> answer:string, citations:string[] "Handbook sections the answer relies on"`,
		map[string]ax.Value{"contextFields": ax.Array("handbook"), "runtime": ax.Object("language", "JavaScript")},
	)

	output, err := assistant.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"question": "A customer downgraded their plan today. When does it take effect, and can they get a refund for the current cycle?",
			"handbook": handbook,
		},
		map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 12},
	)
	if err != nil {
		panic(err)
	}
	printJSON(output)
}
