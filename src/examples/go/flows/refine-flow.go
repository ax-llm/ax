// ax-example:start
// title: Go Refinement Flow
// group: flows
// description: Drafts, critiques, and revises an answer through three OpenAI-backed steps.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
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
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":      apiKey,
		"model":        model,
		"model_config": ax.Object("temperature", 0),
	})
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	draft := ax.NewAx("topicText:string -> draftText:string", nil)
	critique := ax.NewAx("draftText:string -> critiqueText:string", nil)
	revise := ax.NewAx("draftText:string, critiqueText:string -> revisedText:string", nil)
	program := ax.NewFlow(map[string]ax.Value{"id": "examples.refineFlow"}).
		Execute("draft", draft, map[string]ax.Value{
			"reads": ax.Array("topicText"), "writes": ax.Array("draftResult", "draftText"),
		}).
		Execute("critique", critique, map[string]ax.Value{
			"reads": ax.Array("draftText"), "writes": ax.Array("critiqueResult", "critiqueText"),
		}).
		Execute("revise", revise, map[string]ax.Value{
			"reads": ax.Array("draftText", "critiqueText"), "writes": ax.Array("reviseResult", "revisedText"),
		}).
		Returns(map[string]ax.Value{"revisedText": "revisedText"})
	output, err := program.Forward(
		ctx,
		openAIClient(),
		map[string]ax.Value{"topicText": "Explain automatic flow parallelism to a backend engineer."},
		nil,
	)
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
