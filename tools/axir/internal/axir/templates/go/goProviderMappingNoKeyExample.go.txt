package main

import (
	"context"
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	transport := ax.NewScriptedTransport([]ax.Value{
		ax.Object(
			"status", 200,
			"json", ax.Object(
				"id", "chatcmpl_example",
				"model", "gpt-5.4-mini",
				"usage", ax.Object("prompt_tokens", 8, "completion_tokens", 4, "total_tokens", 12),
				"choices", ax.Array(ax.Object(
					"index", 0,
					"finish_reason", "stop",
					"message", ax.Object("role", "assistant", "content", "Ax is a toolkit."),
				)),
			),
		),
	})
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":   "test-key",
		"model":     "gpt-5.4-mini",
		"transport": transport,
		"usageContext": ax.Object(
			"tenantId", "tenant-1",
			"feature", "no-key-example",
		),
	})
	events := []ax.AxUsageEvent{}
	ax.SetUsageObserver(func(event ax.AxUsageEvent) {
		events = append(events, event)
	})
	result, err := client.Chat(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(
			ax.Object("role", "system", "content", "Answer briefly."),
			ax.Object("role", "user", "content", "What is Ax?"),
		),
		"model_config": ax.Object("temperature", 0),
	}, ax.Object(
		"usageContext",
		ax.Object("userId", "user-1", "requestId", "request-1"),
	))
	ax.SetUsageObserver(nil)
	if err != nil {
		panic(err)
	}
	if len(events) != 1 || events[0]["context"].(map[string]ax.Value)["tenantId"] != "tenant-1" {
		panic(fmt.Sprintf("bad usage event: %#v", events))
	}
	first := resultsOf(result)[0].(map[string]ax.Value)
	fmt.Println("go-provider-mapping-no-key", first["content"])
}

func resultsOf(value ax.Value) []ax.Value {
	raw := value.(map[string]ax.Value)["results"]
	switch values := raw.(type) {
	case []ax.Value:
		return values
	case *ax.AxArray:
		return values.Items
	default:
		panic(fmt.Sprintf("unexpected results type %T", raw))
	}
}
