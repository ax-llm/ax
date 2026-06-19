// ax-example:start
// title: Go Composed Flow
// group: flows
// description: Composes multiple typed programs into one OpenAI-backed flow.
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
	if model == "" { model = "gpt-4.1-mini" }
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
	step := ax.NewAx("topic:string -> outline:string[]", nil)
	program := ax.NewFlow(map[string]ax.Value{"id": "examples.composedFlow"}).
		Execute("step", step, nil).
		Returns(map[string]ax.Value{"step": "step"})
	output, err := program.Forward(ctx, client, map[string]ax.Value{"topic": "How Ax moves from typed generation to agents, flows, and optimization"}, nil)
	if err != nil { panic(err) }
	printJSON(output)
}
