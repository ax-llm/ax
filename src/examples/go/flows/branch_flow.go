// ax-example:start
// title: Go Branching Flow
// group: flows
// description: Routes a classification through follow-up flow logic backed by OpenAI.
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
	"time"

	ax "github.com/ax-llm/ax/packages/go"
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
		model = "gpt-5.4-mini"
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

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := openAIClient()
	classifier := ax.NewAx("request:string -> route:class \"support, sales, engineering\"", nil)
	responder := ax.NewAx("request:string, route:string -> response:string", nil)
	program := ax.NewFlow(map[string]ax.Value{"id": "examples.branchFlow"}).
		Execute("classifier", classifier, map[string]ax.Value{
			"reads": ax.Array("request"), "writes": ax.Array("classifierResult", "route"),
		}).
		Execute("responder", responder, map[string]ax.Value{
			"reads": ax.Array("request", "route"), "writes": ax.Array("responderResult", "response"),
		}).
		Returns(map[string]ax.Value{"route": "route", "response": "response"})
	output, err := program.Forward(ctx, client, map[string]ax.Value{"request": "A customer says checkout is down for their enterprise account."}, nil)
	if err != nil {
		panic(err)
	}
	printJSON(output)
}
