// ax-example:start
// title: Go Meta Muse Spark
// group: generation
// description: Selects any of Meta's three protocols through the existing chat API.
// provider: meta
// env: MODEL_API_KEY
// level: beginner
// order: 52
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	key := os.Getenv("MODEL_API_KEY")
	if key == "" {
		panic("Set MODEL_API_KEY to run this example.")
	}
	for _, profile := range []string{"meta", "meta-chat", "meta-messages"} {
		client := ax.NewAI(profile, map[string]ax.Value{"api_key": key, "model": "muse-spark-1.3"})
		response, err := client.Chat(context.Background(), map[string]ax.Value{
			"chat_prompt":  ax.Array(ax.Object("role", "user", "content", "Name a solar-powered sailboat.")),
			"model_config": ax.Object("thinking_token_budget", "highest"),
		}, nil)
		if err != nil {
			panic(err)
		}
		data, _ := json.Marshal(response)
		fmt.Println(profile, string(data))
	}
}
