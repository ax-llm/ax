// ax-example:start
// title: Go MCP Resource Wake
// group: mcp
// description: Subscribes to an MCP resource over real Streamable HTTP and lets AxEventRuntime wake an authenticated Agent automatically.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: intermediate
// order: 20
// story: 61
// ax-example:end
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func main() {
	key := os.Getenv("OPENAI_API_KEY")
	if key == "" {
		key = os.Getenv("OPENAI_APIKEY")
	}
	if key == "" {
		panic("Set OPENAI_API_KEY.")
	}
	endpoint := os.Getenv("AX_MCP_ENDPOINT")
	if endpoint == "" {
		panic("Set AX_MCP_ENDPOINT to a Streamable HTTP MCP server.")
	}
	local := strings.HasPrefix(endpoint, "http://127.0.0.1")
	transport, err := ax.NewAxMCPStreamableHTTPTransport(endpoint, map[string]ax.Value{"ssrfProtection": map[string]ax.Value{"requireHttps": !local, "allowLocalhost": local, "allowPrivateNetworks": local}})
	if err != nil {
		panic(err)
	}
	client := ax.NewAxMCPClient(transport, map[string]ax.Value{"namespace": "inventory"})
	source := ax.NewAxMCPEventSource(client, "inventory", "tenant:demo", "authenticated", []string{"demo://inventory"})
	agent := ax.NewAgent("uri:string -> summary:string", map[string]ax.Value{"runtime": ax.Object("language", "JavaScript")})
	llm := ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": key, "model": "gpt-5.4-mini"})
	done := make(chan struct{}, 1)
	runtime, err := ax.NewAxEventRuntime([]ax.AxEventRoute{{ID: "resource-wake", Action: "wake", TargetID: "inventory-agent", RequireAuthenticated: true, Match: map[string]ax.Value{"types": ax.Array("mcp.resource.updated")}}}, nil)
	if err != nil {
		panic(err)
	}
	runtime.RegisterTarget(ax.AxEventTarget{ID: "inventory-agent", RetrySafety: "idempotent",
		MapInput: func(event ax.AxEventEnvelope, _ *ax.AxEventContinuation) (ax.Value, error) {
			return map[string]ax.Value{"uri": event.Data.(map[string]ax.Value)["uri"]}, nil
		},
		Invoke: func(input ax.Value, _ map[string]ax.Value) (ax.Value, error) {
			out, err := agent.Forward(context.Background(), llm, input.(map[string]ax.Value), map[string]ax.Value{"runtime": axgoja.NewRuntime()})
			if err == nil {
				fmt.Println(out)
				select {
				case done <- struct{}{}:
				default:
				}
			}
			return out, err
		},
	})
	runtime.AddSource(source)
	if err := runtime.Start(); err != nil {
		panic(err)
	}
	if os.Getenv("AX_MCP_DEMO_AUTO") == "1" {
		response, err := http.Post(strings.TrimSuffix(endpoint, "/mcp")+"/control/resource", "application/json", nil)
		if err != nil {
			panic(err)
		}
		response.Body.Close()
	}
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		panic("Timed out waiting for an MCP resource notification")
	}
	if err := runtime.Close(); err != nil {
		panic(err)
	}
	if err := client.Close(); err != nil {
		panic(err)
	}
}
