// ax-example:start
// title: Go Haiku 5.5 Adaptive Thinking
// group: generation
// description: Uses Haiku 5.5 adaptive thinking at low effort for a short response.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 47
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
	client := ax.NewAI("anthropic", ax.Object("api_key", apiKey, "model", "claude-haiku-5-5"))
	response, err := client.Chat(context.Background(), ax.Object(
		"chat_prompt", ax.Array(ax.Object("role", "user", "content", "Reply with exactly: Haiku 5.5 works")),
		"model_config", ax.Object("thinkingTokenBudget", "low", "showThoughts", false, "maxTokens", 2048),
	), nil)
	if err != nil {
		panic(err)
	}
	results := response.(map[string]ax.Value)["results"].(*ax.AxArray).Items
	fmt.Println(results[0].(map[string]ax.Value)["content"])
}
