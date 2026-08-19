package main

import (
  "context"
  "encoding/json"
  "fmt"
  "os"
  "time"

  ax "github.com/ax-llm/ax/packages/go"
)

func required(name string) string {
  value := os.Getenv(name)
  if value == "" {
    fmt.Fprintf(os.Stderr, "Set %s to run this Vertex provider API example.\n", name)
    os.Exit(2)
  }
  return value
}

func vertexCredentials() ax.AxCredentialProvider {
  return ax.AxCredentialProviderFunc(func(_ context.Context, _ ax.AxCredentialRequest) (map[string]string, error) {
    token := os.Getenv("GOOGLE_VERTEX_ACCESS_TOKEN")
    if token == "" { return nil, fmt.Errorf("set GOOGLE_VERTEX_ACCESS_TOKEN to run this Vertex provider API example") }
    return map[string]string{"Authorization": "Bearer " + token}, nil
  })
}

func main() {
  model := os.Getenv("AX_VERTEX_MODEL")
  if model == "" { model = "google/gemini-3.5-flash" }
  client := ax.NewAI("vertex-ai", map[string]ax.Value{
    "api_url": required("VERTEX_AI_API_URL"),
    "credential_provider": vertexCredentials(),
    "model": model,
  })
  ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
  defer cancel()
  output, err := client.Chat(ctx, map[string]ax.Value{
    "chat_prompt": ax.Array(ax.Object("role", "user", "content", "Reply with the word ready.")),
  }, nil)
  if err != nil { panic(err) }
  data, err := json.MarshalIndent(output, "", "  ")
  if err != nil { panic(err) }
  fmt.Println(string(data))
}
