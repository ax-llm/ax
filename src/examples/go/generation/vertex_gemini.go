// ax-example:start
// title: Go Vertex Gemini Routing
// group: generation
// description: Calls Gemini through Vertex with project and multi-region routing.
// provider: google-gemini
// env: GOOGLE_VERTEX_ACCESS_TOKEN, GOOGLE_PROJECT_ID, GOOGLE_REGION
// level: intermediate
// order: 35
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		panic("Set " + name + " to run this example.")
	}
	return value
}

func main() {
	model := os.Getenv("AX_VERTEX_MODEL")
	if model == "" {
		model = "gemini-3.5-flash"
	}
	client := ax.NewGoogleGeminiClient(map[string]ax.Value{
		"api_key":    required("GOOGLE_VERTEX_ACCESS_TOKEN"),
		"project_id": required("GOOGLE_PROJECT_ID"),
		"region":     required("GOOGLE_REGION"),
		"model":      model,
	})
	out, err := client.Chat(context.Background(), map[string]ax.Value{
		"chat_prompt": ax.Array(ax.Object("role", "user", "content", "Reply with the word ready.")),
	}, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(out)
}
