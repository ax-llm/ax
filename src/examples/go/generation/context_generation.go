// ax-example:start
// title: Go Contextual Generation
// group: generation
// description: Answers from supplied context and returns compact citations with OpenAI.
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

	ax "github.com/ax-llm/ax/go"
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
	program := ax.NewAx("context:string, question:string -> answer:string, citations:string[]", nil)
	output, err := program.Forward(ctx, client, map[string]ax.Value{"context": "Ax uses signatures, ai(), ax(), agent(), flow(), and optimize().", "question": "How should a new developer think about Ax?"}, nil)
	if err != nil { panic(err) }
	printJSON(output)
}
