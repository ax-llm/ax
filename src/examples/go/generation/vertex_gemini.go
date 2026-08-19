// ax-example:start
// title: Go Vertex MaaS Renewable Credentials
// group: generation
// description: Calls a Vertex MaaS OpenAI-compatible endpoint with a fresh bearer token per request.
// provider: vertex-ai
// env: VERTEX_AI_API_URL, GOOGLE_VERTEX_ACCESS_TOKEN
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

func vertexCredentialProvider() ax.AxCredentialProvider {
	return ax.AxCredentialProviderFunc(
		func(_ context.Context, _ ax.AxCredentialRequest) (map[string]string, error) {
			// Replace this environment lookup with the host application's ADC token
			// source. Ax calls the hook again for every request attempt and retry.
			token := os.Getenv("GOOGLE_VERTEX_ACCESS_TOKEN")
			if token == "" {
				return nil, fmt.Errorf("set GOOGLE_VERTEX_ACCESS_TOKEN to run this example")
			}
			return map[string]string{"Authorization": "Bearer " + token}, nil
		},
	)
}

func main() {
	model := os.Getenv("AX_VERTEX_MODEL")
	if model == "" {
		model = "google/gemma-4-26b-a4b-it-maas"
	}
	client := ax.NewAI("vertex-ai", map[string]ax.Value{
		"api_url":             required("VERTEX_AI_API_URL"),
		"model":               model,
		"credential_provider": vertexCredentialProvider(),
	})
	out, err := client.Chat(context.Background(), map[string]ax.Value{
		"chat_prompt":     ax.Array(ax.Object("role", "user", "content", "Reply with the word ready.")),
		"response_format": ax.Object("type", "json_object"),
	}, nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(out)
}
