// ax-example:start
// title: Go Gemini Flex Inference
// group: generation
// description: Sends latency-tolerant work through Gemini Flex and reports the applied tier.
// provider: google-gemini
// env: GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 50
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func geminiAPIKey() string {
	value := os.Getenv("GOOGLE_API_KEY")
	if value == "" {
		value = os.Getenv("GOOGLE_APIKEY")
	}
	if value == "" {
		panic("Set GOOGLE_API_KEY or GOOGLE_APIKEY to run this example.")
	}
	return value
}

func main() {
	model := os.Getenv("AX_GEMINI_MODEL")
	if model == "" {
		model = "gemini-3.7-flash"
	}
	client := ax.NewAI("google-gemini", map[string]ax.Value{
		"api_key": geminiAPIKey(),
		"model":   model,
	})
	out, err := client.Chat(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object(
			"role", "user",
			"content", "Explain in one sentence why batch evaluations save time.",
		)),
	}, map[string]ax.Value{"service_tier": "flex"})
	if err != nil {
		panic(err)
	}
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
