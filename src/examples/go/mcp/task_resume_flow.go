// ax-example:start
// title: Go MCP Task Continuation
// group: mcp
// description: Correlates a terminal MCP task event and dispatches a resume command to the owning AxFlow host.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// story: 62
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY"); if key == "" { key = os.Getenv("OPENAI_APIKEY") }
	if key == "" { panic("Set OPENAI_API_KEY.") }
	runtime, err := ax.NewAxEventRuntime([]ax.AxEventRoute{{
		ID: "task-resume", Action: "resume", TargetID: "reindex-flow",
		Match: map[string]ax.Value{"types": ax.Array("mcp.task.status")},
	}}, nil)
	if err != nil { panic(err) }
	normalized, err := ax.NormalizeMCPEvent("inventory", "notifications/tasks/status", map[string]ax.Value{"task": map[string]ax.Value{"taskId": "42", "status": "completed"}})
	if err != nil { panic(err) }
	commands, err := runtime.Publish(ax.AxEventEnvelope{SpecVersion: "1.0", ID: "task-42-complete", Source: normalized["source"].(string), Type: normalized["type"].(string), Data: normalized["data"]}, "tenant:demo", "authenticated")
	if err != nil { panic(err) }
	for _, command := range commands { if command.Action == "resume" {
		flow := ax.NewFlow(map[string]ax.Value{"id": "reindex-flow"}).Execute("status", ax.NewAx("taskId:string -> status:string", nil), nil).Returns(map[string]ax.Value{"status": "status"})
		llm := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": "gpt-5.4-mini"})
		out, err := flow.Forward(context.Background(), llm, map[string]ax.Value{"taskId": "42"}, nil)
		if err != nil { panic(err) }; fmt.Println(out)
	} }
}
