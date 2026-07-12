// ax-example:start
// title: Go MCP Resource Wake
// group: mcp
// description: Normalizes a subscribed resource notification and dispatches an authenticated wake command to an Agent.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// story: 61
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY"); if key == "" { key = os.Getenv("OPENAI_APIKEY") }
	if key == "" { panic("Set OPENAI_API_KEY.") }
	runtime, err := ax.NewAxEventRuntime([]ax.AxEventRoute{{
		ID: "resource-wake", Action: "wake", TargetID: "inventory-agent", RequireAuthenticated: true,
		Match: map[string]ax.Value{"types": ax.Array("mcp.resource.updated")},
	}}, nil)
	if err != nil { panic(err) }
	normalized, err := ax.NormalizeMCPEvent("inventory", "notifications/resources/updated", map[string]ax.Value{"uri": "demo://inventory"})
	if err != nil { panic(err) }
	commands, err := runtime.Publish(ax.AxEventEnvelope{SpecVersion: "1.0", ID: "resource-1", Source: normalized["source"].(string), Type: normalized["type"].(string), Data: normalized["data"]}, "tenant:demo", "authenticated")
	if err != nil { panic(err) }
	for _, command := range commands { if command.Action == "wake" {
		agent := ax.NewAgent("uri:string -> summary:string", map[string]ax.Value{"runtime": ax.Object("language", "JavaScript")})
		llm := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": "gpt-5.4-mini"})
		out, err := agent.Forward(context.Background(), llm, map[string]ax.Value{"uri": "demo://inventory"}, map[string]ax.Value{"runtime": axgoja.NewRuntime()})
		if err != nil { panic(err) }; fmt.Println(out)
	} }
}
