// ax-example:start
// title: Go Jev Signature Decisions
// group: generation
// description: Converts Jev probabilities into boolean and class outputs with a provider threshold.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: beginner
// order: 35
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
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	model := ax.NewAI("typesafe", map[string]ax.Value{"api_key": os.Getenv("TYPESAFE_APIKEY"), "trueThreshold": 0.9})
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
