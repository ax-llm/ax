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

func main() {
  model := os.Getenv("AX_VERTEX_MODEL")
  if model == "" { model = "gemini-3.5-flash" }
  client := ax.NewGoogleGeminiClient(map[string]ax.Value{
    "api_key": required("GOOGLE_VERTEX_ACCESS_TOKEN"),
    "project_id": required("GOOGLE_PROJECT_ID"),
    "region": required("GOOGLE_REGION"),
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
