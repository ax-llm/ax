// ax-example:start
// title: Centralized Usage Observer
// group: generation
// description: Attributes every completed model call to a tenant, user, and request from one global observer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
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
		model = "gpt-5.4-mini"
	}

	events := []ax.AxUsageEvent{}
	ax.SetUsageObserver(func(event ax.AxUsageEvent) {
		events = append(events, event)
	})
	defer ax.SetUsageObserver(nil)

	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key": apiKey,
		"model":   model,
		"usageContext": ax.Object(
			"tenantId", "tenant-42",
			"feature", "support-chat",
			"attributes", ax.Object("environment", "example"),
		),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	_, err := client.Chat(
		ctx,
		map[string]ax.Value{
			"chat_prompt": ax.Array(
				ax.Object("role", "user", "content", "Reply with one short greeting."),
			),
		},
		ax.Object(
			"usageContext",
			ax.Object("userId", "user-7", "requestId", fmt.Sprintf("request-%d", time.Now().UnixNano())),
		),
	)
	if err != nil {
		panic(err)
	}
	output, err := json.MarshalIndent(events, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(output))
}
