// ax-example:start
// title: Go Parallel Flow
// group: flows
// description: Runs two independent OpenAI-backed steps in parallel before joining their results.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
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
	research := ax.NewAx("topicText:string -> factList:string[]", nil)
	audience := ax.NewAx("topicText:string -> audienceAngle:string", nil)
	join := ax.NewAx("factList:string[], audienceAngle:string -> briefText:string", nil)
	program := ax.NewFlow(map[string]ax.Value{"id": "examples.parallelFlow"}).
		Execute("research", research, map[string]ax.Value{
			"reads": ax.Array("topicText"), "writes": ax.Array("researchResult", "factList"),
		}).
		Execute("audience", audience, map[string]ax.Value{
			"reads": ax.Array("topicText"), "writes": ax.Array("audienceResult", "audienceAngle"),
		}).
		Execute("join", join, map[string]ax.Value{
			"reads": ax.Array("factList", "audienceAngle"), "writes": ax.Array("joinResult", "briefText"),
		}).
		Returns(map[string]ax.Value{"briefText": "briefText"})
	output, err := program.Forward(
		ctx,
		openAIClient(),
		map[string]ax.Value{"topicText": "Why typed contracts make multi-step LLM systems easier to maintain"},
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
