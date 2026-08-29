// ax-example:start
// title: Go Incremental Provider Stream
// group: generation
// description: Pulls OpenAI SSE events incrementally and closes the response body.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-5.6-luna"
	}
	client, ok := ax.NewAI("openai", map[string]ax.Value{"api_key": apiKey, "model": model}).(ax.StreamingAIClient)
	if !ok {
		panic("OpenAI provider does not expose incremental streaming")
	}
	started := time.Now()
	stream, err := client.StreamEvents(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "Reply with exactly: streaming works")),
		"model_config": ax.Object("temperature", 1),
	}, nil)
	if err != nil {
		panic(err)
	}
	defer stream.Close()
	for stream.Next() {
		event := stream.Value().(map[string]ax.Value)
		var results []ax.Value
		switch value := event["results"].(type) {
		case *ax.AxArray:
			results = value.Items
		case []ax.Value:
			results = value
		}
		if len(results) == 0 {
			continue
		}
		result := results[0].(map[string]ax.Value)
		if content, ok := result["content"].(string); ok && content != "" {
			fmt.Printf("[%d ms] %s", time.Since(started).Milliseconds(), content)
		}
	}
	if err := stream.Err(); err != nil {
		panic(err)
	}
	fmt.Println()
}
