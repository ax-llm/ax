// ax-example:start
// title: Go Jev Hybrid Reply
// group: generation
// description: Passes Jev decisions to a second Ax program to generate a customer reply.
// provider: typesafe, openai
// env: TYPESAFE_APIKEY, OPENAI_APIKEY, OPENAI_API_KEY
// level: intermediate
// order: 37
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
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	writer := ax.NewAI("openai", map[string]ax.Value{"api_key": key, "model": "gpt-5.6-luna", "model_config": map[string]ax.Value{"temperature": 1}})
	inputs := map[string]ax.Value{"ticket": "Checkout is unavailable for all customers after the latest deployment.", "urgent": decision["urgent"], "team": decision["team"]}
	replyValue, err := ax.NewAx("ticket:string, urgent:boolean, team:string -> reply:string", nil).Forward(ctx, writer, inputs, nil)
	if err != nil {
		panic(err)
	}
	replyValues := replyValue.(map[string]ax.Value)
	reply := map[string]ax.Value{"reply": replyValues["reply"]}
	if text, ok := reply["reply"].(string); !ok || text == "" {
		panic("Empty reply")
	}
	output := map[string]any{"decision": decision, "reply": reply}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
