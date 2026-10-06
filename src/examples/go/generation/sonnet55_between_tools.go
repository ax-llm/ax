// ax-example:start
// title: Go Sonnet 5.5 Between-Tool Thinking
// group: generation
// description: Disables pre-response thinking while retaining signed updates for replay.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 46
// ax-example:end
package main

import (
	"context"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
)

func main() {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("ANTHROPIC_APIKEY")
	}
	if apiKey == "" {
		panic("Set ANTHROPIC_API_KEY or ANTHROPIC_APIKEY to run this example.")
	}
	client := ax.NewAI("anthropic", ax.Object("api_key", apiKey, "model", "claude-sonnet-5-5"))
	response, err := client.Chat(context.Background(), ax.Object(
		"chat_prompt", ax.Array(ax.Object("role", "user", "content", "Reply with exactly: Sonnet 5.5 works")),
		"model_config", ax.Object("thinkingTokenBudget", "none", "effort", "high", "maxTokens", 128),
	), nil)
	if err != nil {
		panic(err)
	}
	results := response.(map[string]ax.Value)["results"].(*ax.AxArray).Items
	fmt.Println(results[0].(map[string]ax.Value)["content"])
}
