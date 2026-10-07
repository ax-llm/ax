// ax-example:start
// title: Go OpenAI Signature Decisions
// group: generation
// description: Converts OpenAI probabilities into boolean and class outputs with a provider threshold.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 44
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
	"time"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	model := ax.NewAI("openai-decisions", map[string]ax.Value{"api_key": apiKey, "trueThreshold": 0.9})
	triage := ax.NewAx("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"", nil)
	decisionValue, err := triage.Forward(ctx, model, map[string]ax.Value{"ticket": "Checkout is unavailable for all customers after the latest deployment."}, nil)
	if err != nil {
		panic(err)
	}
	values := decisionValue.(map[string]ax.Value)
	decision := map[string]ax.Value{"urgent": values["urgent"], "team": values["team"]}
	if _, ok := decision["urgent"].(bool); !ok {
		panic("Invalid boolean")
	}
	output := decision
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
