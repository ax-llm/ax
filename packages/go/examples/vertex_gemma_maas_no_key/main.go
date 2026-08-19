package main

import (
  "context"
  "fmt"

  ax "github.com/ax-llm/ax/packages/go"
)

func values(value ax.Value) []ax.Value {
  switch typed := value.(type) {
  case []ax.Value:
    return typed
  case *ax.AxArray:
    return typed.Items
  default:
    return nil
  }
}

func main() {
  transport := ax.NewScriptedTransport([]ax.Value{ax.Object(
    "status", 200.0,
    "json", ax.Object(
      "id", "vertex-gemma",
      "model", "google/gemma-4-26b-a4b-it-maas",
      "choices", ax.Array(ax.Object(
        "index", 0.0,
        "finish_reason", "stop",
        "message", ax.Object(
          "role", "assistant",
          "content", "{\"answer\":\"ok\"}",
          "reasoning_content", "Fresh reasoning.",
        ),
      )),
    ),
  )})
  credentials := ax.AxCredentialProviderFunc(
    func(_ context.Context, request ax.AxCredentialRequest) (map[string]string, error) {
      if request.Profile != "vertex-ai" || request.Operation != "chat" {
        return nil, fmt.Errorf("unexpected credential request: %#v", request)
      }
      return map[string]string{"Authorization": "Bearer fresh-token"}, nil
    },
  )
  client := ax.NewAI("vertex-ai", map[string]ax.Value{
    "api_url": "https://vertex.test/v1",
    "model": "google/gemma-4-26b-a4b-it-maas",
    "credential_provider": credentials,
    "transport": transport,
  })
  output, err := client.Chat(context.Background(), map[string]ax.Value{
    "chat_prompt": ax.Array(
      ax.Object("role", "assistant", "content", "Previous answer.", "thought", "Previous reasoning."),
      ax.Object("role", "user", "content", "Return JSON."),
    ),
    "response_format": ax.Object("type", "json_object"),
  }, nil)
  if err != nil { panic(err) }

  request := transport.Requests[0].(map[string]ax.Value)
  body := request["json"].(map[string]ax.Value)
  thinking := body["chat_template_kwargs"].(map[string]ax.Value)
  messages := values(body["messages"])
  replay := messages[0].(map[string]ax.Value)
  headers := request["headers"].(map[string]ax.Value)
  results := values(output.(map[string]ax.Value)["results"])
  result := results[0].(map[string]ax.Value)
  if thinking["enable_thinking"] != true || replay["reasoning_content"] != "Previous reasoning." || headers["Authorization"] != "Bearer fresh-token" || result["thought"] != "Fresh reasoning." {
    panic(fmt.Sprintf("unexpected Vertex Gemma mapping: request=%#v output=%#v", request, output))
  }
  fmt.Println("go-vertex-gemma-maas-no-key-ok")
}
