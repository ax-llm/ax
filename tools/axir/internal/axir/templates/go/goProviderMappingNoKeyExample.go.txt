package main

import (
	"context"
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	transport := ax.NewScriptedTransport([]ax.Value{
		ax.Object(
			"status", 200,
			"json", ax.Object(
				"id", "chatcmpl_example",
				"model", "gpt-4.1-mini",
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
		"model":     "gpt-4.1-mini",
		"transport": transport,
	})
	result, err := client.Chat(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(
			ax.Object("role", "system", "content", "Answer briefly."),
			ax.Object("role", "user", "content", "What is Ax?"),
		),
		"model_config": ax.Object("temperature", 0),
	}, nil)
	if err != nil {
		panic(err)
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
