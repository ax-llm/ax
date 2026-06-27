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
			"body", "data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hel\"}}]}\n\n"+
				"data: {\"id\":\"chatcmpl_stream\",\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n"+
				"data: [DONE]\n\n",
		),
	})
	client := ax.NewOpenAICompatibleClient(map[string]ax.Value{
		"api_key":   "test-key",
		"model":     "gpt-5.4-mini",
		"transport": transport,
	})
	events, err := client.Stream(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "stream")),
	}, nil)
	if err != nil {
		panic(err)
	}
	text := ""
	for _, event := range events {
		first := resultsOf(event)[0].(map[string]ax.Value)
		if content, ok := first["content"].(string); ok {
			text += content
		}
	}
	if text != "hello" {
		panic(fmt.Sprintf("bad stream: %s", text))
	}
	fmt.Println("go-provider-stream-no-key", text)
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
