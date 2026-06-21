// ax-example:start
// title: Go Optimization Artifact Reuse
// group: optimization
// description: Saves and reapplies an optimizer artifact after a real OpenAI baseline.
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
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

func openAIClient() *ax.OpenAICompatibleClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" { apiKey = os.Getenv("OPENAI_APIKEY") }
	if apiKey == "" { panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.") }
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" { model = "gpt-5.4-mini" }
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0)})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil { panic(err) }
	fmt.Println(string(data))
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := openAIClient()
	program := ax.NewAx("emailText:string -> priority:class \"high, normal, low\", rationale:string", map[string]ax.Value{"id": "priority", "instruction": "Classify the email priority."})
	baseline, err := program.Forward(ctx, client, map[string]ax.Value{"emailText": "Production checkout is failing for enterprise customers."}, nil)
	if err != nil { panic(err) }
	artifact := ax.Object("componentMap", ax.Object("priority::instruction", "Classify operational risk. Use high for production-impacting urgency."), "metadata", ax.Object("source", "local"))
	program.ApplyOptimizedComponents(map[string]ax.Value{"priority::instruction": "Classify operational risk. Use high for production-impacting urgency."})
	after, err := program.Forward(ctx, client, map[string]ax.Value{"emailText": "Production checkout is failing for enterprise customers."}, nil)
	if err != nil { panic(err) }
	printJSON(ax.Object("baseline", baseline, "artifact", artifact, "after", after))
}
