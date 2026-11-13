// ax-example:start
// title: Go Gemini 4 Hydrogen
// group: generation
// description: Uses Hydrogen with a thinking level and an explicit output limit.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: beginner
// order: 51
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	apiKey := os.Getenv("GOOGLE_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("GOOGLE_APIKEY")
	}
	if apiKey == "" {
		panic("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.")
	}
	client := ax.NewAI("google-gemini", map[string]ax.Value{
		"api_key": apiKey, "model": "gemini-4-hydrogen",
	})
	result, err := client.Chat(context.Background(), map[string]ax.Value{
		"chat_prompt":  ax.Array(ax.Object("role", "user", "content", "Why does a hash table usually provide fast lookups?")),
		"model_config": ax.Object("max_tokens", 4096),
		// Use "highest" for Hydrogen's xhigh level; "low" keeps this example quick.
	}, map[string]ax.Value{"thinking_token_budget": "low"})
	if err != nil {
		panic(err)
	}
	results := result.(map[string]ax.Value)["results"].(*ax.AxArray).Items
	fmt.Println(results[0].(map[string]ax.Value)["content"])
}
